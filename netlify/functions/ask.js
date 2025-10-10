// netlify/functions/ask.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const Papa = require("papaparse");
const fetch = require("node-fetch");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* === 📡 Получить актуальные настройки из Airtable === */
async function getCurrentConfig() {
  try {
    const API_KEY = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_CONFIG = "Config";
    const TABLE_SERVERS = "WhisperServers";

    const headers = { Authorization: `Bearer ${API_KEY}` };

    // 1️⃣ Читаем таблицу Config
    const resCfg = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_CONFIG}`, { headers });
    const dataCfg = await resCfg.json();
    if (!dataCfg.records) throw new Error("Нет записей в Config");

    const cfg = {};
    dataCfg.records.forEach((r) => {
      const k = r.fields.key;
      const v = r.fields.value;
      if (k) cfg[k] = v;
    });

    // 2️⃣ Если указан whisper_server — ищем его параметры в WhisperServers
    if (cfg.whisper_server) {
      const formula = encodeURIComponent(`{id} = '${cfg.whisper_server}'`);
      const resSrv = await fetch(
        `https://api.airtable.com/v0/${BASE_ID}/${TABLE_SERVERS}?filterByFormula=${formula}`,
        { headers }
      );
      const dataSrv = await resSrv.json();
      if (dataSrv.records?.[0]) {
        const s = dataSrv.records[0].fields;
        cfg.whisper_server_url = s.url || "";
        cfg.whisper_server_name = s.name || "";
        cfg.whisper_description = s.description || "";
      }
    }

    return cfg;
  } catch (e) {
    console.error("⚠️ Ошибка загрузки конфигурации:", e);
    return {
      gpt_model: "gpt-4-1106-preview",
      temperature: 0.7,
      language: "ru",
      whisper_server: "openai",
    };
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
    // 1️⃣ Конфигурация проекта
    const cfg = await getCurrentConfig();
    const gptModel = cfg.gpt_model || "gpt-4-1106-preview";
    const gptTemperature = parseFloat(cfg.temperature) || 0.7;
    const gptLanguage = cfg.language || "ru";
    const whisperServer = cfg.whisper_server || "openai";

    console.log("🧩 Используем:", gptModel, "| Whisper:", whisperServer, "| Lang:", gptLanguage);

    // 2️⃣ Получаем вход пользователя
    const body = JSON.parse(event.body || "{}");
    const userText = body.text || "";
    const isFirst = body.shouldGreet === true || body.shouldGreet === "true";
    let transcript = userText;

    /* === 🎙 Обработка голосового ввода === */
    if (body.audio) {
      const audioBuffer = Buffer.from(body.audio, "base64");
      const tempPath = path.join("/tmp", `audio-${Date.now()}.webm`);
      fs.writeFileSync(tempPath, audioBuffer);

      // Ветвление: OpenAI Whisper или HuggingFace Fast-Whisper
      if (whisperServer === "whisper-large-v3-turbo" && cfg.whisper_server_url) {
        console.log("🎙 Используется внешний Whisper:", cfg.whisper_server_name);
        console.log("🌐 URL:", cfg.whisper_server_url);

        const response = await fetch(cfg.whisper_server_url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.HF_TOKEN}`,
            "Content-Type": "audio/webm",
          },
          body: fs.createReadStream(tempPath),
        });

        if (!response.ok) {
          const errText = await response.text();
          console.error("Ошибка Whisper HF:", errText);
          throw new Error("Ошибка внешнего Whisper сервера");
        }

        const result = await response.json();
        transcript = result.text || "";
      } else {
        console.log("🎙 Используется OpenAI Whisper");
        const resp = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tempPath),
          model: "whisper-1",
        });
        transcript = resp.text;
      }
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

    // 3️⃣ Загружаем промпты и CSV
    const [prompt1, prompt2, csvText] = await Promise.all([
      fetch("https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt").then((r) => r.text()),
      fetch("https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt").then((r) => r.text()),
      fetch("https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv").then((r) => r.text()),
    ]);

    // 4️⃣ Анализируем запрос
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
    } catch {
      console.warn("⚠️ Ошибка JSON:", rawAnalysis);
      parsedAnalysis = { intent: "clarify", message: "Ошибка парсинга JSON." };
    }

    const intent = parsedAnalysis.intent || "clarify";
    const filters = parsedAnalysis.filters || {};
    const clarifyMessage = parsedAnalysis.message || "";

    // 5️⃣ Парсим базу недвижимости
    const parsed = Papa.parse(csvText, { header: true }).data;
    const valid = parsed.filter((r) => r["общая цена (€)"] && r["площадь (м²)"]);
    const avg = (arr) => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
    const prices = valid.map((r) => parseFloat(r["общая цена (€)"]));
    const areas = valid.map((r) => parseFloat(r["площадь (м²)"]));
    const globalStats = {
      total_properties: valid.length,
      avg_price: avg(prices),
      avg_area: avg(areas),
    };

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

    // 6️⃣ Финальный ответ GPT
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
        whisper_used: whisperServer,
        whisper_url: cfg.whisper_server_url || "openai",
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
