// netlify/functions/whisper-search.js
import OpenAI from "openai";
import formidable from "formidable";
import fs from "fs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Отключаем стандартный body parser Netlify
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async (req) => {
  if (req.method !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Метод не поддерживается" }),
    };
  }

  try {
    const form = formidable({ multiples: false });
    const [fields, files] = await form.parse(req);

    const file = files.file?.[0] || files.file;
    if (!file) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Нет файла в запросе" }),
      };
    }

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(file.filepath),
      model: "whisper-1",
      language: "ru",
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ text: transcription.text }),
    };
  } catch (error) {
    console.error("Ошибка Whisper:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
