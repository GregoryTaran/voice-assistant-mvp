// netlify/functions/transcribe.js
import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = {
  runtime: "nodejs20"
};

export default async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method Not Allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    // Читаем бинарное тело (Base64)
    const audioBuffer = Buffer.from(event.body, "base64");
    if (!audioBuffer || audioBuffer.length < 1000) {
      return new Response(
        JSON.stringify({ error: "Empty or invalid audio" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Whisper
    const response = await openai.audio.transcriptions.create({
      file: new File([audioBuffer], "chunk.ogg", { type: "audio/ogg" }),
      model: "gpt-4o-mini-transcribe"
    });

    console.log("✅ Whisper:", response.text);

    return new Response(
      JSON.stringify({ text: response.text }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("❌ Transcribe error:", err);
    return new Response(
      JSON.stringify({
        error: err.message || "Internal Server Error",
        details: err
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
