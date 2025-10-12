document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  const waves = micBtn.querySelector(".waves");
  let isTalking = false;
  let audioContext, analyser, microphone, dataArray, stream;
  let animationId;
  let lastStatus = "";
  const isMobile = /Mobi|Android/i.test(navigator.userAgent);

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
    } else {
      micBtn.classList.remove("active", "pulse");
      waves.classList.remove("show");
      updateStatus("Разговор завершён.");
      stopMic();
    }
  });

  /* === DESKTOP MODE === */
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

        // только три чётких состояния
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

  /* === MOBILE MODE === */
  async function startMobileMode() {
    updateStatus("Говорите 🗣️");
  }

  /* === STOP === */
  function stopMic() {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext) audioContext.close();
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    updateStatus("Разговор завершён.");
  }

  /* === STATUS (плавное обновление) === */
  function updateStatus(text) {
    status.style.opacity = 0;
    setTimeout(() => {
      status.textContent = text;
      status.style.opacity = 1;
    }, 150);
  }
});
