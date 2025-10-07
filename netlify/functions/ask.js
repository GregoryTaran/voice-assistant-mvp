// Новый ask.js для голосового ассистента с:
// - Whisper (Speech-to-Text)
// - GPT-анализом намерения
// - подключением Google Docs для system prompts
// - фильтрацией базы из Google Sheets
// - повторным GPT-запросом для формирования ответа
// - историей из localStorage (по sessionId)

const fetch = require("node-fetch");
const FormData = require("form-data");
const { Readable } = require("stream");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";
const GOOGLE_DOC_PROMPTS_URL = "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt";

exports.handler = async (event) => {
  try {
    const { audio, history = [], sessionId = "anon" } = JSON.parse(event.body);

    // 1. Распознаём речь через Whisper
    const audioBuffer = Buffer.from(audio, "base64");
    const form = new FormData();
    form.append("file", Readable.from(audioBuffer), { filename: "audio.webm" });
    form.append("model", "whisper-1");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: form,
    });
    const whisperData = await whisperRes.json();
    const userText = whisperData.text;

    // 2. Загружаем system prompts из Google Docs
    const promptsTxt = await fetch(GOOGLE_DOC_PROMPTS_URL).then(res => res.text());
    const prompt1 = promptsTxt.split("### systemPrompt1")[1].split("###")[0].trim();
    const prompt2 = promptsTxt.split("### systemPrompt2")[1]?.trim();

    // 3. GPT-анализ: нужно ли обращаться к базе?
    const firstMessages = [
      { role: "system", content: prompt1 },
      ...history.slice(-10),
      { role: "user", content: userText },
    ];

    const gpt1 = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: firstMessages,
      }),
    }).then(r => r.json());

    const intentAnswer = gpt1.choices?.[0]?.message?.content || "";

    // 4. Если GPT просит базу — загружаем и фильтруем
    let finalAnswer = intentAnswer;
    if (intentAnswer.toLowerCase().includes("баз")) {
      const csvText = await fetch(GOOGLE_SHEET_CSV_URL).then(r => r.text());
      const rows = csvText.split("\n").slice(1).map(r => r.split(","));

      // Простейшая фильтрация по ключевым словам
      const filtered = rows.filter(r => {
        const rowText = r.join(" ").toLowerCase();
        return userText.toLowerCase().split(" ").some(w => rowText.includes(w));
      });

      const formatted = filtered.map((r, i) => `${i + 1}) ${r.join(" | ")}`).join("\n");

      const finalMessages = [
        { role: "system", content: prompt2 },
        ...history.slice(-10),
        { role: "user", content: userText },
        { role: "assistant", content: `Вот найденные объекты:\n${formatted}` },
      ];

      const gpt2 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-3.5-turbo",
          messages: finalMessages,
        }),
      }).then(r => r.json());

      finalAnswer = gpt2.choices?.[0]?.message?.content || intentAnswer;
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        text: finalAnswer,
        transcript: userText,
        sessionId,
      }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
