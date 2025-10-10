// netlify/functions/ask.js
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const Papa = require("papaparse");
const fetch = require("node-fetch");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/* ---------- utils: CSV fields (разные варианты названий) ---------- */
const FIELDS = {
  priceTotal: ["Общая цена (€)", "общая цена (€)", "Общая цена", "Цена", "Цена (€)"],
  area: ["Площадь (м²)", "площадь (м²)", "Площадь", "м2", "м²"],
  pricePerM2: ["Цена за м² (€)", "цена за м² (€)", "Цена за м²", "€/м²"],
  city: ["Город", "город"],
  address: ["Адрес", "адрес"],
  deadline: ["Срок сдачи", "срок сдачи", "Сдача"],
  region: ["область", "Область", "Регион", "регион"],
  type: ["Тип объекта", "тип объекта", "Тип", "тип"]
};

function getField(row, variants) {
  for (const key of variants) {
    if (row && Object.prototype.hasOwnProperty.call(row, key)) {
      const v = row[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
  }
  return undefined;
}

function toNum(val) {
  if (val === undefined || val === null) return null;
  let s = String(val).replace(/\s+/g, "");
  // оставим цифры, запятые и точки
  s = s.replace(/[^0-9.,\-]/g, "");
  // если и запятая и точка — оставим последнюю как десятичный разделитель
  if (s.indexOf(",") !== -1 && s.indexOf(".") !== -1) {
    // чаще в ЕС запятая — десятичная
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(",", ".");
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function avg(arr) {
  const nums = arr.filter((x) => typeof x === "number" && !isNaN(x));
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/* ---------- Airtable config ---------- */
async function getCurrentConfig() {
  try {
    const API_KEY = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_CONFIG = "Config";
    const TABLE_SERVERS = "WhisperServers";

    const headers = { Authorization: `Bearer ${API_KEY}` };

    // Config
    const resCfg = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_CONFIG}`, { headers });
    const dataCfg = await resCfg.json();
    if (!dataCfg.records) throw new Error("Нет записей в Config");

    const cfg = {};
    dataCfg.records.forEach((r) => {
      const k = r.fields.key;
      const v = r.fields.value;
      if (k) cfg[k] = v;
    });

    // Whisper server details
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
      whisper_server: "openai"
    };
  }
}

/* ---------- краткая память ---------- */
let conversationMemory = [];
function updateMemory(user, assistant) {
  conversationMemory.push({ role: "user", content: user });
  conversationMemory.push({ role: "assistant", content: assistant });
  if (conversationMemory.length > 6) conversationMemory = conversationMemory.slice(-6);
}

/* ---------- Lambda entry ---------- */
exports.handler = async (event) => {
  try {
    // 1) конфиг
    const cfg = await getCurrentConfig();
    const gptModel = cfg.gpt_model || "gpt-4-1106-preview";
    const gptTemperature = parseFloat(cfg.temperature) || 0.7;
    const gptLanguage = cfg.language || "ru";
    const whisperServer = cfg.whisper_server || "openai";

    console.log("🧩 GPT:", gptModel, "| T:", gptTemperature, "| Lang:", gptLanguage, "| Whisper:", whisperServer);
    console.log("🔑 HF_TOKEN присутстует:", !!process.env.HF_TOKEN);

    // 2) вход
    const body = JSON.parse(event.body || "{}");
    const userText = body.text || "";
    const isFirst = body.shouldGreet === true || body.shouldGreet === "true";
    let transcript = userText;

    // 3) распознавание речи
    if (body.audio) {
      const audioBuffer = Buffer.from(body.audio, "base64");
      const tempPath = path.join("/tmp", `audio-${Date.now()}.webm`);
      fs.writeFileSync(tempPath, audioBuffer);

      if (whisperServer === "whisper-large-v3-turbo" && cfg.whisper_server_url) {
        try {
          console.log("🎙 HF Whisper:", cfg.whisper_server_name, "→", cfg.whisper_server_url);
          const response = await fetch(cfg.whisper_server_url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.HF_TOKEN}`,
              "Content-Type": "audio/webm"
            },
            body: fs.createReadStream(tempPath)
          });

          if (!response.ok) {
            const errText = await response.text().catch(() => "");
            console.error("❌ HF Whisper error:", errText || response.status);
            throw new Error("HF Whisper failed");
          }

          // предполагаем JSON { text: "..." }
          let result;
          try {
            result = await response.json();
          } catch (e) {
            console.error("❌ HF JSON parse error:", e);
            throw e;
          }
          transcript = result.text || result.transcript || "";
          console.log("🎧 HF распознано:", transcript);
        } catch (err) {
          console.warn("⚠️ HF Whisper недоступен → fallback OpenAI");
          const resp = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: "whisper-1"
          });
          transcript = resp.text;
          console.log("🎧 OpenAI распознано:", transcript);
        }
      } else {
        console.log("🎙 OpenAI Whisper");
        const resp = await openai.audio.transcriptions.create({
          file: fs.createReadStream(tempPath),
          model: "whisper-1"
        });
        transcript = resp.text;
        console.log("🎧 OpenAI распознано:", transcript);
      }
    }

    if (!transcript || String(transcript).trim().length < 2) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          text: "Я не расслышал. Попробуйте ещё раз.",
          transcript: transcript || "…",
          matches: 0
        })
      };
    }

    // 4) промпты и CSV
    const [prompt1, prompt2, csvText] = await Promise.all([
      fetch("https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt").then(r => r.text()),
      fetch("https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt").then(r => r.text()),
      fetch("https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv").then(r => r.text())
    ]);

    // 5) анализ запроса
    const analysis = await openai.chat.completions.create({
      model: gptModel,
      temperature: gptTemperature,
      messages: [
        { role: "system", content: prompt1 },
        { role: "user", content: `Что хочет пользователь: "${transcript}"? Верни JSON.` }
      ]
    });

    let parsedAnalysis = {};
    const rawAnalysis = analysis.choices?.[0]?.message?.content || "";
    try {
      parsedAnalysis = JSON.parse(rawAnalysis);
    } catch {
      console.warn("⚠️ Анализ JSON не распарсился, сырой ответ:", rawAnalysis);
      parsedAnalysis = { intent: "clarify", message: "Ошибка парсинга JSON." };
    }

    const intent = parsedAnalysis.intent || "clarify";
    const filters = parsedAnalysis.filters || {};
    const clarifyMessage = parsedAnalysis.message || "";

    // 6) парсинг CSV + защитные вычисления
    const rows = Papa.parse(csvText, { header: true }).data || [];
    const validRows = rows.filter((r) => {
      const p = toNum(getField(r, FIELDS.priceTotal));
      const a = toNum(getField(r, FIELDS.area));
      return p !== null && a !== null;
    });

    const prices = validRows.map((r) => toNum(getField(r, FIELDS.priceTotal))).filter((x) => x !== null);
    const areas = validRows.map((r) => toNum(getField(r, FIELDS.area))).filter((x) => x !== null);

    const globalStats = {
      total_properties: validRows.length,
      avg_price: avg(prices),
      avg_area: avg(areas)
    };

    const transcriptLower = String(transcript).toLowerCase();
    const relevant = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(transcriptLower));

    const sampleData = relevant.slice(0, 3).map((row) => {
      const city = getField(row, FIELDS.city) || "Город";
      const addr = getField(row, FIELDS.address) || "Адрес не указан";
      const area = getField(row, FIELDS.area) || "—";
      const price = getField(row, FIELDS.priceTotal) || "—";
      const deadline = getField(row, FIELDS.deadline) || "—";
      return `${city} — ${addr}
${area} м² — от ${price} €
Сдача: ${deadline}`;
    }).join("\n\n");

    // 7) финальный ответ
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
          language: gptLanguage
        })
      }
    ];

    const final = await openai.chat.completions.create({
      model: gptModel,
      temperature: gptTemperature,
      messages
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
        whisper_url: cfg.whisper_server_url || "openai"
      })
    };
  } catch (err) {
    console.error("❌ Ошибка:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: err.message })
    };
  }
};
