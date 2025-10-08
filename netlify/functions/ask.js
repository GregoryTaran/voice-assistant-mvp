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
    
    // ✅ Исправлено: теперь флаг всегда преобразуется в boolean
    const isFirst = body.shouldGreet === true || body.shouldGreet === "true";

    let transcript = userText;

    // 🎤 Распознавание аудио (если пришёл аудиофайл)
    if (body.audio) {
      const audioBuffer = Buffer.from(body.audio, "base64");
      const tempPath = path.join("/tmp", `audio-${Date.now()}.webm`);
      fs.writeFileSync(tempPath, audioBuffer);

      const resp = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "whisper-1"
      });

      transcript = resp.text;
    }

    // ⚠️ Проверка: если текст пустой или слишком короткий
    if (!transcript || transcript.trim().length < 2) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          text: "Я не расслышал. Попробуйте ещё раз.",
          transcript: transcript || "…",
          matches: 0
        })
      };
    }

    // 📄 Промты и база
    const prompt1URL = "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt";
    const prompt2URL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const csvURL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

    const [prompt1, prompt2, csvText] = await Promise.all([
      fetch(prompt1URL).then(r => r.text()),
      fetch(prompt2URL).then(r => r.text()),
      fetch(csvURL).then(r => r.text())
    ]);

    // 🧠 Анализ запроса (первый GPT)
    const analysis = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt1 },
        { role: "user", content: `Что хочет пользователь: "${transcript}"? Верни JSON.` }
      ]
    });

    const parsedAnalysis = JSON.parse(analysis.choices[0].message.content);
    const intent = parsedAnalysis.intent || "clarify";
    const filters = parsedAnalysis.filters || {};
    const clarifyMessage = parsedAnalysis.message || "";

    // 📊 Обработка базы данных (Google Sheets)
    const parsed = Papa.parse(csvText, { header: true }).data;
    const relevant = parsed.filter(row =>
      JSON.stringify(row).toLowerCase().includes(transcript.toLowerCase())
    );

    const sampleData = relevant.slice(0, 3).map(row =>
      `${row.Город} — ${row.Адрес}
${row.Площадь} м² — от ${row.Цена} €
Сдача: ${row.Срок || "—"}`
    ).join("\n\n");

    // 🗣️ Генерация финального ответа (второй GPT)
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

    const gptAnswer = final.choices[0].message.content || "Нет ответа.";

    // ✅ Финальный ответ клиенту
    return {
      statusCode: 200,
      body: JSON.stringify({
        text: gptAnswer,
        transcript,
        matches: relevant.length
      })
    };

  } catch (err) {
    console.error("❌ Ошибка:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        details: err.message
      })
    };
  }
};
