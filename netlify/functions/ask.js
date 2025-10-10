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

      // Попробуем сначала внешний Whisper
      if (whisperServer === "whisper-large-v3-turbo" && cfg.whisper_server_url) {
        try {
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
            console.error("❌ Ошибка Whisper HF:", errText);
            throw new Error("HF Whisper failed");
          }

          const result = await response.json();
          transcript = result.text || "";
        } catch (err) {
          console.warn("⚠️ HF Whisper недоступен — fallback → OpenAI Whisper");
          const resp = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempPath),
            model: "whisper-1",
          });
          transcript = resp.text;
        }
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
