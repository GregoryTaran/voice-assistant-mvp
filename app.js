let mediaRecorder, audioChunks = [];

async function startRecording() {
  const status = document.getElementById("status");
  status.innerText = "🎤 Слушаю...";
  
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    status.innerText = "⏳ Обработка...";
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const audioBase64 = await blobToBase64(audioBlob);

    const response = await fetch('/.netlify/functions/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64 })
    });

    const data = await response.json();
    document.getElementById("responseText").innerText = data.text || "Ошибка";
    status.innerText = "✅ Готово";
  };

  mediaRecorder.start();
  setTimeout(() => {
    mediaRecorder.stop();
  }, 5000); // ограничение записи 5 секунд
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

  document.getElementById("status").innerText = "⏳ Обработка текста...";
  const response = await fetch('/.netlify/functions/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });

  const data = await response.json();
  document.getElementById("responseText").innerText = data.text || "Ошибка";
  document.getElementById("status").innerText = "✅ Готово";

  input.value = ""; // 🧹 очистка поля
}
