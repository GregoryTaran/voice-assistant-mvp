
const fetch = require("node-fetch");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");

const apartments = JSON.parse(
  fs.readFileSync(path.join(__dirname, "apartments.json"), "utf-8")
);

exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body);
    let { audio, text } = body;

    // 🔧 Вспомогательная фильтрация квартир
    function filterApartments({ city, maxPrice }) {
      return apartments.filter(ap => {
        const matchCity = city ? ap.city.toLowerCase() === city.toLowerCase() : true;
        const matchPrice = maxPrice ? ap.total_price <= maxPrice : true;
        return matchCity && matchPrice;
      });
    }

    // 🔧 Составление текста из подходящих квартир
    function formatResults(matches) {
      if (matches.length === 0) {
        return "К сожалению, по вашему запросу ничего не найдено.";
      } else {
        return "Вот подходящие квартиры:\n\n" + matches.slice(0, 5).map(ap => {
          return `🏙 ${ap.city} – ${ap.area_m2} м² по цене ${ap.total_price} EUR\n` +
                 `💰 Рассрочка: ${ap.installment_percent}% на ${ap.installment_months} мес.\n` +
                 `🔨 ${ap.developer}`;
        }).join("\n\n");
      }
    }

    // 🧠 Получаем системный промт
    const systemPromptURL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const systemPrompt = await fetch(systemPromptURL).then(res => res.text());

    // 📘 Если текст — сразу обрабатываем
    if (text) {
      const cityMatch = text.match(/в\s([А-Яа-я]+)/); // пример: "в Милане"
      const priceMatch = text.match(/до\s(\d+)[\s€евро]/i); // пример: "до 150000 евро"
      const city = cityMatch ? cityMatch[1] : null;
      const maxPrice = priceMatch ? parseInt(priceMatch[1]) : null;

      const filtered = filterApartments({ city, maxPrice });
      const resultText = formatResults(filtered);

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
            { role: "assistant", content: resultText }
          ],
        }),
      });

      const chatJson = await chatRes.json();
      return {
        statusCode: 200,
        body: JSON.stringify({ text: chatJson?.choices?.[0]?.message?.content || "🤖 Нет ответа" }),
      };
    }

    // 🎤 Обработка аудио (Whisper)
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

    // 📗 Аналогично — фильтрация + ответ
    const cityMatch = userText.match(/в\s([А-Яа-я]+)/);
    const priceMatch = userText.match(/до\s(\d+)[\s€евро]/i);
    const city = cityMatch ? cityMatch[1] : null;
    const maxPrice = priceMatch ? parseInt(priceMatch[1]) : null;

    const filtered = filterApartments({ city, maxPrice });
    const resultText = formatResults(filtered);

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
          { role: "assistant", content: resultText }
        ],
      }),
    });

    const chatJson = await chatRes.json();
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
