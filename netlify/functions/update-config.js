const fs = require("fs");
const path = require("path");

exports.handler = async function (event, context) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed",
    };
  }

  try {
    const data = JSON.parse(event.body);

    // Проверка допустимых значений (на всякий случай)
    const allowedGptModels = ["gpt-3.5-turbo", "gpt-4-1106-preview", "gpt-4o"];
    const allowedWhisperServers = ["openai", "whisper-large-v3-turbo"];

    if (
      !allowedGptModels.includes(data.gpt_model) ||
      !allowedWhisperServers.includes(data.whisper_server)
    ) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Неверные значения конфигурации" }),
      };
    }

    // Путь к config.json
    const configPath = path.join(__dirname, "config.json");

    // Обновляем конфигурацию
    const config = {
      gpt_model: data.gpt_model,
      whisper_server: data.whisper_server,
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

    return {
      statusCode: 200,
      body: JSON.stringify({ message: "Конфигурация обновлена", config }),
    };
  } catch (error) {
    console.error("Ошибка:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Ошибка сервера" }),
    };
  }
};
