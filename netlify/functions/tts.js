require("dotenv").config();

exports.handler = async function(event) {
  try {
    const keyJsonString = process.env.GOOGLE_KEY_JSON;
    const text = (JSON.parse(event.body || "{}")).text || "";

    console.log("🔍 Received TTS request, text length:", text.length);
    console.log("🔍 GOOGLE_KEY_JSON length:", keyJsonString ? keyJsonString.length : 0);

    if (!keyJsonString) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "GOOGLE_KEY_JSON not defined" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        msg: "OK, key received",
        textLength: text.length,
        keyLength: keyJsonString.length
      })
    };
  } catch (err) {
    console.error("Ошибка в test-tts.js:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", details: err.message })
    };
  }
};
