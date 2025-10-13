// smart-vision.js v4
let mediaRecorder;
let audioChunks = [];
let isRecording = false;
let silenceTimer;
const output = document.getElementById("output");

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    isRecording = true;
    audioChunks = [];
    output.innerHTML = "🎤 Recording started<br>";

    mediaRecorder.ondataavailable = async (event) => {
      if (event.data.size > 0 && isRecording) {
        audioChunks.push(event.data);
        await sendAudioChunk(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      output.innerHTML += "🎤 Recording stopped<br>";
    };

    mediaRecorder.start(2000); // каждые 2 секунды чанк
    resetSilenceTimer();

  } catch (err) {
    console.error("Mic error:", err);
    output.innerHTML = "🎙 Ошибка микрофона: " + err.message;
  }
}

async function stopRecording() {
  isRecording = false;
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
  clearTimeout(silenceTimer);
}

function resetSilenceTimer() {
  clearTimeout(silenceTimer);
  silenceTimer = setTimeout(() => {
    console.log("⏱ Silence timeout reached — stopping mic");
    stopRecording();
  }, 4000); // ⏳ 4 секунды тишины — стоп
}

async function sendAudioChunk(chunk) {
  try {
    const arrayBuffer = await chunk.arrayBuffer();
    const base64Audio = btoa(
      new Uint8Array(arrayBuffer)
        .reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    const response = await fetch("/.netlify/functions/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: base64Audio
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data.text) {
      appendText(data.text);
      resetSilenceTimer();
    }

  } catch (err) {
    console.error("Transcribe error:", err.message);
  }
}

function appendText(text) {
  const span = document.createElement("span");
  span.textContent = " " + text;
  output.appendChild(span);
  window.scrollTo(0, document.body.scrollHeight);
}

document.getElementById("startBtn").addEventListener("click", startRecording);
document.getElementById("stopBtn").addEventListener("click", stopRecording);
