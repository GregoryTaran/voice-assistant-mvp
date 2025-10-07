const fetch = require("node-fetch");
const FormData = require("form-data");

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body);
    let { audio, text } = body;

    // 1️⃣ Если есть текст — сразу GPT, без аудио
    if (text) {
      const systemPromptURL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
      const systemPrompt = await fetch(systemPromptURL).then(res => res.text());

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
            { role: "user", content: text },
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

      const responseText = chatJson?.choices?.[0]?.message?.content || "🤖 Нет ответа";
      return {
        statusCode: 200,
        body: JSON.stringify({ text: responseText }),
      };
    }

    // 2️⃣ Если текста нет — идём по старому пути (Whisper)
    if (!audio) {
      return { statusCode: 400, body: "No audio provided" };
    }

    if (audio.startsWith("data:")) {
      audio = audio.split(",")[1];
    }

    const audioBuffer = Buffer.from(audio, "base64");
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
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Whisper failed", details: whisperJson }),
      };
    }

    const userText = whisperJson.text;

    const systemPromptURL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const systemPrompt = await fetch(systemPromptURL).then(res => res.text());

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

    const responseText = chatJson?.choices?.[0]?.message?.content || "🤖 Нет ответа";
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
