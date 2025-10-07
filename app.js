
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
  const block = document.createElement("div");

  const qDiv = document.createElement("div");
  qDiv.className = "question";
  qDiv.textContent = "Вопрос: " + question;

  const aDiv = document.createElement("div");
  aDiv.className = "answer";
  aDiv.textContent = "Ответ: " + answer;

  block.appendChild(qDiv);
  block.appendChild(aDiv);
  container.prepend(block);

  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });
  if (history.length > 20) history.splice(0, history.length - 20);
  localStorage.setItem("history", JSON.stringify(history));
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
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
  const answer = data.text;
  addToChat(userText, answer);

  input.value = "";
  status.innerText = "Готов слушать ваш запрос…";
});

document.getElementById("speakBtn").addEventListener("click", () => {
  startRecording();
});
