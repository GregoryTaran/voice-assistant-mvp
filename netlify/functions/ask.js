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
    const isFirst = body.shouldGreet || false; // 👈 флаг первого запроса
    let transcript = userText;
    let whisperDebug = null;

    // === 1. Распознавание речи (если есть аудио) ===
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

    // === 2. Проверка пустого запроса ===
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

    // === 3. Загружаем оба промта и базу ===
    const prompt1URL = "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt"; // Аналитик
    const prompt2URL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt"; // Генератор
    const csvURL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

    const [prompt1, prompt2, csvText] = await Promise.all([
      fetch(prompt1URL).then(r => r.text()),
      fetch(prompt2URL).then(r => r.text()),
      fetch(csvURL).then(r => r.text())
    ]);

    // === 4. Анализ намерения пользователя ===
    const analysis = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt1 },
        { role: "user", content: `Что хочет пользователь: "${transcript}"? Верни JSON.` }
      ]
    });

    let parsedAnalysis;
    try {
      parsedAnalysis = JSON.parse(analysis.choices[0].message.content);
    } catch (e) {
      console.warn("⚠️ Ошибка парсинга JSON:", e);
      parsedAnalysis = { intent: "clarify", filters: {}, message: "Не удалось точно определить запрос." };
    }

    const intent = parsedAnalysis.intent || "clarify";
    const filters = parsedAnalysis.filters || {};
    const clarifyMessage = parsedAnalysis.message || "";

    console.log("🔎 Intent:", intent);

    // === 5. Фильтрация данных из базы ===
    const parsed = Papa.parse(csvText, { header: true }).data;
    const relevant = parsed.filter(row =>
      JSON.stringify(row).toLowerCase().includes(transcript.toLowerCase())
    );

    const sampleData = relevant.slice(0, 3).map(row =>
      `${row.Город} — ${row.Адрес}\n${row.Площадь} м² — от ${row.Цена} €`
    ).join("\n");

    // === 6. Генерация финального ответа ===
    const final = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt2 },
        {
          role: "user",
          content: JSON.stringify({
            transcript,
            intent,
            filters,
            message: clarifyMessage,
            results: sampleData,
            total: relevant.length,
            isFirst
          })
        }
      ]
    });

    let gptAnswer = final.choices[0].message.content || "Нет ответа.";

    // === 7. Принудительно добавляем приветствие при первом сообщении ===
    if (isFirst) {
      const greeting =
        "Привет! Я — Нейро-агент ХАБ. Помогаю выбрать новостройку в Италии. " +
        "Вы можете указать ваш бюджет, город или желаемую площадь. Также могу найти акции и рассрочку.";
      if (!gptAnswer.includes("Нейро-агент ХАБ")) {
        gptAnswer = `${greeting}\n\n${gptAnswer}`;
        console.log("👋 Приветствие добавлено вручную (страховка).");
      }
    }

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
      body: JSON.stringify({
        error: "Internal Server Error",
        details: err.message
      })
    };
  }
};
