// netlify/functions/ask.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const Papa = require("papaparse");
const fetch = require("node-fetch");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* === 📡 Функция: получить актуальные настройки из Airtable === */
async function getCurrentConfig() {
  try {
    const API_KEY = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_NAME = "Config";

    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    const data = await res.json();

    if (!data.records) throw new Error("Нет записей в конфиге");

    const cfg = {};
    data.records.forEach((r) => {
      const k = r.fields.key;
      const v = r.fields.value;
      if (k) cfg[k] = v;
    });
    return cfg;
  } catch (e) {
    console.error("⚠️ Ошибка загрузки конфигурации из Airtable:", e);
    return { gpt_model: "gpt-4-1106-preview", temperature: 0.7, language: "ru" }; // дефолт
  }
}

/* === 🧠 Память последних сообщений === */
let conversationMemory = [];

function updateMemory(user, assistant) {
  conversationMemory.push({ role: "user", content: user });
  conversationMemory.push({ role: "assistant", content: assistant });
  if (conversationMemory.length > 6) conversationMemory = conversationMemory.slice(-6);
}

/* === 🚀 Основная функция === */
exports.handler = async (event) => {
  try {
    /* === 1️⃣ Загружаем текущие настройки === */
    const cfg = await getCurrentConfig();
    const gptModel = cfg.gpt_model || "gpt-4-1106-preview";
    const gptTemperature = parseFloat(cfg.temperature) || 0.7;
    const gptLanguage = cfg.language || "ru";

    console.log("🧩 Используем:", gptModel, "| T:", gptTemperature, "| Lang:", gptLanguage);

    /* === 2️⃣ Получаем вход пользователя === */
    const body = JSON.parse(event.body || "{}");
    const userText = body.text || "";
    const isFirst = body.shouldGreet === true || body.shouldGreet === "true";
    let transcript = userText;

    if (body.audio) {
      const audioBuffer = Buffer.from(body.audio, "base64");
      const tempPath = path.join("/tmp", `audio-${Date.now()}.webm`);
      fs.writeFileSync(tempPath, audioBuffer);

      const resp = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "whisper-1",
      });
      transcript = resp.text;
    }

    if (!transcript || transcript.trim().length < 2) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          text: "Я не расслышал. Попробуйте ещё раз.",
          transcript: transcript || "…",
          matches: 0,
        }),
      };
    }

    /* === 3️⃣ Загружаем промпты и CSV === */
    const prompt1URL =
      "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt";
    const prompt2URL =
      "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const csvURL =
      "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

    const [prompt1, prompt2, csvText] = await Promise.all([
      fetch(prompt1URL).then((r) => r.text()),
      fetch(prompt2URL).then((r) => r.text()),
      fetch(csvURL).then((r) => r.text()),
    ]);

    /* === 4️⃣ Анализируем запрос === */
    const analysis = await openai.chat.completions.create({
      model: gptModel,
      temperature: gptTemperature,
      messages: [
        { role: "system", content: prompt1 },
        { role: "user", content: `Что хочет пользователь: "${transcript}"? Верни JSON.` },
      ],
    });

    let parsedAnalysis = {};
    const rawAnalysis = analysis.choices?.[0]?.message?.content || "";

    try {
      parsedAnalysis = JSON.parse(rawAnalysis);
    } catch (err) {
      console.warn("⚠️ Ошибка JSON:", rawAnalysis);
      const match = rawAnalysis.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsedAnalysis = JSON.parse(match[0]);
        } catch (err2) {
          parsedAnalysis = { intent: "clarify", message: "Ошибка парсинга JSON." };
        }
      } else {
        parsedAnalysis = { intent: "clarify", message: "Пустой или нераспознанный JSON." };
      }
    }

    const intent = parsedAnalysis.intent || "clarify";
    const filters = parsedAnalysis.filters || {};
    const clarifyMessage = parsedAnalysis.message || "";

    /* === 5️⃣ Парсим базу недвижимости === */
    const parsed = Papa.parse(csvText, { header: true }).data;

    function buildGlobalStats(data) {
      const valid = data.filter((r) => r["общая цена (€)"] && r["площадь (м²)"]);
      const prices = valid.map((r) => parseFloat(r["общая цена (€)"]));
      const areas = valid.map((r) => parseFloat(r["площадь (м²)"]));
      const pricePerM2 = valid
        .map((r) =>
          r["цена за м² (€)"]
            ? parseFloat(r["цена за м² (€)"])
            : parseFloat(r["общая цена (€)"]) / parseFloat(r["площадь (м²)"])
        )
        .filter((x) => !isNaN(x));

      const regions = {};
      const types = {};
      valid.forEach((r) => {
        const reg = r["область"];
        const typ = r["Тип объекта"];
        if (reg) regions[reg] = (regions[reg] || 0) + 1;
        if (typ) types[typ] = (types[typ] || 0) + 1;
      });

      const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

      return {
        total_properties: valid.length,
        min_price: Math.min(...prices),
        max_price: Math.max(...prices),
        avg_price: avg(prices),
        min_area: Math.min(...areas),
        max_area: Math.max(...areas),
        avg_area: avg(areas),
        avg_price_per_m2: avg(pricePerM2),
        regions,
        types,
        most_common_type:
          Object.entries(types).sort((a, b) => b[1] - a[1])[0]?.[0] || "Апартаменты",
        most_popular_region:
          Object.entries(regions).sort((a, b) => b[1] - a[1])[0]?.[0] || "Lazio",
      };
    }

    const globalStats = buildGlobalStats(parsed);

    const relevant = parsed.filter((row) =>
      JSON.stringify(row).toLowerCase().includes(transcript.toLowerCase())
    );

    const sampleData = relevant
      .slice(0, 3)
      .map(
        (row) => `${row["Город"]} — ${row["Адрес"] || "Адрес не указан"}
${row["Площадь (м²)"]} м² — от ${row["Общая цена (€)"]} €
Сдача: ${row["Срок сдачи"] || "—"}`
      )
      .join("\n\n");

    /* === 6️⃣ Финальный ответ GPT === */
    const messages = [
      { role: "system", content: prompt2 },
      ...conversationMemory,
      {
        role: "user",
        content: JSON.stringify({
          transcript,
          intent,
          filters,
          message: clarifyMessage,
          results: sampleData,
          total: relevant.length,
          isFirst,
          globalStats,
          language: gptLanguage,
        }),
      },
    ];

    const final = await openai.chat.completions.create({
      model: gptModel,
      temperature: gptTemperature,
      messages,
    });

    const gptAnswer = final.choices?.[0]?.message?.content || "Нет ответа.";
    updateMemory(transcript, gptAnswer);

    return {
      statusCode: 200,
      body: JSON.stringify({
        text: gptAnswer,
        transcript,
        matches: relevant.length,
        model_used: gptModel,
      }),
    };
  } catch (err) {
    console.error("❌ Ошибка:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        details: err.message,
      }),
    };
  }
};
