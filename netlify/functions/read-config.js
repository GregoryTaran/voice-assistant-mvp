// netlify/functions/read-config.js
const fetch = require("node-fetch");

exports.handler = async () => {
  const API_KEY = process.env.AIRTABLE_TOKEN;
  const BASE_ID = process.env.AIRTABLE_BASE_ID;
  const CONFIG_TABLE = "Config";
  const SERVERS_TABLE = "WhisperServers";

  try {
    // 1️⃣ Читаем все записи из Config
    const configUrl = `https://api.airtable.com/v0/${BASE_ID}/${CONFIG_TABLE}`;
    const headers = { Authorization: `Bearer ${API_KEY}` };

    const configRes = await fetch(configUrl, { headers });
    const configData = await configRes.json();

    const config = {};
    for (const record of configData.records) {
      const fields = record.fields;
      if (fields.key && fields.value) {
        config[fields.key] = fields.value;
      }
    }

    // 2️⃣ Если указан whisper_server — подгружаем его данные из WhisperServers
    if (config.whisper_server) {
      const filter = encodeURIComponent(`{id} = "${config.whisper_server}"`);
      const serverUrl = `https://api.airtable.com/v0/${BASE_ID}/${SERVERS_TABLE}?filterByFormula=${filter}`;
      const serverRes = await fetch(serverUrl, { headers });
      const serverData = await serverRes.json();

      if (serverData.records && serverData.records[0]) {
        const srv = serverData.records[0].fields;
        config.whisper_server_url = srv.url || "";
        config.whisper_server_name = srv.name || "";
        config.whisper_description = srv.description || "";
      }
    }

    // 3️⃣ Возвращаем всё
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    };

  } catch (error) {
    console.error("❌ Ошибка read-config:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message }),
    };
  }
};
