// smart-vision/netlify/functions/transcribe.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async (request) => {
  try {
    if (request.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method Not Allowed" }),
        { status: 405 }
      );
    }

    const base64 = await request.text();
    const buffer = Buffer.from(base64, "base64");

    const response = await openai.audio.transcriptions.create({
      file: new File([buffer], "chunk.webm", { type: "audio/webm" }),
      model: "gpt-4o-mini-transcribe"
    });

    return new Response(
      JSON.stringify({ text: response.text }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("❌ Transcribe error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500 }
    );
  }
};
