import { OpenAI } from "openai";
import Busboy from "busboy";
import fs from "fs";
import os from "os";
import path from "path";
import ffmpeg from "fluent-ffmpeg";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const contentType = event.headers["content-type"] || event.headers["Content-Type"];
    if (!contentType) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing content-type header" }) };
    }

    return await new Promise((resolve, reject) => {
      const busboy = Busboy({ headers: { "content-type": contentType } });
      let tmpWebm = null;
      let tmpOgg = null;

      busboy.on("file", (fieldname, file, filename) => {
        tmpWebm = path.join(os.tmpdir(), `${Date.now()}-${filename || "audio.webm"}`);
        tmpOgg = tmpWebm.replace(".webm", ".ogg");
        const stream = fs.createWriteStream(tmpWebm);
        file.pipe(stream);
      });

      busboy.on("finish", async () => {
        if (!tmpWebm || !fs.existsSync(tmpWebm)) {
          return resolve({
            statusCode: 400,
            body: JSON.stringify({ error: "Audio file missing" }),
          });
        }

        try {
          console.log("🎧 Конвертируем в OGG...");
          await new Promise((res, rej) => {
            ffmpeg(tmpWebm)
              .output(tmpOgg)
              .audioCodec("libopus")
              .on("end", res)
              .on("error", rej)
              .run();
          });

          console.log("✅ Конвертация завершена:", tmpOgg);

          const response = await openai.audio.transcriptions.create({
            model: "gpt-4o-mini-transcribe",
            file: fs.createReadStream(tmpOgg),
          });

          console.log("✅ Whisper OK:", response.text);

          resolve({
            statusCode: 200,
            body: JSON.stringify({ text: response.text }),
          });
        } catch (err) {
          console.error("❌ Whisper failed:", err);
          resolve({
            statusCode: 500,
            body: JSON.stringify({ error: err.message }),
          });
        } finally {
          try {
            fs.unlinkSync(tmpWebm);
            fs.unlinkSync(tmpOgg);
          } catch {}
        }
      });

      busboy.on("error", (err) => reject(err));
      busboy.end(Buffer.from(event.body, "base64"));
    });
  } catch (err) {
    console.error("❌ Handler crash:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
