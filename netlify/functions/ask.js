const fetch = require("node-fetch");
const FormData = require("form-data");

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body);
    let audioBase64 = body.audio;

    if (!audioBase64) {
      return { statusCode: 400, body: "No audio provided" };
    }

    // 🧼 Убираем data:audio/webm;base64, если оно есть
    if (audioBase64.startsWith("data:")) {
      audioBase64 = audioBase64.split(",")[1];
    }

    const audioBuffer = Buffer.from(audioBase64, "base64");
    const formData = new FormData();
    formData.append("file", audioBuffer, {
      filename: "audio.webm",
      contentType: "audio/webm",
    });
    formData.append("model", "whisper-1");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData,
    });

    const whisperJson = await whisperRes.json();

    if (!whisperRes.ok) {
      console.error("Whisper error:", whisperJson);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Whisper failed", details: whisperJson }),
      };
    }

    const userText = whisperJson.text;

    const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [
          { role: "system", content: "Ты голосовой ассистент. Отвечай ясно и коротко." },
          { role: "user", content: userText },
        ],
      }),
    });

    const chatJson = await chatRes.json();

    if (!chatRes.ok) {
      console.error("Chat error:", chatJson);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "ChatGPT failed", details: chatJson }),
      };
    }

    const assistantReply = chatJson.choices?.[0]?.message?.content || "";

    return {
      statusCode: 200,
      body: JSON.stringify({ reply: assistantReply, input: userText }),
    };
  } catch (err) {
    console.error("Global error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error", details: err.message }),
    };
  }
};
