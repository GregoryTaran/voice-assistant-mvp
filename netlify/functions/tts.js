require("dotenv").config();

const fs = require("fs");
const path = require("path");
const textToSpeech = require("@google-cloud/text-to-speech");

exports.handler = async function(event) {
  try {
    const { text } = JSON.parse(event.body || "{}");
    if (!text || typeof text !== "string") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Bad Request: text is required" })
      };
    }

    // Получаем JSON-ключ из переменной окружения
    const keyJsonString = process.env.GOOGLE_KEY_JSON;
    if (!keyJsonString) {
      throw new Error("GOOGLE_KEY_JSON not defined");
    }

    // Сохраняем временный файл ключа
    const tempKeyPath = path.join("/tmp", `gcloud-key-${Date.now()}.json`);
    let keyObj;
    try {
      keyObj = JSON.parse(keyJsonString);
    } catch (e) {
      // Если JSON содержит экранированные символы — убираем лишние слеши
      const unescaped = keyJsonString
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"');
      keyObj = JSON.parse(unescaped);
    }
    fs.writeFileSync(tempKeyPath, JSON.stringify(keyObj));

    // Инициализируем клиент Google TTS
    const client = new textToSpeech.TextToSpeechClient({
      keyFilename: tempKeyPath
    });

    // Формируем запрос к Google TTS
    const request = {
      input: { text },
      voice: { languageCode: "ru-RU", ssmlGender: "FEMALE" },
      audioConfig: { audioEncoding: "MP3" }
    };

    const [response] = await client.synthesizeSpeech(request);

    if (!response.audioContent) {
      throw new Error("No audio content received from Google TTS");
    }

    // Возвращаем MP3 в base64
    return {
      statusCode: 200,
      headers: { "Content-Type": "audio/mpeg" },
      body: response.audioContent.toString("base64"),
      isBase64Encoded: true
    };

  } catch (err) {
    console.error("Ошибка в tts.js:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: err.message })
    };
  }
};
