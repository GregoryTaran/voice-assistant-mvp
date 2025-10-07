const fetch = require("node-fetch");
const FormData = require("form-data");

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body);
    let audioBase64 = body.audio;

    if (!audioBase64) {
      return { statusCode: 400, body: "No audio provided" };
    }

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

    // 1️⃣ Распознаём речь через Whisper
    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: formData,
    });

    const whisperJson = await whisperRes.json();

    if (!whisperRes.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Whisper failed", details: whisperJson }),
      };
    }

    const userText = whisperJson.text;

    // 2️⃣ Загружаем системный промт из Google Docs
    const systemPromptURL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const systemPrompt = await fetch(systemPromptURL).then(res => res.text());

    // 3️⃣ GPT-3.5 с системным промтом
    const chatRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userText },
        ],
      }),
    });

    const chatJson = await chatRes.json();

    if (!chatRes.ok) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "ChatGPT failed", details: chatJson }),
      };
    }

    const responseText = chatJson?.choices?.[0]?.message?.content || "🤖 Нет ответа от ИИ";
    console.log("OpenAI response:", JSON.stringify(chatJson, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({ text: responseText }),
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error", details: error.message }),
    };
  }
};
