// netlify/functions/whisper-search.js
import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Отключаем встроенный body parser Netlify
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Метод не поддерживается" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Парсим файл
    const form = formidable({ multiples: false });
    const [fields, files] = await form.parse(req);
    const file = files.file?.[0] || files.file;

    if (!file) {
      return new Response(JSON.stringify({ error: "Нет файла в запросе" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Отправляем в OpenAI Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(file.filepath),
      model: "whisper-1",
      language: "ru",
    });

    return new Response(JSON.stringify({ text: transcription.text }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Ошибка Whisper:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
