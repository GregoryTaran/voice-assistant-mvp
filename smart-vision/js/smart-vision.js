document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  const waves = micBtn.querySelector(".waves");
  const historyEl = document.getElementById("history");

  let isTalking = false;
  let audioContext, analyser, microphone, dataArray, stream, mediaRecorder;
  let animationId, chunkTimer;
  let audioChunks = [];
  let silenceStart = null;
  let silenceThreshold = 3; // уровень громкости, ниже которого считаем тишину
  let silenceLimit = 4000; // 4 секунды

  micBtn.addEventListener("click", async () => {
    isTalking = !isTalking;
    if (isTalking) {
      micBtn.classList.add("active", "pulse");
      waves.classList.add("show");
      updateStatus("Разговор начался…");

      await startMic();
      startRecording();
    } else {
      stopAll("Разговор завершён.");
    }
  });

  async function startMic() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      microphone = audioContext.createMediaStreamSource(stream);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      microphone.connect(analyser);
      animateVolume();
    } catch (err) {
      console.error("Ошибка микрофона:", err);
      updateStatus("Ошибка доступа к микрофону 😕");
    }
  }

  function animateVolume() {
    analyser.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += Math.abs(dataArray[i] - 128);
    }
    const volume = sum / dataArray.length;

    waves.querySelectorAll("span").forEach((wave, i) => {
      const scale = 1 + volume / 70 + i * 0.15;
      wave.style.transform = `scale(${scale})`;
      wave.style.opacity = Math.min(0.7, volume / 50);
    });

    // Автостоп по тишине
    if (volume < silenceThreshold) {
      if (silenceStart === null) silenceStart = Date.now();
      else if (Date.now() - silenceStart > silenceLimit) {
        stopAll("Разговор завершён (тишина).");
        return;
      }
    } else {
      silenceStart = null;
    }

    if (isTalking) animationId = requestAnimationFrame(animateVolume);
  }

  async function startRecording() {
    if (!stream) await startMic();
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    mediaRecorder.start(500);

    mediaRecorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        const blob = e.data;
        sendAudioChunk(blob);
      }
    };

    mediaRecorder.onstop = () => clearInterval(chunkTimer);
  }

  async function sendAudioChunk(blob) {
    try {
      const fd = new FormData();
      fd.append("file", blob, "chunk.webm");
      const res = await fetch("/.netlify/functions/transcribe", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        console.error("Transcribe error:", res.status);
        return;
      }

      const data = await res.json();
      const text = data.text || "";
      appendLiveText(text);
    } catch (err) {
      console.error("Ошибка отправки чанка:", err);
    }
  }

  function appendLiveText(text) {
    if (!text) return;
    let live = document.getElementById("liveText");
    if (!live) {
      live = document.createElement("div");
      live.id = "liveText";
      live.className = "live-text";
      historyEl.appendChild(live);
    }

    live.textContent = text;
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function stopAll(message) {
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
    if (audioContext) audioContext.close();
    if (animationId) cancelAnimationFrame(animationId);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    isTalking = false;
    micBtn.classList.remove("active", "pulse");
    waves.classList.remove("show");
    updateStatus(message);
  }

  function updateStatus(text) {
    status.style.opacity = 0;
    setTimeout(() => {
      status.textContent = text;
      status.style.opacity = 1;
    }, 150);
  }
});
