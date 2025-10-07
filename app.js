let mediaRecorder, audioChunks = [];

// ✅ сохраняем состояние озвучки между сессиями
let ttsEnabled = localStorage.getItem("ttsEnabled") !== "false";

const sessionId = localStorage.getItem('sessionId') || crypto.randomUUID();
localStorage.setItem('sessionId', sessionId);
const history = JSON.parse(localStorage.getItem('history') || '[]');

// 🎛️ Обновляем надпись на кнопке озвучки при загрузке
const ttsToggle = document.getElementById("ttsToggle");
updateTtsToggle();

// --- МИКРОФОН ---
async function startRecording() {
  const status = document.getElementById("status");
  status.innerText = "🎙️ Слушаю...";

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    status.innerText = "⏳ Обработка запроса...";
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const audioBase64 = await blobToBase64(audioBlob);

    const response = await fetch('/.netlify/functions/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64, sessionId, history })
    });

    const data = await response.json();
    const resultText = data.text;
    const transcript = data.transcript;
    addToChat(transcript, resultText);
  };

  mediaRecorder.start();
  setTimeout(() => mediaRecorder.stop(), 5000);
}

// --- ВЫВОД В ЧАТ ---
function addToChat(question, answer) {
  const container = document.getElementById("chat");
  const wrapper = document.createElement("div");
  wrapper.className = "chat-entry";

  const qDiv = document.createElement("div");
  qDiv.className = "question";
  qDiv.textContent = "👤 " + question;

  const aDiv = document.createElement("div");
  aDiv.className = "answer";
  aDiv.innerHTML = highlightText("🤖 " + answer);

  wrapper.appendChild(qDiv);
  wrapper.appendChild(aDiv);
  container.prepend(wrapper);

  if (ttsEnabled) speakText(answer); // 🔊 озвучка

  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  if (history.length > 20) history.splice(0, history.length - 20);
  localStorage.setItem("history", JSON.stringify(history));
}

// --- ВСПОМОГАТЕЛЬНЫЕ ---
function highlightText(text) {
  text = text.replace(/(\d+[\s\d]*€)/g, '<span class="highlight-price">$1</span>');
  text = text.replace(/(\d+\s?м²)/g, '<span class="highlight-area">$1</span>');
  text = text.replace(/(Милан|Рим|Неаполь|Флоренция|Турин)/gi, '<span class="highlight-city">$1</span>');
  return text;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// --- ОЗВУЧКА ---
function speakText(text) {
  if (!window.speechSynthesis) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ru-RU";
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  // ждём, пока загрузятся голоса
  const speak = () => {
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  if (speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = speak;
  } else {
    speak();
  }
}

// --- ТЕКСТОВЫЙ ЗАПРОС ---
document.getElementById("sendBtn").addEventListener("click", async () => {
  const input = document.getElementById("input");
  const userText = input.value.trim();
  if (!userText) return;

  const status = document.getElementById("status");
  status.innerText = "⏳ Обработка запроса...";

  const response = await fetch('/.netlify/functions/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userText, sessionId, history })
  });

  const data = await response.json();
  const answer = data.text;
  addToChat(userText, answer);

  input.value = "";
  status.innerText = "Готов слушать ваш запрос…";
});

document.getElementById("speakBtn").addEventListener("click", () => startRecording());

// --- ПЕРЕКЛЮЧАТЕЛЬ ОЗВУЧКИ ---
ttsToggle.addEventListener("click", () => {
  ttsEnabled = !ttsEnabled;
  localStorage.setItem("ttsEnabled", ttsEnabled);
  updateTtsToggle();
});

function updateTtsToggle() {
  if (ttsEnabled) {
    ttsToggle.classList.remove("off");
    ttsToggle.textContent = "🔊 Озвучка включена";
    ttsToggle.title = "Нажмите, чтобы выключить";
  } else {
    ttsToggle.classList.add("off");
    ttsToggle.textContent = "🔇 Озвучка выключена";
    ttsToggle.title = "Нажмите, чтобы включить";
  }
}
