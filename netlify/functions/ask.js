require("dotenv").config();

const { OpenAI } = require("openai");
const Papa = require("papaparse");
const fetch = require("node-fetch");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const userText = body.text || "";
    let transcript = userText;
    let whisperDebug = null;

    // Если пришло аудио — распознаём через Whisper
    if (body.audio) {
      const audioBuffer = Buffer.from(body.audio, "base64");

      // Whisper — распознавание
      const resp = await openai.audio.transcriptions.create({
        file: await openai.files.createReadStream(audioBuffer, "input.webm"),
        model: "whisper-1"
      });

      whisperDebug = resp;
      console.log("Whisper response:", resp);
      transcript = resp.text;
    }

    console.log("Final transcript:", transcript);

    // Если речь не распознана / слишком короткая — возврат сразу
    if (!transcript || transcript.trim().length < 2) {
      console.log("⛔ Whisper не расслышал речь или распознал пусто.");
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

    // Загружаем промпт и базу
    const promptURL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const csvURL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

    const [promptText, csvText] = await Promise.all([
      fetch(promptURL).then(r => r.text()),
      fetch(csvURL).then(r => r.text())
    ]);

    // Этап 1 — Анализ запроса
    const analysis = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: promptText },
        { role: "user", content: `Что хочет пользователь: "${transcript}"?` }
      ]
    });

    const intent = analysis.choices[0].message.content;
    console.log("Intent:", intent);

    // Этап 2 — Фильтрация базы
    const parsed = Papa.parse(csvText, { header: true }).data;
    const relevant = parsed.filter(row =>
      JSON.stringify(row).toLowerCase().includes(transcript.toLowerCase())
    );

    const sampleData = relevant.slice(0, 3).map(row =>
      `${row.Город} — ${row.Адрес}
${row.Площадь} м² — от ${row.Цена} €`
    ).join("\n");

    // Этап 3 — Ответ
    const final = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: promptText },
        {
          role: "user",
          content: `Запрос: ${transcript}
Интерпретация: ${intent}
Подходящие объекты:
${sampleData || "— ничего не найдено —"}`
        }
      ]
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        text: final.choices[0].message.content || "Нет ответа.",
        transcript,
        whisper: whisperDebug?.text || null,
        matches: relevant.length
      })
    };

  } catch (err) {
    console.error("Ошибка в ask.js:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: err.message })
    };
  }
};
