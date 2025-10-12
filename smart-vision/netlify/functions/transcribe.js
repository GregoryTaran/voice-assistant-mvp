// netlify/functions/transcribe.js
import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export default async (req, res) => {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const audioBuffer = Buffer.from(await req.arrayBuffer());
    const tmpFile = "/tmp/chunk.wav";
    await import("fs").then(fs => fs.writeFileSync(tmpFile, audioBuffer));

    const response = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpFile),
      model: "whisper-1",
      response_format: "text",
    });

    res.status(200).json({ text: response });
  } catch (err) {
    console.error("❌ Ошибка при расшифровке:", err);
    res.status(500).json({ error: "Transcription failed" });
  }
};
