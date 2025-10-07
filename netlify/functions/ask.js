const fetch = require("node-fetch");
const Papa = require("papaparse");

// 📊 URL твоей таблицы Google Sheets
const CSV_URL = "https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q/gviz/tq?tqx=out:csv&sheet=apartments";

// 1️⃣ Загрузка данных из Google Sheets
async function loadApartments() {
  const res = await fetch(CSV_URL);
  const csvText = await res.text();
  const parsed = Papa.parse(csvText, { header: true });
  return parsed.data;
}

// 2️⃣ GPT-вызов — понимание смысла запроса
async function understandIntent(userText) {
  const prompt = `
Ты — ИИ аналитик, который переводит человеческий запрос о недвижимости в структурированный JSON.
Анализируй, что пользователь хочет, и возвращай только JSON без комментариев.

Пример:
"Покажи квартиры в Милане до 150 тысяч евро"
→ {"intent":"search_apartments","filters":{"city":"Милан","max_price":150000}}

Если информации мало, добавь только то, что есть.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-3.5-turbo",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userText },
      ],
      temperature: 0.3,
    }),
  });

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content?.trim();
  try {
    return JSON.parse(raw);
  } catch {
    console.error("Ошибка парсинга JSON от GPT:", raw);
    return null;
  }
}

// 3️⃣ Фильтрация базы (исполнение запроса ИИ)
function filterByIntent(apartments, intent) {
  if (!intent || !intent.filters) return [];
  const { city, max_price } = intent.filters;
  return apartments.filter(ap => {
    const matchCity = city ? ap["Город"]?.toLowerCase().includes(city.toLowerCase()) : true;
    const matchPrice = max_price ? Number(ap["Общая цена (€)"]) <= max_price : true;
    return matchCity && matchPrice;
  });
}

// 4️⃣ GPT-вызов — формулировка финального ответа
async function generateAnswer(userText, results) {
  const systemPrompt = `
Ты — голосовой ассистент проекта "Ясность".
Ты получаешь данные о квартирах в виде JSON и должен сформулировать понятный человеку ответ.
Начни с фразы: "Добро пожаловать в нейрость Ясность."
`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
        { role: "assistant", content: JSON.stringify(results.slice(0, 10)) }
      ],
      temperature: 0.7,
    }),
  });

  const data = await res.json();
  return data?.choices?.[0]?.message?.content || "🤖 Нет ответа.";
}

// 5️⃣ Главный обработчик
exports.handler = async function (event) {
  try {
    const body = JSON.parse(event.body);
    const userText = body.text || "";

    // Этап 1: GPT понимает смысл
    const intent = await understandIntent(userText);

    // Этап 2: Загружаем базу
    const apartments = await loadApartments();

    // Этап 3: ИИ-запрос исполняется на сервере
    const filtered = filterByIntent(apartments, intent);

    // Этап 4: GPT формулирует красивый ответ
    const responseText = await generateAnswer(userText, filtered);

    return {
      statusCode: 200,
      body: JSON.stringify({ text: responseText }),
    };
  } catch (error) {
    console.error("Ошибка:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
