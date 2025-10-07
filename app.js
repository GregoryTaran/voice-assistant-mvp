let mediaRecorder, audioChunks = [];

function addToHistory(query, answer) {
  const history = document.getElementById("history");
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `
    <div class="q">🧑‍💬 ${query || "(без текста)"}</div>
    <div class="a">🤖 ${answer || "—"}</div>
  `;
  history.prepend(div);
}

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
      body: JSON.stringify({ audio: audioBase64 })
    });

    const data = await res.json();
    addToHistory(data.query || "(голос)", data.text);
    status.innerText = "✅ Готово";
  };

  mediaRecorder.start();
  setTimeout(() => mediaRecorder.stop(), 5000); // 5 секунд записи
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function sendText() {
  const input = document.getElementById("textInput");
  const text = input.value.trim();
  if (!text) return;

  document.getElementById("status").innerText = "⏳ Думаю…";
  const res = await fetch('/.netlify/functions/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  const data = await res.json();
  addToHistory(text, data.text);
  document.getElementById("status").innerText = "✅ Готово";
  input.value = "";
}
