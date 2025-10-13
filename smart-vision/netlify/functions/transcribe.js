import { OpenAI } from "openai";
import busboy from "busboy";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  try {
    // Проверяем тип контента
    const contentType = event.headers["content-type"] || "";

    // === 🔹 Если пришёл JSON base64 ===
    if (contentType.includes("application/json")) {
      const body = JSON.parse(event.body || "{}");
      const { audio, mime, ext } = body;
      if (!audio) throw new Error("Нет поля audio в теле запроса");

      const buffer = Buffer.from(audio, "base64");

      const response = await openai.audio.transcriptions.create({
        file: new File([buffer], `record.${ext || "webm"}`, { type: mime || "audio/webm" }),
        model: "gpt-4o-mini-transcribe",
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ text: response.text }),
      };
    }

    // === 🔹 Если пришёл FormData (multipart/form-data) ===
    if (contentType.includes("multipart/form-data")) {
      const bb = busboy({
        headers: { "content-type": contentType },
      });

      let chunks = [];
      let filename = "chunk.webm";
      let mimeType = "audio/webm";

      await new Promise((resolve, reject) => {
        bb.on("file", (name, file, info) => {
          filename = info.filename || filename;
          mimeType = info.mimeType || mimeType;
          file.on("data", (data) => chunks.push(data));
          file.on("end", () => resolve());
        });
        bb.on("error", reject);
        bb.end(Buffer.from(event.body, "base64"));
      });

      const buffer = Buffer.concat(chunks);

      const response = await openai.audio.transcriptions.create({
        file: new File([buffer], filename, { type: mimeType }),
        model: "gpt-4o-mini-transcribe",
      });

      return {
        statusCode: 200,
        body: JSON.stringify({ text: response.text }),
      };
    }

    // === ⚠️ Иначе неизвестный тип запроса
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Unsupported content-type" }),
    };
  } catch (error) {
    console.error("❌ Transcribe error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
