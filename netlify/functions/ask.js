const fetch = require("node-fetch");
const FormData = require("form-data");
const Papa = require("papaparse");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PROMPT_DOC_URL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
const CSV_URL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

exports.handler = async (event) => {
  try {
    const { audio, userText = "", sessionId = "", history = [] } = JSON.parse(event.body);

    let transcript = userText;

    // Если пришёл аудиофайл — расшифруем через Whisper
    if (audio) {
      const audioBuffer = Buffer.from(audio, "base64");
      const form = new FormData();
      form.append("file", audioBuffer, { filename: "audio.webm", contentType: "audio/webm" });
      form.append("model", "whisper-1");
      const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
        body: form
      });
      const whisperData = await whisperRes.json();
      transcript = whisperData.text;
    }

    // Подгружаем CSV
    const csvRes = await fetch(CSV_URL);
    const csvText = await csvRes.text();
    const { data } = Papa.parse(csvText, { header: true });

    // Подгружаем PROMPT
    const promptRes = await fetch(PROMPT_DOC_URL);
    const promptText = await promptRes.text();

    // Составляем сообщение для GPT
    const messages = [
      { role: "system", content: promptText },
      ...history.slice(-10), // последние 5 пар вопрос-ответ
      { role: "user", content: "Вопрос: " + transcript + "\nВот данные о новостройках: " + JSON.stringify(data.slice(0, 30)) }
    ];

    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4",
        messages,
        temperature: 0.7
      })
    });

    const gptData = await gptRes.json();
    console.log("GPT Response:", JSON.stringify(gptData, null, 2)); // <--- добавь
    const finalAnswer = gptData.choices?.[0]?.message?.content || "Ответ не получен.";

    return {
      statusCode: 200,
      body: JSON.stringify({ text: finalAnswer, transcript })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Ошибка: " + err.message })
    };
  }
};
