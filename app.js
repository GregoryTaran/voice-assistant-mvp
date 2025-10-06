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
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
    const formData = new FormData();
    formData.append('audio', audioBlob);

    const response = await fetch('/.netlify/functions/ask', { method: 'POST', body: formData });
    const data = await response.json();
    status.innerText = "ИИ: " + data.reply;
    const audio = new Audio(data.audio_url);
    audio.play();
  };

  mediaRecorder.start();
  setTimeout(() => mediaRecorder.stop(), 4000); // записываем 4 секунды
}
