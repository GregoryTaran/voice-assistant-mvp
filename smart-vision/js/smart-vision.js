document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  const waves = micBtn.querySelector(".waves");
  const historyEl = document.getElementById("history");

  let isTalking = false;
  let audioContext, analyser, microphone, dataArray, stream, mediaRecorder;
  let animationId, chunkTimer;
  let audioChunks = [];
  let lastStatus = "";
  let currentText = "";

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  micBtn.addEventListener("click", async () => {
    isTalking = !isTalking;

    if (isTalking) {
      micBtn.classList.add("active", "pulse");
      waves.classList.add("show");
      updateStatus("Разговор начался…");

      // чистим экран/состояние
      currentText = "";
      historyEl.innerHTML = "";

      if (isMobile) {
        startMobileMode();
        await ensureStream();
      } else {
        await startDesktopMic();
      }

      await startRecording(); // начинаем реальные чанки
    } else {
      micBtn.classList.remove("active", "pulse");
      waves.classList.remove("show");
      stopRecording();
      stopMic();
      updateStatus("Разговор завершён.");
    }
  });

  /* === получение разрешения на микрофон (если мобильный режим) === */
  async function ensureStream() {
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        console.error("Микрофон недоступен:", e);
        updateStatus("Ошибка доступа к микрофону 😕");
      }
    }
  }

  /* === ДЕСКТОП: визуализация + доступ к микрофону === */
  async function startDesktopMic() {
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

  /* === АНАЛИЗ ЗВУКА ДЛЯ ВОЛН/СТАТУСА === */
  function animateVolume() {
    if (!analyser) return;
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

    const newStatus = volume < 3 ? "Проверьте микрофон 🎙" : "Говорите 🗣️";
    if (newStatus !== lastStatus) {
      updateStatus(newStatus);
      lastStatus = newStatus;
    }

    if (isTalking) animationId = requestAnimationFrame(animateVolume);
  }

  /* === МОБИЛЬНАЯ АНИМАЦИЯ ВОЛН === */
  function startMobileMode() {
    updateStatus("Говорите 🗣️");
    let pulse = 0;
    (function animateMobile() {
      const scaleBase = 1 + 0.08 * Math.sin(pulse);
      const opacityBase = 0.25 + 0.2 * Math.abs(Math.sin(pulse));
      waves.querySelectorAll("span").forEach((wave, i) => {
        const scale = scaleBase + i * 0.2;
        wave.style.transform = `scale(${scale})`;
        wave.style.opacity = opacityBase - i * 0.05;
      });
      pulse += 0.15;
      if (isTalking) requestAnimationFrame(animateMobile);
    })();
  }

  /* === ЗАПИСЬ И ОТПРАВКА ЧАНКОВ === */
  async function startRecording() {
    try {
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      // выбираем максимально совместимый формат
      const preferred = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ];
      let chosenType = "";
      for (const t of preferred) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) {
          chosenType = t; break;
        }
      }

      mediaRecorder = new MediaRecorder(stream, chosenType ? { mimeType: chosenType } : undefined);
      audioChunks = [];
      mediaRecorder.start(250); // часто отдаёт dataavailable

      mediaRecorder.addEventListener("dataavailable", (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      });

      // каждые 2 сек шлём накопившееся
      chunkTimer = setInterval(async () => {
        if (!isTalking) return;
        if (audioChunks.length > 0) {
          const blob = new Blob(audioChunks.splice(0), {
            type: mediaRecorder.mimeType || chosenType || "audio/webm",
          });
          await sendAudioChunk(blob);
        }
      }, 2000);

      mediaRecorder.addEventListener("stop", async () => {
        clearInterval(chunkTimer);
        if (audioChunks.length > 0) {
          const finalBlob = new Blob(audioChunks, {
            type: mediaRecorder.mimeType || chosenType || "audio/webm",
          });
          await sendAudioChunk(finalBlob);
        }
      });
    } catch (err) {
      console.error("Ошибка записи:", err);
      updateStatus("Ошибка записи ⚠️");
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (chunkTimer) clearInterval(chunkTimer);
  }

  /* === ДОСТАВКА ЧАНКА: сначала пытаемся JSON base64, если не примут — FormData === */
  async function sendAudioChunk(blob) {
    try {
      const mime = blob.type || (mediaRecorder && mediaRecorder.mimeType) || "audio/webm";
      const ext = extFromMime(mime);

      // 1) Попытка JSON base64 (как в твоём transcribe.js)
      const arrayBuf = await blob.arrayBuffer();
      const base64 = base64FromArrayBuffer(arrayBuf);
      let res = await fetch("/.netlify/functions/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio: base64, mime, ext }),
      });

      // если сервер не принял JSON — пробуем FormData
      if (!res.ok) {
        // 2) fallback: multipart/form-data
        const fd = new FormData();
        fd.append("file", blob, `chunk.${ext}`);
        fd.append("mime", mime);
        res = await fetch("/.netlify/functions/transcribe", { method: "POST", body: fd });
      }

      if (!res.ok) {
        console.error("Transcribe HTTP error:", res.status);
        return;
      }

      const data = await res.json();

      // поддержим оба варианта ответа:
      // { text: "..." } ИЛИ просто строка
      const text = (typeof data === "string") ? data : data.text;
      if (text) appendTypedTextSegment(text);
    } catch (err) {
      console.error("Ошибка отправки чанка:", err);
    }
  }

  /* === ВСПОМОГАТЕЛЬНЫЕ === */
  function base64FromArrayBuffer(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function extFromMime(mime) {
    if (!mime) return "webm";
    if (mime.includes("ogg")) return "ogg";
    if (mime.includes("webm")) return "webm";
    if (mime.includes("wav")) return "wav";
    if (mime.includes("mp3")) return "mp3";
    if (mime.includes("m4a")) return "m4a";
    return "webm";
  }

  /* === МЯГКИЙ ВЫВОД: добавляем только «разницу» сегмента === */
  function appendTypedTextSegment(segmentText) {
    if (!segmentText) return;

    let live = document.getElementById("liveText");
    if (!live) {
      live = document.createElement("div");
      live.id = "liveText";
      live.className = "live-text";
      historyEl.appendChild(live);
    }

    const cleaned = segmentText.trim();

    // если API возвращает полный кумулятивный текст — берём разницу;
    // если возвращает только новый фрагмент — просто добавим.
    let toAppend = cleaned;
    if (currentText && cleaned.startsWith(currentText)) {
      toAppend = cleaned.slice(currentText.length);
    }
    if (!toAppend) toAppend = cleaned;

    currentText = cleaned.length >= currentText.length ? cleaned : currentText + " " + cleaned;

    const span = document.createElement("span");
    span.className = "typed";
    span.textContent = toAppend + " ";
    live.appendChild(span);

    // мягкая автопрокрутка вниз
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  /* === STOP === */
  function stopMic() {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext) { try { audioContext.close(); } catch (_) {} }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  }

  function updateStatus(text) {
    status.style.opacity = 0;
    setTimeout(() => {
      status.textContent = text;
      status.style.opacity = 1;
    }, 150);
  }
});
