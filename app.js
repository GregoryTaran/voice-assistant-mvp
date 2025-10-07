let mediaRecorder, audioChunks = [];

// 🧠 Память диалога (удаляется при закрытии браузера)
const MAX_TURNS = 10; // сколько последних пар "вопрос–ответ" передавать GPT
let convo = JSON.parse(sessionStorage.getItem("clarity_history") || "[]");

function saveHistory() {
  sessionStorage.setItem("clarity_history", JSON.stringify(convo.slice(-MAX_TURNS * 2)));
}

// 🧩 Добавить новое сообщение на экран и в память
function addToHistory(query, answer) {
  const history = document.getElementById("history");
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `
    <div class="q">🧑‍💬 ${query || "(без текста)"}</div>
    <div class="a">🤖 ${answer || "—"}</div>
  `;
  history.prepend(div);

  if (query) convo.push({ role: "user", content: query });
  if (answer) convo.push({ role: "assistant", content: answer });
  convo = convo.slice(-MAX_TURNS * 2);
  saveHistory();
}

// 🔄 Восстановить историю при обновлении страницы
window.addEventListener("DOMContentLoaded", () => {
  for (let i = Math.max(0, convo.length - MAX_TURNS * 2); i < convo.length; i += 2) {
    const q = convo[i]?.content || "";
    const a = convo[i + 1]?.content || "";
    if (q || a) addToHistory(q, a);
  }
});

// 🧮 Урезать историю перед отправкой на сервер (по длине)
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

// 🎤 Запуск записи микрофона
async function startRecording() {
  const status = document.getElementById("status");
  status.innerText = "🎤 Слушаю… (5 сек)";
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    status.innerText = "⏳ Распознаю и думаю…";
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const audioBase64 = await blobToBase64(audioBlob);

    const res = await fetch('/.netlify/functions/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio: audioBase64,
        history: clipConvoForSend()
      })
    });

    const data = await res.json();
    addToHistory(data.query || "(голос)", data.text);
    status.innerText = "✅ Готово";
  };

  mediaRecorder.start();
  setTimeout(() => {
    if (mediaRecorder.state === "recording") mediaRecorder.stop();
  }, 5000);
}

// ⚡ Помощник: преобразовать Blob → base64
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ✉️ Отправить текстовый запрос
async function sendText() {
  const input = document.getElementById("textInput");
  const text = input.value.trim();
  if (!text) return;

  document.getElementById("status").innerText = "⏳ Думаю…";
  const res = await fetch('/.netlify/functions/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      history: clipConvoForSend()
    })
  });

  const data = await res.json();
  addToHistory(text, data.text);
  document.getElementById("status").innerText = "✅ Готово";
  input.value = "";
}

// ⌨️ Обработка Enter в поле ввода
function handleKey(e) {
  if (e.key === "Enter") sendText();
}

// ⛔ Автоотключение микрофона при уходе с вкладки
document.addEventListener("visibilitychange", () => {
  if (document.hidden && mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    document.getElementById("status").innerText = "⏸ Микрофон отключён — вкладка неактивна";
  }
});
