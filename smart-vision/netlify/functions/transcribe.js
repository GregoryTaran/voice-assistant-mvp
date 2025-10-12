// netlify/functions/transcribe.js
// CommonJS-совместимая Netlify Function (как в твоём проекте).
// Получает JSON: { audio: <base64>, mime: 'audio/webm', ext: 'webm' }
// Декодирует и отправляет файл в OpenAI Whisper.

const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const { audio, mime, ext } = JSON.parse(event.body || "{}");
    if (!audio) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "No audio payload" }),
      };
    }

    const buffer = Buffer.from(audio, "base64");
    const extension = ext || "webm";
    const tmpFile = path.join("/tmp", `chunk.${extension}`);
    fs.writeFileSync(tmpFile, buffer);

    const resp = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      response_format: "text",
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: resp }),
    };
  } catch (err) {
    console.error("❌ Transcribe error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Transcription failed" }),
    };
  }
};
