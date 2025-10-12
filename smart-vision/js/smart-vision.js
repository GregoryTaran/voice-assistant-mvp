document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  const waves = micBtn.querySelector(".waves");
  let isTalking = false;
  let audioContext, analyser, microphone, dataArray, stream;
  let animationId;
  let lastStatus = "";

  micBtn.addEventListener("click", async () => {
    isTalking = !isTalking;

    if (isTalking) {
      micBtn.classList.add("active", "pulse");
      waves.classList.add("show");
      updateStatus("Разговор начался…");
      startMicVisualization();
    } else {
      micBtn.classList.remove("active", "pulse");
      waves.classList.remove("show");
      updateStatus("Разговор завершён.");
      stopMicVisualization(true); // 👈 гарантированно останавливаем
    }
  });

  async function startMicVisualization() {
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

        const scale = 1 + volume / 60;
        const opacity = Math.min(0.8, volume / 80);

        waves.querySelectorAll("span").forEach((wave, i) => {
          wave.style.transform = `scale(${scale + i * 0.2})`;
          wave.style.opacity = opacity;
        });

        let newStatus = "";
        if (volume < 2) {
          newStatus = "Проверьте микрофон 🎙";
        } else if (volume < 10) {
          newStatus = "Говорите чуть громче 🗣️";
        } else if (volume < 35) {
          newStatus = "Слышу отлично 👂";
        } else {
          newStatus = "Очень громко! 🔊";
        }

        if (newStatus !== lastStatus) {
          updateStatus(newStatus);
          lastStatus = newStatus;
        }

        animationId = requestAnimationFrame(animate);
      }

      animate();
    } catch (err) {
      console.error("Ошибка доступа к микрофону:", err);
      updateStatus("Ошибка доступа к микрофону 😕");
      isTalking = false;
    }
  }

  function stopMicVisualization(forceStop = false) {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext) audioContext.close();

    // 🔒 Полное отключение микрофона
    if (forceStop && stream) {
      const tracks = stream.getTracks();
      tracks.forEach((track) => track.stop());
      stream = null;
      console.log("[Smart Vision] Микрофон полностью отключён ✅");
    }

    updateStatus("Разговор завершён.");
  }

  function updateStatus(text) {
    status.style.opacity = 0;
    setTimeout(() => {
      status.textContent = text;
      status.style.opacity = 1;
    }, 200);
  }
});
