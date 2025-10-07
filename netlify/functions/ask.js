const fetch = require("node-fetch");
const FormData = require("form-data");
const Papa = require("papaparse");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 🔗 Источники
const DOCS_URL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

// 🔧 fallback-промт если Google Docs не загрузился
const FALLBACK_PROMPT = `
Ты — голосовой помощник по недвижимости.
Если пользователь просто здоровается — ответь вежливо.
Если он спрашивает о квартирах, городах или ценах — найди подходящие данные в базе.
Если ничего не найдено — предложи другой город или диапазон цены.
`;

exports.handler = async (event) => {
  try {
    const { audio, userText = "", sessionId = "", history = [] } = JSON.parse(event.body || "{}");
    let transcript = userText;

    // 🎤 Распознавание речи через Whisper
    if (audio) {
      const audioBuffer = Buffer.from(audio, "base64");
      const form = new FormData();
      form.append("file", audioBuffer, { filename: "audio.webm", contentType: "audio/webm" });
      form.append("model", "whisper-1");

      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form
      });

      const whisperData = await whisperRes.json();
      transcript = whisperData.text || "";
    }

    if (!transcript) {
      return { statusCode: 200, body: JSON.stringify({ text: "Я не расслышал, повторите, пожалуйста.", transcript: "" }) };
    }

    // 🧾 Загружаем промт
    let promptText = FALLBACK_PROMPT;
    try {
      const res = await fetch(DOCS_URL);
      const txt = await res.text();
      if (txt && txt.length > 20) promptText = txt;
    } catch (e) {
      console.log("⚠️ Google Docs не загрузился, используется fallback.");
    }

    // 📊 Загружаем базу
    let data = [];
    try {
      const csvText = await fetch(SHEET_URL).then(r => r.text());
      const parsed = Papa.parse(csvText, { header: true });
      data = parsed.data.slice(0, 50); // ограничим до 50 строк
    } catch (e) {
      console.log("⚠️ Ошибка загрузки Google Sheets:", e.message);
    }

    // 🧠 Формируем сообщение для GPT
    const messages = [
      { role: "system", content: promptText },
      ...history.slice(-10),
      {
        role: "user",
        content: `Пользователь сказал: "${transcript}". 
Вот первые записи базы данных новостроек (CSV): ${JSON.stringify(data.slice(0, 10))}.
Ответь понятно и по существу.`
      }
    ];

    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: "gpt-3.5-turbo", messages, temperature: 0.7 })
    });

    const gptData = await gptRes.json();
    let finalAnswer = gptData.choices?.[0]?.message?.content?.trim() || "";

    // 🔁 fallback, если GPT не ответил
    if (!finalAnswer) {
      console.log("⚠️ GPT не дал ответ, пробуем fallback.");
      finalAnswer = "Не нашёл подходящий ответ. Попробуйте уточнить запрос — например, город или цену.";
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ text: finalAnswer, transcript })
    };
  } catch (err) {
    console.error("❌ Ошибка функции:", err.message);
    return { statusCode: 500, body: JSON.stringify({ text: "Ошибка на сервере", error: err.message }) };
  }
};
