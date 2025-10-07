let soundEnabled = true;
const input = document.getElementById("input");
const status = document.getElementById("status");
const chatHistory = document.getElementById("chatHistory");

document.getElementById("toggleSound").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  document.getElementById("toggleSound").textContent = soundEnabled ? "🔊" : "🔇";
});

function appendMessage(q, a) {
  const qEl = document.createElement("div");
  qEl.innerHTML = "<strong>Вопрос:</strong> " + q;
  const aEl = document.createElement("div");
  aEl.innerHTML = "<strong>Ответ:</strong> " + a;
  chatHistory.prepend(document.createElement("hr"));
  chatHistory.prepend(aEl);
  chatHistory.prepend(qEl);
  if (soundEnabled && a) {
    const utterance = new SpeechSynthesisUtterance(a);
    speechSynthesis.speak(utterance);
  }
}

document.getElementById("sendBtn").onclick = () => {
  const text = input.value.trim();
  if (!text) return;
  sendToServer(text);
  input.value = "";
};

document.getElementById("speakBtn").onclick = async () => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.start();
  status.textContent = "🎙️ Говорите…";

  setTimeout(() => recorder.stop(), 5000);
  recorder.onstop = async () => {
    status.textContent = "⏳ Обработка…";
    const blob = new Blob(chunks, { type: "audio/webm" });
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64 = reader.result.split(",")[1];
      sendToServer("", base64);
    };
    reader.readAsDataURL(blob);
  };
};

async function sendToServer(text, audio = null) {
  const res = await fetch("/.netlify/functions/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, audio })
  });
  const data = await res.json();
  appendMessage(data.transcript || text, data.text || "Нет ответа");
  status.textContent = "Готов слушать…";
}
