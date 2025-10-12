// app.js
let mediaRecorder;
let audioChunks = [];
let isRecording = false;

const recordBtn = document.getElementById("recordBtn");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");

recordBtn.addEventListener("click", async () => {
  if (!isRecording) startRecording();
  else stopRecording();
});

async function startRecording() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];
  isRecording = true;

  statusEl.textContent = "🎙 Говорите...";
  recordBtn.textContent = "⏹ Завершить";

  mediaRecorder.start();

  mediaRecorder.addEventListener("dataavailable", e => {
    audioChunks.push(e.data);
  });

  mediaRecorder.addEventListener("stop", async () => {
    const audioBlob = new Blob(audioChunks, { type: "audio/wav" });
    await sendAudioChunk(audioBlob);
  });

  // каждые 2 секунды — псевдостриминг
  const chunkTimer = setInterval(async () => {
    if (!isRecording) {
      clearInterval(chunkTimer);
      return;
    }
    if (audioChunks.length > 0) {
      const chunk = new Blob(audioChunks.splice(0), { type: "audio/wav" });
      await sendAudioChunk(chunk);
    }
  }, 2000);
}

function stopRecording() {
  isRecording = false;
  mediaRecorder.stop();
  statusEl.textContent = "✅ Завершено";
  recordBtn.textContent = "🎤 Начать";
}

async function sendAudioChunk(blob) {
  try {
    const res = await fetch("/.netlify/functions/transcribe", {
      method: "POST",
      body: blob,
    });
    const data = await res.json();
    if (data.text) {
      outputEl.textContent += " " + data.text.trim();
    }
  } catch (err) {
    console.error("Ошибка при отправке чанка:", err);
  }
}
