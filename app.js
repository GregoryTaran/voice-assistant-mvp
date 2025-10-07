let mediaRecorder = null;
let audioChunks = [];
let currentStream = null;
const MAX_TURNS = 10; // сколько последних пар "вопрос–ответ" отправляем GPT
let convo = JSON.parse(sessionStorage.getItem("clarity_history") || "[]");

// ===== UI & история =====
function saveHistory() {
  sessionStorage.setItem("clarity_history", JSON.stringify(convo.slice(-MAX_TURNS * 2)));
}

function addToHistory(query, answer) {
  const history = document.getElementById("history");
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `
    <div class="q">🧑‍💬 ${query || "(без текста)"} </div>
    <div class="a">🤖 ${answer || "—"}</div>
  `;
  history.prepend(div);

  if (query) convo.push({ role: "user", content: query });
  if (answer) convo.push({ role: "assistant", content: answer });
  convo = convo.slice(-MAX_TURNS * 2);
  saveHistory();
}

window.addEventListener("DOMContentLoaded", () => {
  for (let i = Math.max(0, convo.length - MAX_TURNS * 2); i < convo.length; i += 2) {
    const q = convo[i]?.content || "";
    const a = convo[i + 1]?.content || "";
    if (q || a) {
      const history = document.getElementById("history");
      const div = document.createElement("div");
      div.className = "item";
      div.innerHTML = `
        <div class="q">🧑‍💬 ${q || "(без текста)"} </div>
        <div class="a">🤖 ${a || "—"}</div>
      `;
      history.prepend(div);
    }
  }
});

function clipConvoForSend() {
  const maxChars = 6000;
  let acc = [];
  let total = 0;
  for (let i = convo.length - 1; i >= 0; i--) {
    const s = (convo[i].content || "").slice(0, 1000);
    if (total + s.length > maxChars) break;
    acc.unshift({ role: convo[i].role, content: s });
    total += s.length;
  }
  return acc;
}

function setRecordingUI(on) {
  const status = document.getElementById("status");
  const micBtn = document.getElementById("micBtn");
  const sendBtn = document.getElementById("sendBtn");
  const input = document.getElementById("textInput");
  if (on) {
    status.innerText = "🎤 Слушаю… (5 сек)";
    micBtn.disabled = true;
    sendBtn.disabled = true;
    input.disabled = true;
  } else {
    status.innerText = "Готово";
    micBtn.disabled = false;
    sendBtn.disabled = false;
    input.disabled = false;
  }
}

// ===== Микрофон: гарантированное выключение =====
function stopAllAudio(reasonText) {
  try {
    if (mediaRecorder) {
      if (mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }
  } catch (e) {
    console.warn("mediaRecorder stop err:", e);
  }

  try {
    if (currentStream) {
      currentStream.getTracks().forEach(t => t.stop());
      currentStream = null;
    } else if (mediaRecorder && mediaRecorder.stream) {
      // fallback: у некоторых браузеров есть mediaRecorder.stream
      mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
  } catch (e) {
    console.warn("stream stop err:", e);
  }

  mediaRecorder = null;
  audioChunks = [];

  const status = document.getElementById("status");
  if (status && reasonText) {
    status.innerText = reasonText;
  }

  // вернуть UI в норму
  setRecordingUI(false);
}

// Срабатывает при потере видимости/фокуса/уходе со страницы:
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopAllAudio("⏸ Микрофон отключён — вкладка неактивна");
  }
});
window.addEventListener("blur", () => {
  stopAllAudio("⏸ Микрофон отключён — окно потеряло фокус");
});
window.addEventListener("pagehide", () => {
  stopAllAudio("⏸ Микрофон отключён — страница скрыта");
});

// ===== Запись =====
async function startRecording() {
  try {
    setRecordingUI(true);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    currentStream = stream;
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // если поток уже остановлен внешними событиями — ничего не делаем
      if (!audioChunks.length) {
        setRecordingUI(false);
        return;
      }

      const status = document.getElementById("status");
      if (status) status.innerText = "⏳ Распознаю и думаю…";

      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      // очистим заранее
      stopAllAudio();

      const audioBase64 = await blobToBase64(audioBlob);

      const res = await fetch("/.netlify/functions/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: audioBase64,
          history: clipConvoForSend(),
          shouldGreet: convo.length === 0 // приветствие только в начале сессии
        })
      });

      const data = await res.json();
      addToHistory(data.query || "(голос)", data.text);
      const s2 = document.getElementById("status");
      if (s2) s2.innerText = "✅ Готово";
      setRecordingUI(false);
    };

    mediaRecorder.start();

    // автостоп через 5 секунд
    setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
      }
    }, 5000);
  } catch (err) {
    console.error(err);
    stopAllAudio("❌ Ошибка доступа к микрофону");
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// ===== Текстовый ввод =====
async function sendText() {
  const input = document.getElementById("textInput");
  const text = input.value.trim();
  if (!text) return;

  document.getElementById("status").innerText = "⏳ Думаю…";
  const res = await fetch("/.netlify/functions/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      history: clipConvoForSend(),
      shouldGreet: convo.length === 0
    })
  });

  const data = await res.json();
  addToHistory(text, data.text);
  document.getElementById("status").innerText = "✅ Готово";
  input.value = "";
}

function handleKey(e) {
  if (e.key === "Enter") sendText();
}

// Экспортируем старт записи для кнопки
window.startRecording = startRecording;
window.sendText = sendText;
window.handleKey = handleKey;
