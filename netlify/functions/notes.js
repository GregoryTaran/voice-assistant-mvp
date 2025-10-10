// netlify/functions/notes.js
require("dotenv").config();
const fetch = require("node-fetch");
const { OpenAI } = require("openai");
const FormData = require("form-data");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TABLE_NOTES = "Notes"; // имя таблицы
const DEFAULT_GPT_MODEL = "gpt-4-1106-preview";
const DEFAULT_TZ = "Europe/Dublin";

// ID публичного Google Doc с системным промптом
const DEFAULT_GDOC_ID = "1BbFm6qZl75g4MVB_Q6c5nVjUc0VGaPBbJ83MXoMfN6M";

function b64ToBuffer(b64) {
  return Buffer.from(b64, "base64");
}

async function transcribeWithOpenAI(audioBase64, mimeType) {
  const form = new FormData();
  form.append("file", b64ToBuffer(audioBase64), {
    filename: "audio.webm",
    contentType: mimeType || "audio/webm"
  });
  form.append("model", "whisper-1");
  // You may set language to speed up: form.append("language", "ru");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Whisper error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data.text;
}

async function fetchPromptFromGDoc(docId) {
  const id = docId || DEFAULT_GDOC_ID;
  const url = `https://docs.google.com/document/d/${id}/export?format=txt`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Prompt fetch failed: HTTP ${resp.status}`);
  }
  return await resp.text();
}

function nowInTZ(tz = DEFAULT_TZ) {
  const now = new Date();
  // Format as ISO with timezone name for context
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(now);
}

async function parseNoteWithGPT({ promptText, transcript, tz }) {
  const sys = [
    promptText,
    "",
    "ДОПОЛНИТЕЛЬНЫЕ ЖЁСТКИЕ ИНСТРУКЦИИ:",
    "- Текущий часовой пояс пользователя: " + (tz || DEFAULT_TZ),
    "- В ответе верни СТРОГО JSON без каких-либо комментариев и текста.",
    "- Поля: text (строка), reminder_time_utc (ISO 8601 с Z или null), reminder_time_local (строка 'YYYY-MM-DD HH:mm' или null), method (PUSH|SMS|CALL).",
    "- Если способ не указан — используй 'PUSH'.",
    "- Относительные даты (завтра, через час) конвертируй в UTC и локальное время.",
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: DEFAULT_GPT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: transcript }
    ]
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    // fallback heuristic to extract JSON
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }
  return parsed;
}

async function airtableCreate(fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NOTES)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Airtable create error ${resp.status}: ${t}`);
  }
  return resp.json();
}

async function airtableList() {
  const url = new URL(`https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NOTES)}`);
  url.searchParams.set("pageSize", "50");
  url.searchParams.set("sort[0][field]", "ReminderTime");
  url.searchParams.set("sort[0][direction]", "desc");
  // не показываем архив
  url.searchParams.set("filterByFormula", "NOT({Archived})");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Airtable list error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const notes = (data.records || []).map(r => ({
    id: r.id,
    text: r.fields?.Text || "",
    reminder_time: r.fields?.ReminderTime || null,
    method: r.fields?.Method || "PUSH",
    from_voice: !!r.fields?.FromVoice,
    parsed: !!r.fields?.Parsed
  }));
  return notes;
}

async function airtableArchive(id) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NOTES)}/${id}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ fields: { Archived: true } })
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Airtable archive error ${resp.status}: ${t}`);
  }
  return resp.json();
}

exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const action = (params.action || "").toLowerCase();

    if (action === "list" && event.httpMethod === "GET") {
      const notes = await airtableList();
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, notes })
      };
    }

    if (action === "archive" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (!body.id) {
        return { statusCode: 400, body: "id required" };
      }
      await airtableArchive(body.id);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }

    if (action === "create" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { audioBase64, mimeType, gdocId, timezone } = body;

      if (!audioBase64) {
        return { statusCode: 400, body: "audioBase64 required" };
      }

      // 1) Whisper
      const transcript = await transcribeWithOpenAI(audioBase64, mimeType);

      // 2) Prompt
      const promptText = await fetchPromptFromGDoc(gdocId);

      // 3) GPT parse
      const parsed = await parseNoteWithGPT({
        promptText,
        transcript,
        tz: timezone || DEFAULT_TZ
      });

      const noteText = parsed.text || transcript || "";
      const method = parsed.method || "PUSH";
      const reminderISO = parsed.reminder_time_utc || parsed.reminder_time || null;

      // 4) Save to Airtable
      const fields = {
        Text: noteText,
        Method: method,
        RawText: transcript,
        FromVoice: true,
        Parsed: true
      };
      if (reminderISO) fields.ReminderTime = reminderISO;
      // ensure Archived defaults false
      fields.Archived = false;

      const created = await airtableCreate(fields);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: true,
          transcript,
          parsed,
          airtableId: created?.id || null
        })
      };
    }

    return { statusCode: 404, body: "Unknown action or method" };
  } catch (err) {
    return {
      statusCode: 500,
      body: `Error: ${err.message}`
    };
  }
};
