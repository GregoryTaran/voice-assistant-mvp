// netlify/functions/transcribe.js
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = {
  runtime: "nodejs20"
};

export default async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method Not Allowed" })
      };
    }

    // Бинарное тело приходит в base64
    const audioBuffer = Buffer.from(event.body, "base64");

    if (!audioBuffer || audioBuffer.length < 1000) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Empty or invalid audio" })
      };
    }

    // Отправляем в Whisper
    const response = await openai.audio.transcriptions.create({
      file: new File([audioBuffer], "chunk.ogg", { type: "audio/ogg" }),
      model: "gpt-4o-mini-transcribe"
    });

    console.log("✅ Whisper:", response.text);
    return {
      statusCode: 200,
      body: JSON.stringify({ text: response.text })
    };
  } catch (err) {
    console.error("❌ Transcribe error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: err.message || "Internal Server Error",
        details: err
      })
    };
  }
}
