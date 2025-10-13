import { OpenAI } from "openai";
import busboy from "busboy";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler = async (event) => {
  try {
    const contentType = event.headers["content-type"] || "";

    if (!contentType.includes("multipart/form-data")) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Expected multipart/form-data" }),
      };
    }

    const bb = busboy({
      headers: { "content-type": contentType },
    });

    let fileBuffer = [];
    let filename = "chunk.webm";
    let mimeType = "audio/webm";

    await new Promise((resolve, reject) => {
      bb.on("file", (name, file, info) => {
        filename = info.filename || filename;
        mimeType = info.mimeType || mimeType;
        file.on("data", (data) => fileBuffer.push(data));
        file.on("end", resolve);
      });
      bb.on("error", reject);
      bb.end(Buffer.from(event.body, "base64"));
    });

    const audioData = Buffer.concat(fileBuffer);

    if (!audioData || audioData.length < 500) {
      throw new Error("Audio chunk too small or missing");
    }

    const file = new File([audioData], filename, { type: mimeType });

    const result = await openai.audio.transcriptions.create({
      file,
      model: "gpt-4o-mini-transcribe",
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ text: result.text }),
    };
  } catch (error) {
    console.error("❌ Transcribe error:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Internal Server Error" }),
    };
  }
};
