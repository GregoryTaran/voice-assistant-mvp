const fetch = require("node-fetch");
const FormData = require("form-data");
const Papa = require("papaparse");

// 📊 Google Sheets CSV (лист apartments)
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/gviz/tq?tqx=out:csv&sheet=apartments";

// 🧠 Промт для GPT-1 (аналитик)
const INTENT_PROMPT_URL =
  "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt";

// 💬 Промт для GPT-2 (ассистент “Ясность”)
const SYSTEM_PROMPT_URL =
  "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";

// ---------- ДАННЫЕ ----------

async function loadApartments() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error("Не удалось получить CSV из Google Sheets");
  const csvText = await res.text();
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  return parsed.data;
}

// ---------- GPT-1: АНАЛИТИК ----------

async function understandIntent(userText) {
  const system = await fetch(INTENT_PROMPT_URL).then(r => r.text());

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userText },
      ],
    }),
  });

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() || "{}";
  const jsonMatch = raw.match(/\{[\s\S]*\}$/);
  const jsonStr = jsonMatch ? jsonMatch[0] : raw;
  try {
    return JSON.parse(jsonStr);
  } catch {
    console.error("JSON parse error (GPT-1):", raw);
    return null;
  }
}

// ---------- ОБРАБОТКА ЗАПРОСА К БАЗЕ ----------

function executeIntent(apartments, intentObj) {
  if (!intentObj || !intentObj.intent)
    return { results: [], meta: { intent: "unknown" } };

  const intent = intentObj.intent;
  const f = intentObj.filters || {};

  if (intent === "list_cities") {
    const cities = [...new Set(apartments.map(a => (a["Город"] || "").trim()))].filter(Boolean);
    return { results: cities.map(c => ({ city: c })), meta: { intent } };
  }

  if (intent === "list_developers") {
    const devs = [...new Set(apartments.map(a => (a["Застройщик"] || "").trim()))].filter(Boolean);
    return { results: devs.map(d => ({ developer: d })), meta: { intent } };
  }

  if (intent === "search_apartments") {
    const results = apartments.filter(ap => {
      const cityVal = (ap["Город"] || "");
      const devVal = (ap["Застройщик"] || "");
      const area = Number(ap["Площадь (м²)"] || 0);
      const priceTotal = Number(ap["Общая цена (€)"] || ap["Общая цена"] || 0);
      const pricePerM2 = Number(ap["Цена за м² (€)"] || 0);
      const instPercent = Number(ap["Рассрочка (%)"] || 0);
      const months = Number(ap["Месяцев"] || 0);

      const byCity = f.city ? cityVal.toLowerCase().includes(String(f.city).toLowerCase()) : true;
      const byDev = f.developer ? devVal.toLowerCase().includes(String(f.developer).toLowerCase()) : true;

      const areaMinOk = f.min_area ? area >= f.min_area : true;
      const areaMaxOk = f.max_area ? area <= f.max_area : true;
      const priceMinOk = f.min_price ? priceTotal >= f.min_price : true;
      const priceMaxOk = f.max_price ? priceTotal <= f.max_price : true;
      const ppm2MinOk = f.min_price_per_m2 ? pricePerM2 >= f.min_price_per_m2 : true;
      const ppm2MaxOk = f.max_price_per_m2 ? pricePerM2 <= f.max_price_per_m2 : true;
      const instMinOk = f.min_installment_percent ? instPercent >= f.min_installment_percent : true;
      const instMaxOk = f.max_installment_percent ? instPercent <= f.max_installment_percent : true;
      const monthsMinOk = f.min_months ? months >= f.min_months : true;
      const monthsMaxOk = f.max_months ? months <= f.max_months : true;

      return (
        byCity && byDev &&
        areaMinOk && areaMaxOk &&
        priceMinOk && priceMaxOk &&
        ppm2MinOk && ppm2MaxOk &&
        instMinOk && instMaxOk &&
        monthsMinOk && monthsMaxOk
      );
    });

    return { results, meta: { intent, filters: f } };
  }

  return { results: [], meta: { intent: "unsupported" } };
}

// ---------- GPT-2: ФИНАЛЬНЫЙ ОТВЕТ ----------

async function generateAnswer(userText, resultsSlice, hist, shouldGreet) {
  const systemPrompt = await fetch(SYSTEM_PROMPT_URL).then(r => r.text());

  const dynamic = shouldGreet
    ? 'Это первое сообщение в этой сессии. Начни ответ с фразы: **Добро пожаловать в нейрость "Ясность".**'
    : 'Это не первое сообщение в сессии — не используй приветственную фразу.';

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "system", content: dynamic },
    ...hist.map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    { role: "user", content: userText },
    { role: "assistant", content: JSON.stringify(resultsSlice) },
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      temperature: 0.7,
      messages,
    }),
  });

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "🤖 Нет ответа.";
}

// ---------- MAIN HANDLER ----------

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || "{}");
    let userText = (body.text || "").trim();
    const hist = Array.isArray(body.history) ? body.history : [];
    const shouldGreet = !!body.shouldGreet;

    // 🎤 Голос → Whisper
    if (!userText && body.audio) {
      let audioBase64 = body.audio;
      if (audioBase64.startsWith("data:"))
        audioBase64 = audioBase64.split(",")[1];

      const audioBuffer = Buffer.from(audioBase64, "base64");
      const form = new FormData();
      form.append("file", audioBuffer, {
        filename: "audio.webm",
        contentType: "audio/webm",
      });
      form.append("model", "whisper-1");

      const wRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });

      const wJson = await wRes.json();
      if (!wRes.ok)
        return {
          statusCode: 500,
          body: JSON.stringify({ error: "Whisper failed", details: wJson }),
        };
      userText = (wJson.text || "").trim();
    }

    if (!userText)
      return { statusCode: 400, body: JSON.stringify({ error: "Пустой запрос" }) };

    // 🧠 1. Понять намерение (GPT-1)
    const intentObj = await understandIntent(userText);

    // 📊 2. Загрузить базу
    const apartments = await loadApartments();

    // 🔍 3. Найти результаты
    const { results } = executeIntent(apartments, intentObj);

    // 💬 4. GPT-2: оформить ответ
    const answer = await generateAnswer(
      userText,
      results.slice(0, 10),
      hist,
      shouldGreet
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ text: answer, query: userText }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
