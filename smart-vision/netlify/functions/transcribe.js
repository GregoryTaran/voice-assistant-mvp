import { OpenAI } from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = {
  runtime: "nodejs20"
};

export default async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method Not Allowed" });
    }

    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const audioBuffer = Buffer.concat(buffers);

    if (!audioBuffer || audioBuffer.length < 1000) {
      return res.status(400).json({ error: "Empty or invalid audio" });
    }

    const response = await openai.audio.transcriptions.create({
      file: new File([audioBuffer], "chunk.ogg", { type: "audio/ogg" }),
      model: "gpt-4o-mini-transcribe"
    });

    console.log("✅ Whisper:", response.text);
    return res.status(200).json({ text: response.text });
  } catch (err) {
    console.error("❌ Transcribe error:", err);
    return res.status(500).json({
      error: err.message || "Internal Server Error",
      details: err
    });
  }
};
