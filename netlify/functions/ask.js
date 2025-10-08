require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { OpenAI } = require("openai");
const Papa = require("papaparse");
const fetch = require("node-fetch");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const userText = body.text || "";
    const isFirst = body.shouldGreet === true || body.shouldGreet === "true";
    let transcript = userText;

    // 🎙️ Распознавание аудио
    if (body.audio) {
      const audioBuffer = Buffer.from(body.audio, "base64");
      const tempPath = path.join("/tmp", `audio-${Date.now()}.webm`);
      fs.writeFileSync(tempPath, audioBuffer);

      const resp = await openai.audio.transcriptions.create({
        file: fs.createReadStream(tempPath),
        model: "whisper-1"
      });
      transcript = resp.text;
    }

    // ⚠️ Проверка пустого текста
    if (!transcript || transcript.trim().length < 2) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          text: "Я не расслышал. Попробуйте ещё раз.",
          transcript: transcript || "…",
          matches: 0
        })
      };
    }

    // 📄 Промты и база
    const prompt1URL = "https://docs.google.com/document/d/1AswvzYsQDm8vjqM-q28cCyitdohCc8IkurWjpfiksLY/export?format=txt";
    const prompt2URL = "https://docs.google.com/document/d/1_N8EDELJy4Xk6pANqu4OK50fQjiixQDfR4o_xhuk1no/export?format=txt";
    const csvURL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/export?format=csv";

    const [prompt1, prompt2, csvText] = await Promise.all([
      fetch(prompt1URL).then(r => r.text()),
      fetch(prompt2URL).then(r => r.text()),
      fetch(csvURL).then(r => r.text())
    ]);

    // 🧠 Анализ запроса (первый GPT)
    const analysis = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt1 },
        { role: "user", content: `Что хочет пользователь: "${transcript}"? Верни JSON.` }
      ]
    });

    const parsedAnalysis = JSON.parse(analysis.choices[0].message.content);
    const intent = parsedAnalysis.intent || "clarify";
    const filters = parsedAnalysis.filters || {};
    const clarifyMessage = parsedAnalysis.message || "";

    // 📊 Обработка базы
    const parsed = Papa.parse(csvText, { header: true }).data;

    // 🧩 Разумный снимок базы
    function buildGlobalStats(data) {
      const valid = data.filter(r => r["общая цена (€)"] && r["площадь (м²)"]);

      const prices = valid.map(r => parseFloat(r["общая цена (€)"]));
      const areas = valid.map(r => parseFloat(r["площадь (м²)"]));
      const pricePerM2 = valid.map(r => r["цена за м² (€)"]
        ? parseFloat(r["цена за м² (€)"])
        : parseFloat(r["общая цена (€)"]) / parseFloat(r["площадь (м²)"])
      ).filter(x => !isNaN(x));

      const regions = {};
      const types = {};

      valid.forEach(r => {
        const reg = r["область"];
        const typ = r["Тип объекта"];
        if (reg) regions[reg] = (regions[reg] || 0) + 1;
        if (typ) types[typ] = (types[typ] || 0) + 1;
      });

      // Средние значения
      const avg = arr => Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);

      return {
        total_properties: valid.length,
        min_price: Math.min(...prices),
        max_price: Math.max(...prices),
        avg_price: avg(prices),
        min_area: Math.min(...areas),
        max_area: Math.max(...areas),
        avg_area: avg(areas),
        avg_price_per_m2: avg(pricePerM2),
        regions: regions,
        types: types,
        most_common_type: Object.entries(types).sort((a, b) => b[1] - a[1])[0]?.[0] || "Апартаменты",
        most_popular_region: Object.entries(regions).sort((a, b) => b[1] - a[1])[0]?.[0] || "Lazio"
      };
    }

    const globalStats = buildGlobalStats(parsed);

    // 🧮 Примитивный отбор (пока оставляем)
    const relevant = parsed.filter(row =>
      JSON.stringify(row).toLowerCase().includes(transcript.toLowerCase())
    );

    const sampleData = relevant.slice(0, 3).map(row =>
      `${row["Город"]} — ${row["Адрес"] || "Адрес не указан"}
${row["Площадь (м²)"]} м² — от ${row["Общая цена (€)"]} €
Сдача: ${row["Срок сдачи"] || "—"}`
    ).join("\n\n");

    // 🧠 Генерация финального ответа (второй GPT)
    const final = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt2 },
        {
          role: "user",
          content: JSON.stringify({
            transcript,
            intent,
            filters,
            message: clarifyMessage,
            results: sampleData,
            total: relevant.length,
            isFirst,
            globalStats
          })
        }
      ]
    });

    const gptAnswer = final.choices[0].message.content || "Нет ответа.";

    return {
      statusCode: 200,
      body: JSON.stringify({
        text: gptAnswer,
        transcript,
        matches: relevant.length
      })
    };

  } catch (err) {
    console.error("❌ Ошибка:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        details: err.message
      })
    };
  }
};
