# Voice Assistant MVP

🎤 Голосовой ассистент для новостроек Италии.  
🧠 Работает на базе Whisper + GPT + Google Sheets.  
💬 Поддерживает историю диалога, текстовый и голосовой ввод.

## ⚙️ Структура

- `index.html` — интерфейс
- `app.js` — логика записи, история, отправка
- `netlify/functions/ask.js` — обработка запросов (серверная логика)
- `netlify.toml` — конфигурация Netlify
- `.gitignore` — исключения для Git

## 🚀 Деплой

1. Залить в GitHub
2. Подключить к Netlify
3. Добавить `OPENAI_API_KEY` в переменные окружения Netlify

## 📄 Источник базы

[Google Sheets (новостройки)](https://docs.google.com/spreadsheets/d/1oRxbMU9KR9TdWVEIpg1Q4O9R_pPrHofPmJ1y2_hO09Q)

## ✍️ Промпты

Промпты хранятся в Google Docs, подключаются динамически внутри `ask.js`