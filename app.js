
const input = document.getElementById("input");
const chatHistory = document.getElementById("chatHistory");
const status = document.getElementById("status");
const toggleSound = document.getElementById("toggleSound");
let soundEnabled = true;

// === История ===
function loadHistory() {
  const saved = sessionStorage.getItem("hub_history");
  if (!saved) return;
  const history = JSON.parse(saved);
  history.forEach(entry => appendMessage(entry.q, entry.a, false));
}
function saveMessage(q, a) {
  const existing = JSON.parse(sessionStorage.getItem("hub_history") || "[]");
  existing.unshift({ q, a });
  sessionStorage.setItem("hub_history", JSON.stringify(existing));
}
function appendMessage(q, a, save = true) {
  const wrapper = document.createElement("div");
  wrapper.className = "entry";

  const qDiv = document.createElement("div");
  qDiv.className = "question";
  qDiv.textContent = "Вопрос: " + q;

  const aDiv = document.createElement("div");
  aDiv.className = "answer";
  aDiv.textContent = "Ответ: " + a;

  wrapper.appendChild(qDiv);
  wrapper.appendChild(aDiv);
  chatHistory.insertBefore(wrapper, chatHistory.firstChild);

  if (save) saveMessage(q, a);
  if (soundEnabled) speak(a);
}

// === Отправка ===
async function sendToHub(userText, audioBase64 = null) {
  status.textContent = "⏳ Обработка запроса...";
  const body = audioBase64
    ? { audio: audioBase64, shouldGreet: false }
    : { text: userText, shouldGreet: false };

  const res = await fetch("/.netlify/functions/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  const answer = data.text || "Нет ответа.";
  const q = userText || data.transcript || "…";
  appendMessage(q, answer);
  status.textContent = "Готов слушать ваш запрос…";
  input.value = "";
}

// === Озвучка ===
async function speak(text) {
  try {
    const res = await fetch("/.netlify/functions/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    });

    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
      return;
    }
  } catch (err) {
    console.warn("Google TTS не сработал, fallback на speechSynthesis", err);
  }

  const utterance = new SpeechSynthesisUtterance(text);
  speechSynthesis.speak(utterance);
}

toggleSound.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  toggleSound.textContent = soundEnabled ? "🔊 Звук вкл." : "🔇 Звук выкл.";
  toggleSound.className = soundEnabled ? "sound-on" : "sound-off";
});

// === Кнопки ===
document.getElementById("sendBtn").addEventListener("click", () => {
  const text = input.value.trim();
  if (text) sendToHub(text);
});
document.getElementById("speakBtn").addEventListener("click", async () => {
  if (!navigator.mediaDevices) return alert("Микрофон не поддерживается.");
  status.textContent = "🎙️ Слушаю (5 секунд)...";

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.start();

  setTimeout(() => {
    recorder.stop();
    status.textContent = "⏳ Обработка речи...";
  }, 5000);

  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result.split(",")[1];
      await sendToHub("", base64);
    };
    reader.readAsDataURL(blob);
  };
});

loadHistory();
