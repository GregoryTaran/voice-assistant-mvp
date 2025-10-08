const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    const { text } = JSON.parse(event.body || "{}");
    const apiKey = process.env.GOOGLE_API_KEY;

    if (!text || !apiKey) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing text or API key." }),
      };
    }

    const requestBody = {
      input: { text },
      voice: {
        languageCode: "ru-RU",
        name: "ru-RU-Wavenet-D",
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: 1.0,
      },
    };

    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      }
    );

    const data = await response.json();

    if (data.audioContent) {
      return {
        statusCode: 200,
        body: JSON.stringify({ audio: data.audioContent }),
      };
    } else {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "No audio content", details: data }),
      };
    }
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal error", message: err.message }),
    };
  }
};
