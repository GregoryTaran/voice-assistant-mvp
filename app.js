let mediaRecorder, audioChunks = [];

async function startRecording() {
  const status = document.getElementById("status");
  status.innerText = "Слушаю...";

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];

  mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
  mediaRecorder.onstop = async () => {
    status.innerText = "Обработка запроса...";

    // Собираем blob
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

    // Конвертируем в base64
    const audioBase64 = await blobToBase64(audioBlob);

    // Отправляем JSON
    const response = await fetch('/.netlify/functions/ask', { 
      method: 'POST', 
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: audioBase64 })
    });

    const data = await response.json();
    status.innerText = "ИИ: " + data.reply;
  };

  mediaRecorder.start();
  setTimeout(() => mediaRecorder.stop(), 4000); // записываем 4 секунды
}

// Вспомогательная функция конвертации
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
