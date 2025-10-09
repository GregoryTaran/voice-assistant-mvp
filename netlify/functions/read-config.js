const fs = require("fs");
const path = require("path");

exports.handler = async function () {
  try {
    const configPath = path.join(__dirname, "config.json");
    const content = fs.readFileSync(configPath, "utf-8");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: content,
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Не удалось прочитать конфигурацию" }),
    };
  }
};
