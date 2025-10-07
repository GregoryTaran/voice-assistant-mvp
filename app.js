let mediaRecorder, audioChunks = [];
let ttsEnabled = localStorage.getItem("ttsEnabled") !== "false";

const sessionId = localStorage.getItem('sessionId') || crypto.randomUUID();
localStorage.setItem('sessionId', sessionId);
const history = JSON.parse(localStorage.getItem('history') || '[]');

const ttsToggle = document.getElementById("ttsToggle");
const ttsWaves = document.getElementById("ttsWaves");
updateTtsToggle();

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
    addToChat(data.transcript, data.text);
  };

  mediaRecorder.start();
  setTimeout(() => mediaRecorder.stop(), 5000);
}

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

  if (ttsEnabled) speakText(answer);

  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  if (history.length > 20) history.splice(0, history.length - 20);
  localStorage.setItem("history", JSON.stringify(history));
}

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

function speakText(text) {
  if (!window.speechSynthesis) return;

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ru-RU";
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.volume = 1;

  // Показать волны
  ttsWaves.style.display = "inline-flex";

  utterance.onend = () => ttsWaves.style.display = "none";

  if (!ttsEnabled) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

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
  addToChat(userText, data.text);
  input.value = "";
  status.innerText = "Готов слушать ваш запрос…";
});

document.getElementById("speakBtn").addEventListener("click", () => startRecording());

// 🔊 Переключатель озвучки
ttsToggle.addEventListener("click", () => {
  ttsEnabled = !ttsEnabled;
  localStorage.setItem("ttsEnabled", ttsEnabled);
  updateTtsToggle();

  // Если выключили — мгновенно прерываем звук
  if (!ttsEnabled) {
    window.speechSynthesis.cancel();
    ttsWaves.style.display = "none";
  }
});

function updateTtsToggle() {
  if (ttsEnabled) {
    ttsToggle.classList.remove("off");
    ttsToggle.firstChild.textContent = "🔊 Озвучка включена ";
  } else {
    ttsToggle.classList.add("off");
    ttsToggle.firstChild.textContent = "🔇 Озвучка выключена ";
    ttsWaves.style.display = "none";
  }
}
