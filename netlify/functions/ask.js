const fetch = require("node-fetch");
const FormData = require("form-data");
const Papa = require("papaparse");

// ⚙️ Твоя таблица (лист: apartments)
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/gviz/tq?tqx=out:csv&sheet=apartments";

// ⚙️ Системный промт из Google Docs (как и хотели)
const SYSTEM_PROMPT_URL =
  "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";

// 1) Загружаем актуальные данные из Google Sheets
async function loadApartments() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error("Не удалось получить CSV из Google Sheets");
  const csvText = await res.text();
  const parsed = Papa.parse(csvText, { header: true, skipEmptyLines: true });
  return parsed.data; // массив объектов по заголовкам колонок
}

// 2) GPT-1: понять запрос и вернуть JSON (intent + filters)
async function understandIntent(userText) {
  const system = `
Ты — аналитик запросов о недвижимости. 
Задача: перевести пользовательский запрос в JSON без пояснений, без кода, без форматирования.
Формат ответа ТОЛЬКО один объект JSON. Никакого текста вокруг.

Примеры:
"Покажи квартиры в Милане до 150 тысяч евро"
→ {"intent":"search_apartments","filters":{"city":"Милан","max_price":150000}}

"Какие города доступны?"
→ {"intent":"list_cities"}

Если данных мало, верни только то, что можно понять.
`;

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
        { role: "user", content: userText }
      ]
    }),
  });

  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content?.trim() || "{}";

  // Пытаемся аккуратно вытащить JSON, даже если модель обернула его в форматирование
  const jsonMatch = raw.match(/\{[\s\S]*\}$/);
  const jsonStr = jsonMatch ? jsonMatch[0] : raw;
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Не удалось распарсить JSON от GPT:", raw);
    return null;
  }
}

// 3) Исполнить JSON-запрос ИИ над таблицей
function executeIntent(apartments, intentObj) {
  if (!intentObj || !intentObj.intent) return { results: [], meta: { intent: "unknown" } };

  const intent = intentObj.intent;
  const filters = intentObj.filters || {};

  // Специальный кейс: список городов
  if (intent === "list_cities") {
    const cities = [...new Set(apartments.map(a => (a["Город"] || "").trim()))].filter(Boolean);
    return { results: cities.map(c => ({ city: c })), meta: { intent } };
  }

  // Поиск квартир
  if (intent === "search_apartments") {
    const city = filters.city ? String(filters.city).toLowerCase() : null;
    const maxPrice = filters.max_price != null ? Number(filters.max_price) : null;

    const results = apartments.filter(ap => {
      const apCity = (ap["Город"] || "").toLowerCase();
      const total = Number(ap["Общая цена (€)"] || ap["Общая цена"] || 0);
      const cityOk = city ? apCity.includes(city) : true;
      const priceOk = maxPrice ? total <= maxPrice : true;
      return cityOk && priceOk;
    });

    return { results, meta: { intent, filters } };
  }

  // Можно добавлять другие intent-ы по мере надобности
  return { results: [], meta: { intent: "unsupported" } };
}

// 4) GPT-2: оформить ответ красиво, с учётом системного промта из Google Docs
async function generateAnswer(userText, resultsSlice) {
  const systemPrompt = await fetch(SYSTEM_PROMPT_URL).then(r => r.text());

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      temperature: 0.7,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
        // Передаём найденные данные как JSON (до 10 элементов, чтобы не раздувать)
        { role: "assistant", content: JSON.stringify(resultsSlice) }
      ]
    }),
  });

  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || "🤖 Нет ответа.";
}

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body || "{}");
    let userText = (body.text || "").trim();

    // 🎤 Если пришло аудио — расшифровываем в текст через Whisper
    if (!userText && body.audio) {
      let audioBase64 = body.audio;
      if (audioBase64.startsWith("data:")) {
        audioBase64 = audioBase64.split(",")[1];
      }
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const form = new FormData();
      form.append("file", audioBuffer, { filename: "audio.webm", contentType: "audio/webm" });
      form.append("model", "whisper-1");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form,
      });

      const whisperJson = await whisperRes.json();
      if (!whisperRes.ok) {
        return { statusCode: 500, body: JSON.stringify({ error: "Whisper failed", details: whisperJson }) };
      }
      userText = (whisperJson.text || "").trim();
    }

    if (!userText) {
      return { statusCode: 400, body: JSON.stringify({ error: "Пустой запрос" }) };
    }

    // 1) GPT-1 понимает, что хотел пользователь
    const intentObj = await understandIntent(userText);

    // 2) Загружаем свежие данные из таблицы
    const apartments = await loadApartments();

    // 3) Исполняем запрос ИИ к базе
    const { results } = executeIntent(apartments, intentObj);

    // 4) GPT-2 формирует финальный ответ
    const answer = await generateAnswer(userText, results.slice(0, 10));

    return {
      statusCode: 200,
      body: JSON.stringify({ text: answer, query: userText }),
    };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
