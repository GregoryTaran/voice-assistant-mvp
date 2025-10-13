import { OpenAI } from "openai";
import Busboy from "busboy";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    // --- Парсим FormData через Busboy ---
    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing content-type header" }) };
    }

    const busboy = Busboy({ headers: { "content-type": contentType } });

    return await new Promise((resolve, reject) => {
      let fileBuffer = null;
      let fileMime = null;

      busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
        console.log(`🎧 Получен файл ${filename} (${mimetype})`);
        const chunks = [];
        fileMime = mimetype;

        file.on("data", (data) => chunks.push(data));
        file.on("end", () => {
          fileBuffer = Buffer.concat(chunks);
        });
      });

      busboy.on("finish", async () => {
        if (!fileBuffer || fileBuffer.length === 0) {
          return resolve({
            statusCode: 400,
            body: JSON.stringify({ error: "Empty or missing audio file" }),
          });
        }

        try {
          console.log("📤 Отправляем в Whisper, размер:", fileBuffer.length, "байт");

          const response = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file: new Blob([fileBuffer], { type: fileMime || "audio/webm" }),
          });

          console.log("✅ Whisper ответ:", response.text);

          resolve({
            statusCode: 200,
            body: JSON.stringify({ text: response.text }),
          });
        } catch (err) {
          console.error("❌ Whisper error:", err);
          resolve({
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
          });
        }
      });

      busboy.on("error", (err) => {
        console.error("❌ Busboy error:", err);
        reject({ statusCode: 500, body: JSON.stringify({ error: "Busboy failed" }) });
      });

      busboy.end(Buffer.from(event.body, "base64"));
    });
  } catch (err) {
    console.error("❌ Transcribe crash:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
