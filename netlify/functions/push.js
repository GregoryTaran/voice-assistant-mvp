// netlify/functions/push.js
const fetch = require("node-fetch");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { playerId, title, message, data } = JSON.parse(event.body || "{}");

    if (!playerId) {
      return { statusCode: 400, body: "playerId required" };
    }

    const resp = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${process.env.ONESIGNAL_REST_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        app_id: process.env.ONESIGNAL_APP_ID,
        include_player_ids: [playerId],
        headings: { en: title || "Reminder" },
        contents: { en: message || "Time to wake up!" },
        data: data || {},        // кастомный payload (deeplink и т.п.)
        priority: 10             // выше шанс доставить сразу
      })
    });

    const json = await resp.json();
    const ok = resp.ok && !json.errors;
    return {
      statusCode: ok ? 200 : 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify(json)
    };
  } catch (e) {
    return { statusCode: 500, body: `Error: ${e.message}` };
  }
};
