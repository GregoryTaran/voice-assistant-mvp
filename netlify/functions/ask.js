
const fetch = require("node-fetch");
const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async function(event, context) {
  try {
    const body = JSON.parse(event.body);
    const userText = body.text || "";

    // 1. Получаем ответ от GPT
    const gptResponse = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: userText }]
    });

    const reply = gptResponse.choices[0].message.content;

    // 2. Делаем запрос к Google TTS
    const googleResponse = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize?key=" + process.env.GOOGLE_TTS_API_KEY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: reply },
        voice: { languageCode: "ru-RU", name: "ru-RU-Wavenet-C" },
        audioConfig: { audioEncoding: "MP3" }
      })
    });

    const ttsData = await googleResponse.json();
    const audioBase64 = ttsData.audioContent;

    return {
      statusCode: 200,
      body: JSON.stringify({
        text: reply,
        audio: audioBase64
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ text: "Ошибка сервера", error: e.message })
    };
  }
};
