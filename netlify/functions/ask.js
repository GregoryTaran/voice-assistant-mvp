const fetch = require("node-fetch");
const FormData = require("form-data");
const Papa = require("papaparse");

// Google Sheets (лист apartments)
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/gviz/tq?tqx=out:csv&sheet=apartments";

// GPT-1 (аналитик)
const INTENT_PROMPT_URL =
  "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt";

// GPT-2 (ассистент)
const SYSTEM_PROMPT_URL =
  "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";

// ---------- CSV ----------
async function loadApartments() {
  const res = await fetch(CSV_URL);
  const text = await res.text();
  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  return parsed.data;
}

// ---------- GPT-1 ----------
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
    console.error("GPT-1 parse error:", raw);
    return null;
  }
}

// ---------- EXECUTE ----------
function executeIntent(apartments, intentObj) {
  if (!intentObj || !intentObj.intent)
    return { results: [], meta: { intent: "unknown" } };

  const intent = intentObj.intent;
  const f = intentObj.filters || {};

  const regionGroups = {
    north: ["Милан", "Турин", "Болонья", "Верона", "Венеция", "Тренто", "Генуя"],
    south: ["Неаполь", "Бари", "Палермо", "Катания", "Таранто", "Реджо-ди-Калабрия"],
    center: ["Рим", "Флоренция", "Перуджа", "Пиза"],
    coast: ["Венеция", "Неаполь", "Бари", "Генуя", "Палермо", "Катания", "Римини"],
    mountain: ["Тренто", "Больцано"],
  };

  const prices = apartments
    .map(a => Number(a["Общая цена (€)"] || 0))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const lowT = prices[Math.floor(prices.length * 0.3)];
  const highT = prices[Math.floor(prices.length * 0.7)];

  if (f.price_segment === "low") f.max_price = lowT;
  if (f.price_segment === "high") f.min_price = highT;

  const results = apartments.filter(ap => {
    const city = (ap["Город"] || "").toLowerCase();
    const dev = (ap["Застройщик"] || "").toLowerCase();
    const area = Number(ap["Площадь (м²)"] || 0);
    const total = Number(ap["Общая цена (€)"] || 0);
    const priceM2 = Number(ap["Цена за м² (€)"] || 0);

    const byCity = f.city ? city.includes(f.city.toLowerCase()) : true;
    const byDev = f.developer ? dev.includes(f.developer.toLowerCase()) : true;
    const byRegion =
      f.region && regionGroups[f.region]
        ? regionGroups[f.region].some(c => city.includes(c.toLowerCase()))
        : true;

    const areaOk =
      (!f.min_area || area >= f.min_area) &&
      (!f.max_area || area <= f.max_area);
    const priceOk =
      (!f.min_price || total >= f.min_price) &&
      (!f.max_price || total <= f.max_price);
    const ppm2Ok =
      (!f.min_price_per_m2 || priceM2 >= f.min_price_per_m2) &&
      (!f.max_price_per_m2 || priceM2 <= f.max_price_per_m2);

    return byCity && byDev && byRegion && areaOk && priceOk && ppm2Ok;
  });

  return { results, meta: { intent, filters: f } };
}

// ---------- GPT-2 ----------
async function generateAnswer(userText, resultsSlice, hist, shouldGreet) {
  const systemPrompt = await fetch(SYSTEM_PROMPT_URL).then(r => r.text());
  const dynamic = shouldGreet
    ? 'Это первое сообщение в сессии. Начни ответ с фразы: **Добро пожаловать в нейрость "Ясность".**'
    : 'Это не первое сообщение — не используй приветствие.';
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

// ---------- MAIN ----------
exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || "{}");
    let userText = (body.text || "").trim();
    const hist = Array.isArray(body.history) ? body.history : [];
    const shouldGreet = !!body.shouldGreet;

    // 🎤 Распознавание
    if (!userText && body.audio) {
      let audioBase64 = body.audio;
      if (audioBase64.startsWith("data:")) audioBase64 = audioBase64.split(",")[1];
      const form = new FormData();
      form.append("file", Buffer.from(audioBase64, "base64"), {
        filename: "audio.webm",
        contentType: "audio/webm",
      });
      form.append("model", "whisper-1");
      const w = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });
      const j = await w.json();
      userText = j.text?.trim() || "";
    }

    if (!userText) return { statusCode: 400, body: "Пустой запрос" };

    // 🧠 GPT-1
    const intentObj = await understandIntent(userText);

    if (intentObj?.intent === "clarify") {
      return { statusCode: 200, body: JSON.stringify({ text: intentObj.message }) };
    }

    const apartments = await loadApartments();
    const { results } = executeIntent(apartments, intentObj);

    const answer = await generateAnswer(userText, results.slice(0, 10), hist, shouldGreet);

    return { statusCode: 200, body: JSON.stringify({ text: answer, query: userText }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
