let mediaRecorder, audioChunks = [];
const sessionId = localStorage.getItem('sessionId') || crypto.randomUUID();
localStorage.setItem('sessionId', sessionId);

const history = JSON.parse(localStorage.getItem('history') || '[]');

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

function addToChat(question, answer) {
  const container = document.getElementById("chat");

  const wrapper = document.createElement("div");
  wrapper.className = "chat-entry";
  wrapper.style.opacity = 0;
  wrapper.style.transition = "opacity 0.5s ease";

  const qDiv = document.createElement("div");
  qDiv.className = "question";
  qDiv.textContent = "👤 " + question;

  const aDiv = document.createElement("div");
  aDiv.className = "answer";
  aDiv.innerHTML = highlightText("🤖 " + answer);

  wrapper.appendChild(qDiv);
  wrapper.appendChild(aDiv);
  container.prepend(wrapper);

  setTimeout(() => (wrapper.style.opacity = 1), 50);

  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  if (history.length > 20) history.splice(0, history.length - 20);
  localStorage.setItem("history", JSON.stringify(history));
}

function highlightText(text) {
  // выделяем числа и евро
  text = text.replace(/(\\d+[\\s\\d]*€)/g, '<span class="highlight-price">$1</span>');
  // выделяем метраж
  text = text.replace(/(\\d+\\s?м²)/g, '<span class="highlight-area">$1</span>');
  // выделяем названия городов
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

// Кнопка отправки текста
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
