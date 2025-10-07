
const input = document.getElementById("input");
const chatHistory = document.getElementById("chatHistory");
const speakBtn = document.getElementById("speakBtn");
const sendBtn = document.getElementById("sendBtn");
const voiceToggle = document.getElementById("voiceToggle");
const waves = document.getElementById("waves");

let voiceEnabled = true;
const synth = window.speechSynthesis;

// История
function loadHistory() {
  const saved = sessionStorage.getItem("hub_history");
  if (!saved) return;
  const history = JSON.parse(saved);
  history.forEach(entry => appendMessage(entry.q, entry.a, false));
}

function saveMessage(q, a) {
  const existing = JSON.parse(sessionStorage.getItem("hub_history") || "[]");
  existing.unshift({ q, a });
  sessionStorage.setItem("hub_history", JSON.stringify(existing.slice(0, 10)));
}

function appendMessage(q, a, save = true) {
  const wrap = document.createElement("div");

  const qDiv = document.createElement("div");
  qDiv.className = "question";
  qDiv.textContent = "Вопрос: " + q;

  const aDiv = document.createElement("div");
  aDiv.className = "answer";
  aDiv.textContent = "Ответ: " + a;

  wrap.appendChild(qDiv);
  wrap.appendChild(aDiv);
  chatHistory.insertBefore(wrap, chatHistory.firstChild);

  if (save) saveMessage(q, a);
  if (voiceEnabled) speakText(a);
}

function speakText(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  synth.speak(utterance);
}

// Отправка
async function sendToHub(userText) {
  appendMessage(userText, "⏳ Ждём ответ...");
  const res = await fetch("/.netlify/functions/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: userText })
  });
  const data = await res.json();
  const answer = data.text || "Ответ не получен.";
  appendMessage(userText, answer);
}

// Кнопка
voiceToggle.addEventListener("click", () => {
  voiceEnabled = !voiceEnabled;
  voiceToggle.classList.toggle("active", voiceEnabled);
  waves.style.visibility = voiceEnabled ? "visible" : "hidden";
});

sendBtn.addEventListener("click", () => {
  const text = input.value.trim();
  if (text) sendToHub(text);
});

loadHistory();
