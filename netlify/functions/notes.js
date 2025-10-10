// netlify/functions/notes.js
require("dotenv").config();
const fetch = require("node-fetch");
const { OpenAI } = require("openai");
const FormData = require("form-data");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const AIRTABLE_TOKEN   = process.env.AIRTABLE_TOKEN;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

// === Настройки ===
const TABLE_NOTES       = "Notes";                 // Таблица с заметками
const DEFAULT_GPT_MODEL = "gpt-4-1106-preview";    // Модель GPT
const DEFAULT_TZ        = "Europe/Dublin";         // Таймзона по умолчанию
const DEFAULT_GDOC_ID   = "1BbFm6qZl75g4MVB_Q6c5nVjUc0VGaPBbJ83MXoMfN6M"; // System Prompt из Google Doc

function b64ToBuffer(b64) {
  return Buffer.from(b64, "base64");
}

/** 1) Транскрибация через OpenAI Whisper (API) */
async function transcribeWithOpenAI(audioBase64, mimeType) {
  const form = new FormData();
  form.append("file", b64ToBuffer(audioBase64), {
    filename: "audio.webm",
    contentType: mimeType || "audio/webm",
  });
  form.append("model", "whisper-1");
  // Можно ускорить, зафиксировав язык:
  // form.append("language", "ru");

  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: form,
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Whisper error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  return data.text;
}

/** 2) Забираем System Prompt из Google Doc (export txt) */
async function fetchPromptFromGDoc(docId) {
  const id = docId || DEFAULT_GDOC_ID;
  const url = `https://docs.google.com/document/d/${id}/export?format=txt`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Prompt fetch failed: HTTP ${resp.status}`);
  return await resp.text();
}

/** 3) Парсим транскрипт через GPT, передавая NOW_UTC и таймзону */
async function parseNoteWithGPT({ promptText, transcript, tz, nowUtc }) {
  const sys = [
    promptText,
    "",
    "ДОПОЛНИТЕЛЬНЫЕ ЖЁСТКИЕ ИНСТРУКЦИИ:",
    `- Текущий момент (якорь): NOW_UTC=${nowUtc}`,
    `- Часовой пояс пользователя: ${tz || DEFAULT_TZ}`,
    "- Интерпретируй относительные выражения (сегодня, завтра, через час, в воскресенье) ОТНОСИТЕЛЬНО NOW_UTC, но в КОНТЕКСТЕ часового пояса пользователя.",
    "- Если указано только время (например, 'в 9'), подразумевай ближайшую будущую дату в пользовательской TZ.",
    "- Никогда не подставляй прошедшие годы по умолчанию. Если относительная дата даёт прошедший год — используй текущий год.",
    "- Верни СТРОГО JSON без текста вокруг.",
    "- Поля: text (строка), reminder_time_utc (ISO 8601 с Z или null), reminder_time_local ('YYYY-MM-DD HH:mm' или null), method (PUSH|SMS|CALL).",
    "- Если способ не указан — method='PUSH'.",
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: DEFAULT_GPT_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: transcript },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content || "{}";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = m ? JSON.parse(m[0]) : {};
  }
  return parsed;
}

/** 4) Вспомогательные: Airtable CRUD */
async function airtableCreate(fields) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NOTES)}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
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
  // Показываем только неархивные
  url.searchParams.set("filterByFormula", "NOT({Archived})");

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` },
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Airtable list error ${resp.status}: ${t}`);
  }
  const data = await resp.json();
  const notes = (data.records || []).map((r) => ({
    id: r.id,
    text: r.fields?.Text || "",
    reminder_time: r.fields?.ReminderTime || null,
    method: r.fields?.Method || "PUSH",
    from_voice: !!r.fields?.FromVoice,
    parsed: !!r.fields?.Parsed,
  }));
  return notes;
}

async function airtableArchive(id) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(TABLE_NOTES)}/${id}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields: { Archived: true } }),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Airtable archive error ${resp.status}: ${t}`);
  }
  return resp.json();
}

/** 5) Netlify handler */
exports.handler = async (event) => {
  try {
    const params = event.queryStringParameters || {};
    const action = (params.action || "").toLowerCase();

    // === GET /notes?action=list ===
    if (action === "list" && event.httpMethod === "GET") {
      const notes = await airtableList();
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, notes }),
      };
    }

    // === POST /notes?action=archive ===
    if (action === "archive" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      if (!body.id) return { statusCode: 400, body: "id required" };
      await airtableArchive(body.id);
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
    }

    // === POST /notes?action=create ===
    if (action === "create" && event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      const { audioBase64, mimeType, gdocId, timezone } = body;
      if (!audioBase64) return { statusCode: 400, body: "audioBase64 required" };

      // 1) Speech → Text (Whisper)
      const transcript = await transcribeWithOpenAI(audioBase64, mimeType);

      // 2) Load System Prompt (Google Doc)
      const promptText = await fetchPromptFromGDoc(gdocId);

      // 3) Parse via GPT with NOW_UTC + TZ
      const nowUtc = new Date().toISOString();
      const parsed = await parseNoteWithGPT({
        promptText,
        transcript,
        tz: timezone || DEFAULT_TZ,
        nowUtc,
      });

      // 4) Prepare fields for Airtable
      const noteText   = parsed.text || transcript || "";
      const method     = parsed.method || "PUSH";
      const reminderISO =
        parsed.reminder_time_utc || parsed.reminder_time || null; // предпочитаем UTC

      const fields = {
        Text: noteText,
        Method: method,
        RawText: transcript,
        FromVoice: true,
        Parsed: true,
        Archived: false, // т.к. поле теперь Checkbox — это корректно
      };
      if (reminderISO) fields.ReminderTime = reminderISO;

      // 5) Save to Airtable
      const created = await airtableCreate(fields);

      // 6) Ответ клиенту
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: true,
          transcript,
          parsed,
          airtableId: created?.id || null,
        }),
      };
    }

    return { statusCode: 404, body: "Unknown action or method" };
  } catch (err) {
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
};
