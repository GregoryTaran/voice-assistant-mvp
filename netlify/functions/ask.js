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
    const isFirstMessage = !!body.isFirstMessage;
    const userText = body.text || "";
    let transcript = userText;
    let whisperDebug = null;

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

    const promptURL1 = "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt";
    const promptURL2 = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const csvURL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

    const [prompt1, prompt2, csvText] = await Promise.all([
      fetch(promptURL1).then(r => r.text()),
      fetch(promptURL2).then(r => r.text()),
      fetch(csvURL).then(r => r.text())
    ]);

    const analysis = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt1 },
        { role: "user", content: `Что хочет пользователь: "${transcript}"?` }
      ]
    });

    const intent = analysis.choices[0].message.content;

    const parsed = Papa.parse(csvText, { header: true }).data;
    const relevant = parsed.filter(row =>
      JSON.stringify(row).toLowerCase().includes(transcript.toLowerCase())
    );

    const sampleData = relevant.slice(0, 3).map(row =>
      `${row.Город} — ${row.Адрес}
${row.Площадь} м² — от ${row.Цена} €`
    ).join("\n");

    const final = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt2 },
        {
          role: "user",
          content: `Запрос: ${transcript}
Интерпретация: ${intent}
Это первый запрос в сессии: ${isFirstMessage ? "да" : "нет"}
Подходящие объекты:
${sampleData || "— ничего не найдено —"}`
        }
      ]
    });

    const gptAnswer = final.choices[0].message.content || "Нет ответа.";

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
