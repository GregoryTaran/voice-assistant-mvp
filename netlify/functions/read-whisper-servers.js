// netlify/functions/read-whisper-servers.js
exports.handler = async () => {
  try {
    const API_KEY = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_NAME = "WhisperServers";

    const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_NAME}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });

    const data = await res.json();
    if (!data.records) throw new Error("Нет записей");

    // Отдаём только активные серверы в удобной форме
    const servers = data.records
      .map((r) => ({
        id: r.fields.id,
        name: r.fields.name,
        url: r.fields.url || "",
        description: r.fields.description || "",
        status: r.fields.status || "inactive",
      }))
      .filter((s) => s.status === "active");

    return {
      statusCode: 200,
      body: JSON.stringify(servers),
    };
  } catch (err) {
    console.error("❌ Ошибка:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Ошибка при получении списка серверов" }),
    };
  }
};
