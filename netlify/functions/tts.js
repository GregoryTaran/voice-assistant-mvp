require("dotenv").config();
const fetch = require("node-fetch");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { text } = JSON.parse(event.body || "{}");
  if (!text) {
    return { statusCode: 400, body: "No text provided" };
  }

  const apiKey = process.env.GOOGLE_API_KEY;
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;

  const body = {
    input: { text },
    voice: {
      languageCode: "ru-RU",
      name: "ru-RU-Wavenet-A" // можно позже поменять на другой голос
    },
    audioConfig: {
      audioEncoding: "MP3"
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const json = await res.json();
  if (!json.audioContent) {
    console.error("TTS error", json);
    return { statusCode: 500, body: JSON.stringify(json) };
  }

  const buffer = Buffer.from(json.audioContent, "base64");
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-cache"
    },
    body: buffer.toString("base64"),
    isBase64Encoded: true
  };
};
