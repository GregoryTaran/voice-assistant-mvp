// smart-vision.js v6 — правильная передача WebM в Whisper
let mediaRecorder;
let isRecording = false;
let silenceTimer;
let audioChunks = [];
const micBtn = document.getElementById("micBtn");
const output = document.getElementById("output") || document.getElementById("history");

micBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  else startRecording();
});

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    isRecording = true;
    micBtn.classList.add("active");
    appendText("🎤 Recording started...\n");

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && isRecording) {
        await sendAudioChunk(event.data);
        resetSilenceTimer();
      }
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      micBtn.classList.remove("active");
      appendText("🎤 Recording stopped.\n");
      clearTimeout(silenceTimer);
    };

    mediaRecorder.start(2000);
    resetSilenceTimer();

  } catch (err) {
    console.error("Mic error:", err);
    appendText("🎙 Ошибка микрофона: " + err.message);
  }
}

function stopRecording() {
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

function resetSilenceTimer() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    console.log("⏱ Silence timeout reached — stopping mic");
    stopRecording();
  }, 4000);
}

async function sendAudioChunk(blob) {
  try {
    const formData = new FormData();
    formData.append("file", blob, "chunk.webm");

    const response = await fetch("/.netlify/functions/transcribe", {
      method: "POST",
      body: formData
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.text) appendText(data.text);

  } catch (err) {
    console.error("Transcribe error:", err);
  }
}

function appendText(text) {
  const p = document.createElement("p");
  p.textContent = text;
  output.appendChild(p);
  window.scrollTo(0, document.body.scrollHeight);
}
