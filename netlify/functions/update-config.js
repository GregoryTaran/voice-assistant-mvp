// netlify/functions/update-config.js
// Работает на Node 18+ (в Netlify уже есть fetch)

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const API_KEY = process.env.AIRTABLE_TOKEN;
    const BASE_ID = process.env.AIRTABLE_BASE_ID;
    const TABLE_NAME = "Config";

    if (!API_KEY || !BASE_ID) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "ENV not set: AIRTABLE_TOKEN / AIRTABLE_BASE_ID" }),
      };
    }

    const { key, value } = JSON.parse(event.body || "{}");
    if (!key || typeof value === "undefined") {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "key и value обязательны" }),
      };
    }

    const baseUrl = `https://api.airtable.com/v0/${BASE_ID}/${encodeURIComponent(TABLE_NAME)}`;
    const headers = {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    };

    // 1) Ищем запись по key
    const formula = encodeURIComponent(`{key} = "${String(key).replace(/"/g, '\\"')}"`);
    const findUrl = `${baseUrl}?filterByFormula=${formula}&maxRecords=1&pageSize=1`;

    const findRes = await fetch(findUrl, { headers });
    const findJson = await findRes.json();

    if (!findRes.ok) {
      return {
        statusCode: findRes.status,
        body: JSON.stringify({ error: "Airtable find error", details: findJson }),
      };
    }

    const record = (findJson.records && findJson.records[0]) || null;

    // 2) Если нашли — обновляем
    if (record) {
      const patchUrl = `${baseUrl}/${record.id}`;
      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ fields: { value: String(value) } }),
      });
      const patchJson = await patchRes.json();

      if (!patchRes.ok) {
        return {
          statusCode: patchRes.status,
          body: JSON.stringify({ error: "Airtable patch error", details: patchJson }),
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, action: "updated", record: patchJson }),
      };
    }

    // 3) Если нет — создаём
    const postRes = await fetch(baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        records: [{ fields: { key: String(key), value: String(value) } }],
        typecast: true,
      }),
    });
    const postJson = await postRes.json();

    if (!postRes.ok) {
      return {
        statusCode: postRes.status,
        body: JSON.stringify({ error: "Airtable create error", details: postJson }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, action: "created", record: postJson.records?.[0] }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server error", details: err.message }),
    };
  }
};
