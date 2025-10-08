require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const Papa = require("papaparse");
const fetch = require("node-fetch");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const userText = body.text || "";
    const isFirstMessage = body.isFirstMessage || false; // 🟡 Новый флаг
    let transcript = userText;
    let whisperDebug = null;

    // === 1. Распознавание речи, если есть аудио ===
    if (body.audio) {
      const audioBuffer = Buffer.from(body.audio, "base64");
      const tempPath = path.join("/tmp", `audio-${Date.now()}.webm`);
      fs.writeFileSync(tempPath, audioBuffer);

      const resp = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "whisper-1"
      });

      whisperDebug = resp;
      transcript = resp.text;
    }

    console.log("📥 Transcript:", transcript);

    // === 2. Если ничего не распознано — отвечаем сразу ===
    if (!transcript || transcript.trim().length < 2) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          text: "Я не расслышал. Попробуйте ещё раз.",
          transcript: transcript || "…",
          whisper: whisperDebug?.text || null,
          matches: 0
        })
      };
    }

    // === 3. Загрузка промпта и базы ===
    const promptIntentURL = "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt";
    const promptFinalURL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const csvURL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

    const [intentPromptText, finalPromptText, csvText] = await Promise.all([
      fetch(promptIntentURL).then(r => r.text()),
      fetch(promptFinalURL).then(r => r.text()),
      fetch(csvURL).then(r => r.text())
    ]);

    // === 4. Анализ намерения запроса ===
    const analysis = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: intentPromptText },
        { role: "user", content: `Что хочет пользователь: "${transcript}"?` }
      ]
    });

    const intent = analysis.choices[0].message.content;
    console.log("🔎 Intent:", intent);

    // === 5. Фильтрация базы ===
    const parsed = Papa.parse(csvText, { header: true }).data;
    const relevant = parsed.filter(row =>
      JSON.stringify(row).toLowerCase().includes(transcript.toLowerCase())
    );

    const sampleData = relevant.slice(0, 3).map(row =>
      `${row.Город} — ${row.Адрес}
${row.Площадь} м² — от ${row.Цена} €`
    ).join("\n");

    // === 6. Генерация финального ответа ===
    const final = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: finalPromptText },
        {
          role: "user",
          content: `Запрос: ${transcript}
Интерпретация: ${intent}
Первое сообщение: ${isFirstMessage ? "да" : "нет"}
Подходящие объекты:
${sampleData || "— ничего не найдено —"}`
        }
      ]
    });

    const gptAnswer = final.choices[0].message.content || "Нет ответа.";
    console.log("💬 Ответ GPT:", gptAnswer);

    return {
      statusCode: 200,
      body: JSON.stringify({
        text: gptAnswer,
        transcript,
        whisper: whisperDebug?.text || null,
        matches: relevant.length,
        rawGpt: gptAnswer
      })
    };

  } catch (err) {
    console.error("❌ Ошибка в ask.js:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: err.message })
    };
  }
};
