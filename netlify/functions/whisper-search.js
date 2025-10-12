// netlify/functions/whisper-search.js
import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Отключаем автоматический body-parser Netlify для работы с формами
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Метод не поддерживается" });
    return;
  }

  try {
    const form = formidable({ multiples: false });
    const [fields, files] = await form.parse(req);

    const file = files.file?.[0] || files.file;
    if (!file) {
      res.status(400).json({ error: "Нет файла в запросе" });
      return;
    }

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(file.filepath),
      model: "whisper-1",
      language: "ru",
    });

    res.status(200).json({ text: transcription.text });
  } catch (error) {
    console.error("Ошибка Whisper:", error);
    res.status(500).json({ error: error.message });
  }
};
