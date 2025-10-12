document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  const waves = micBtn.querySelector(".waves");
  let isTalking = false;
  let audioContext, analyser, microphone, dataArray;
  let animationId;

  micBtn.addEventListener("click", async () => {
    isTalking = !isTalking;

    if (isTalking) {
      micBtn.classList.add("active", "pulse");
      waves.classList.add("show");
      status.textContent = "Разговор начался…";
      startMicVisualization();
    } else {
      micBtn.classList.remove("active", "pulse");
      waves.classList.remove("show");
      status.textContent = "Разговор завершён.";
      stopMicVisualization();
    }
  });

  async function startMicVisualization() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

        // визуальные волны
        waves.querySelectorAll("span").forEach((wave, i) => {
          wave.style.transform = `scale(${scale + i * 0.2})`;
          wave.style.opacity = opacity;
        });

        // 💬 текстовая реакция на громкость
        if (volume < 5) {
          status.textContent = "Я вас не слышу… 🎧";
        } else if (volume < 15) {
          status.textContent = "Говорите чуть громче 🗣️";
        } else if (volume < 35) {
          status.textContent = "Слышу отлично 👂";
        } else {
          status.textContent = "Очень громко! 🔊";
        }

        animationId = requestAnimationFrame(animate);
      }

      animate();
    } catch (err) {
      console.error("Ошибка доступа к микрофону:", err);
      status.textContent = "Ошибка доступа к микрофону 😕";
      isTalking = false;
    }
  }

  function stopMicVisualization() {
    if (animationId) cancelAnimationFrame(animationId);
    if (audioContext) audioContext.close();
    status.textContent = "Разговор завершён.";
  }
});
