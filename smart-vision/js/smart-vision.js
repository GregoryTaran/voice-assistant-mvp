document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  const waves = micBtn.querySelector(".waves");
  const historyEl = document.getElementById("history");

  let isTalking = false;
  let audioContext, analyser, microphone, dataArray, stream, mediaRecorder;
  let animationId, chunkTimer;
  let audioChunks = [];
  let partialText = "";
  let lastStatus = "";
  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  micBtn.addEventListener("click", async () => {
    isTalking = !isTalking;

    if (isTalking) {
      micBtn.classList.add("active", "pulse");
      waves.classList.add("show");
      updateStatus("Разговор начался…");

      if (isMobile) {
        startMobileMode();
      } else {
        startDesktopMic();
      }

      startRecording();
    } else {
      micBtn.classList.remove("active", "pulse");
      waves.classList.remove("show");
      updateStatus("Разговор завершён.");
      stopRecording();
      stopMic();
    }
  });

  /* === РЕАЛЬНЫЙ МИКРОФОН + АНАЛИЗ ВОЛН === */
  async function startDesktopMic() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      microphone = audioContext.createMediaStreamSource(stream);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      microphone.connect(analyser);

      function animate() {
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

        let newStatus = "";
        if (volume < 3) newStatus = "Проверьте микрофон 🎙";
        else newStatus = "Говорите 🗣️";

        if (newStatus !== lastStatus) {
          updateStatus(newStatus);
          lastStatus = newStatus;
        }

        animationId = requestAnimationFrame(animate);
      }

      animate();
    } catch (err) {
      console.error("Ошибка микрофона:", err);
      updateStatus("Ошибка доступа к микрофону 😕");
    }
  }

  /* === МОБИЛЬНЫЙ РЕЖИМ (СИМУЛЯЦИЯ ВОЛН) === */
  function startMobileMode() {
    updateStatus("Говорите 🗣️");
    let pulse = 0;

    function animateMobile() {
      const scaleBase = 1 + 0.08 * Math.sin(pulse);
      const opacityBase = 0.25 + 0.2 * Math.abs(Math.sin(pulse));

      waves.querySelectorAll("span").forEach((wave, i) => {
        const scale = scaleBase + i * 0.2;
        wave.style.transform = `scale(${scale})`;
        wave.style.opacity = opacityBase - i * 0.05;
      });

      pulse += 0.15;
      if (isTalking) requestAnimationFrame(animateMobile);
    }

    animateMobile();
  }

  /* === СТАРТ ЗАПИСИ (ПСЕВДО-СТРИМ) === */
  async function startRecording() {
    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/ogg'
      ];
      let chosenType = '';
      for (const t of preferredTypes) {
        if (MediaRecorder.isTypeSupported(t)) { chosenType = t; break; }
      }

      mediaRecorder = new MediaRecorder(stream, chosenType ? { mimeType: chosenType } : undefined);
      audioChunks = [];
      partialText = "";
      historyEl.innerHTML = "";
      mediaRecorder.start();

      mediaRecorder.addEventListener("dataavailable", e => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      });

      // каждые 2 сек — отправляем чанк в Whisper
      chunkTimer = setInterval(async () => {
        if (!isTalking) return;
        if (audioChunks.length > 0) {
          const chunk = new Blob(audioChunks.splice(0), { type: mediaRecorder.mimeType || chosenType || "audio/webm" });
          await sendAudioChunk(chunk);
        }
      }, 2000);

      mediaRecorder.addEventListener("stop", async () => {
        clearInterval(chunkTimer);
        if (audioChunks.length > 0) {
          const finalBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || chosenType || "audio/webm" });
          await sendAudioChunk(finalBlob);
        }
      });
    } catch (err) {
      console.error("Ошибка записи:", err);
      updateStatus("Ошибка записи ⚠️");
    }
  }

  /* === ОСТАНОВКА ЗАПИСИ === */
  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (chunkTimer) clearInterval(chunkTimer);
  }

  /* === БАЗОВАЯ64 ФУНКЦИЯ === */
  function base64FromArrayBuffer(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000; // 32KB
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function extFromMime(mime) {
    if (!mime) return 'webm';
    if (mime.includes('ogg')) return 'ogg';
    if (mime.includes('webm')) return 'webm';
    if (mime.includes('wav')) return 'wav';
    if (mime.includes('mp3')) return 'mp3';
    if (mime.includes('m4a')) return 'm4a';
    return 'webm';
  }

  /* === ОТПРАВКА В WHISPER ЧЕРЕЗ NETLIFY === */
  async function sendAudioChunk(blob) {
    try {
      const mime = blob.type || (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
      const ext = extFromMime(mime);
      const arrayBuf = await blob.arrayBuffer();
      const base64 = base64FromArrayBuffer(arrayBuf);

      const res = await fetch("/.netlify/functions/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, mime, ext })
      });

      if (!res.ok) {
        console.error("Transcribe HTTP error:", res.status);
        return;
      }

      const data = await res.json();
      if (data && data.text) {
        partialText += (partialText ? " " : "") + data.text.trim();
        updateHistory();
      }
    } catch (err) {
      console.error("Ошибка отправки чанка:", err);
    }
  }

  /* === ВЫВОД ТЕКСТА === */
  function updateHistory() {
    historyEl.innerHTML = `<div class="message user">${partialText.trim()}</div>`;
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  /* === ГАРАНТИРОВАННОЕ ВЫКЛЮЧЕНИЕ МИКРОФОНА === */
  function stopMic() {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext) {
      try { audioContext.close(); } catch(_) {}
    }
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    updateStatus("Разговор завершён.");
  }

  /* === ПЛАВНАЯ СМЕНА СТАТУСА === */
  function updateStatus(text) {
    status.style.opacity = 0;
    setTimeout(() => {
      status.textContent = text;
      status.style.opacity = 1;
    }, 150);
  }
});
