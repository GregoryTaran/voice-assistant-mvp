/* z.js — логика страницы умных заметок */
async function fetchJSON(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t}`);
  }
  return res.json();
}

function fmtLocal(dtISO, tz = "Europe/Dublin") {
  if (!dtISO) return "—";
  try {
    const d = new Date(dtISO);
    const date = d.toLocaleDateString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: tz
    });
    const time = d.toLocaleTimeString("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz
    });
    return `${date} ${time}`;
  } catch (e) {
    return dtISO;
  }
}

async function loadConfig() {
  try {
    const cfg = await fetchJSON("/.netlify/functions/read-config");
    document.getElementById("cfgModel").textContent = cfg?.gptModel || "gpt-4-1106-preview";
    document.getElementById("cfgWhisper").textContent = cfg?.whisperServer || "openai";
  } catch (e) {
    document.getElementById("cfgModel").textContent = "gpt-4-1106-preview";
    document.getElementById("cfgWhisper").textContent = "openai";
  }
}

async function loadNotes() {
  const listEl = document.getElementById("notesContainer");
  listEl.innerHTML = "<div class='empty'>Загрузка…</div>";
  try {
    const data = await fetchJSON("/.netlify/functions/notes?action=list");
    const notes = data?.notes || [];
    if (!notes.length) {
      listEl.innerHTML = "<div class='empty'>Пока нет заметок</div>";
      return;
    }
    listEl.innerHTML = "";
    for (const n of notes) {
      const row = document.createElement("div");
      row.className = "row";
      const left = document.createElement("div");

      const title = document.createElement("div");
      title.className = "note-title";
      title.textContent = n.text || "(без текста)";

      const meta = document.createElement("div");
      meta.className = "note-meta";
      meta.textContent = `Время напоминания: ${fmtLocal(n.reminder_time)}  •  Способ: ${n.method || "PUSH"}`;

      left.appendChild(title);
      left.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "actions";
      const editBtn = document.createElement("button");
      editBtn.className = "action-btn";
      editBtn.textContent = "ИЗМЕНИТЬ ЗАМЕТКУ";
      editBtn.onclick = () => alert("Редактирование появится в следующей версии ✌️");

      const archBtn = document.createElement("button");
      archBtn.className = "action-btn";
      archBtn.textContent = "ОТПРАВИТЬ В АРХИВ";
      archBtn.onclick = async () => {
        archBtn.disabled = true;
        try {
          await fetchJSON("/.netlify/functions/notes?action=archive", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ id: n.id })
          });
          await loadNotes();
        } catch (e) {
          alert("Ошибка архивации: " + e.message);
        } finally {
          archBtn.disabled = false;
        }
      };

      actions.appendChild(editBtn);
      actions.appendChild(archBtn);

      row.appendChild(left);
      row.appendChild(actions);
      listEl.appendChild(row);
    }
  } catch (e) {
    listEl.innerHTML = "<div class='empty'>Ошибка загрузки заметок</div>";
    console.error(e);
  }
}

function setupRecorder() {
  const btn = document.getElementById("holdRecordBtn");
  const statusEl = document.getElementById("recStatus");

  let mediaRecorder;
  let chunks = [];
  let stream;

  async function start() {
    btn.classList.add("recording");
    statusEl.textContent = "Запись… удерживайте кнопку";
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime });
      chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.start();
    } catch (e) {
      btn.classList.remove("recording");
      statusEl.textContent = "Микрофон недоступен";
      console.error(e);
    }
  }

  async function stop() {
    btn.classList.remove("recording");
    statusEl.textContent = "Обработка…";
    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        await new Promise((res) => {
          mediaRecorder.onstop = res;
          mediaRecorder.stop();
        });
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      const blob = new Blob(chunks, { type: mediaRecorder?.mimeType || "audio/webm" });
      const base64 = await blobToBase64(blob);

      // Отправка на сервер для транскрибации + парсинга + сохранения
      const payload = {
        audioBase64: base64,
        mimeType: blob.type,
        gdocId: (window.SMART_NOTES && window.SMART_NOTES.gdocId) || "",
        timezone: (window.SMART_NOTES && window.SMART_NOTES.timezone) || "Europe/Dublin"
      };
      const res = await fetchJSON("/.netlify/functions/notes?action=create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      statusEl.textContent = "Готово ✅";
      await loadNotes();
      setTimeout(() => (statusEl.textContent = "Ожидание…"), 1200);
    } catch (e) {
      console.error(e);
      statusEl.textContent = "Ошибка: " + e.message;
      setTimeout(() => (statusEl.textContent = "Ожидание…"), 2000);
    }
  }

  // Мышь и тач
  btn.addEventListener("mousedown", start);
  btn.addEventListener("mouseup", stop);
  btn.addEventListener("mouseleave", (e) => {
    if (btn.classList.contains("recording")) stop();
  });
  btn.addEventListener("touchstart", (e) => {
    e.preventDefault();
    start();
  }, {passive:false});
  btn.addEventListener("touchend", (e) => {
    e.preventDefault();
    stop();
  }, {passive:false});
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupRecorder();
  loadConfig();
  loadNotes();
});
