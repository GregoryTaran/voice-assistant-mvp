document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  const waves = micBtn.querySelector(".waves");
  const historyEl = document.getElementById("history");

  let isTalking = false;
  let audioContext, analyser, microphone, dataArray, stream;
  let animationId;
  let lastStatus = "";
  let currentText = "";

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  micBtn.addEventListener("click", async () => {
    isTalking = !isTalking;

    if (isTalking) {
      micBtn.classList.add("active", "pulse");
      waves.classList.add("show");
      updateStatus("Разговор начался…");

      // очищаем прошлый текст
      currentText = "";
      historyEl.innerHTML = "";

      if (isMobile) {
        startMobileMode();
      } else {
        startDesktopMic();
      }
    } else {
      micBtn.classList.remove("active", "pulse");
      waves.classList.remove("show");
      stopMic();
      updateStatus("Разговор завершён.");
    }
  });

  /* === МИКРОФОН (ДЕСКТОП) === */
  async function startDesktopMic() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioContext.createAnalyser();
      microphone = audioContext.createMediaStreamSource(stream);
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      microphone.connect(analyser);

      animateVolume();
      startStreaming();
    } catch (err) {
      console.error("Ошибка микрофона:", err);
      updateStatus("Ошибка доступа к микрофону 😕");
    }
  }

  /* === АНАЛИЗ ЗВУКА === */
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

    let newStatus = "";
    if (volume < 3) newStatus = "Проверьте микрофон 🎙";
    else newStatus = "Говорите 🗣️";

    if (newStatus !== lastStatus) {
      updateStatus(newStatus);
      lastStatus = newStatus;
    }

    if (isTalking) animationId = requestAnimationFrame(animateVolume);
  }

  /* === МОБИЛЬНАЯ ИМИТАЦИЯ === */
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

  /* === ОСТАНОВКА === */
  function stopMic() {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext) audioContext.close();
    if (stream) stream.getTracks().forEach((t) => t.stop());
  }

  function updateStatus(text) {
    status.style.opacity = 0;
    setTimeout(() => {
      status.textContent = text;
      status.style.opacity = 1;
    }, 150);
  }

  /* === СТРИМИНГ ОТ СЕРВЕРА === */
  async function startStreaming() {
    try {
      // важная правка — POST, а не GET
      const res = await fetch("/.netlify/functions/transcribe", {
        method: "POST",
      });

      if (!res.ok) throw new Error("Ошибка сервера");
      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");

      let buffer = "";
      while (isTalking) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // пробуем достать JSON куски
        const parts = buffer.split("\n");
        for (let i = 0; i < parts.length - 1; i++) {
          try {
            const data = JSON.parse(parts[i]);
            if (data.text) appendTypedText(data.text);
          } catch {}
        }
        buffer = parts[parts.length - 1];
      }
    } catch (err) {
      console.error("Streaming error:", err);
      updateStatus("Ошибка подключения 🔌");
    }
  }

  /* === ЖИВОЕ ДОПЕЧАТЫВАНИЕ === */
  function appendTypedText(newText) {
    if (!newText || !isTalking) return;
    if (!historyEl.querySelector("#liveText")) {
      const div = document.createElement("div");
      div.id = "liveText";
      div.className = "live-text";
      historyEl.appendChild(div);
    }
    const live = document.getElementById("liveText");
    const diff = newText.replace(currentText, "");
    currentText = newText;

    const span = document.createElement("span");
    span.textContent = diff;
    span.className = "typed";
    live.appendChild(span);
  }
});
