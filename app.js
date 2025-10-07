let mediaRecorder = null;
let currentStream = null;
let audioChunks = [];
let isRecording = false;

// Включаем авто-возврат записи после первого ручного старта
let allowAutoResume = false;

// Запуск записи
async function startRecording() {
  if (isRecording) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    currentStream = stream;
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    isRecording = true;
    allowAutoResume = true; // теперь можно автоперезапускать при возврате на вкладку

    setMicUI(true);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      isRecording = false;

      // гасим индикатор микрофона
      try {
        if (currentStream) {
          currentStream.getTracks().forEach(t => t.stop());
          currentStream = null;
        } else if (mediaRecorder && mediaRecorder.stream) {
          mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
      } catch {}

      // если мы останавливались из-за скрытия вкладки — просто выходим
      if (document.hidden) {
        setMicUI(false);
        return;
      }

      // обычное завершение: отправляем на сервер
      if (!audioChunks.length) { setMicUI(false); return; }
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      audioChunks = [];
      const audioBase64 = await blobToBase64(audioBlob);

      const res = await fetch("/.netlify/functions/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: audioBase64,
          history: clipConvoForSend?.() || [],
          shouldGreet: (window.convo?.length || 0) === 0
        })
      });
      const data = await res.json();
      addToHistory?.(data.query || "(голос)", data.text);
      setMicUI(false);
      const s2 = document.getElementById("status"); if (s2) s2.innerText = "✅ Готово";
    };

    mediaRecorder.start(); // запись идёт, пока сами не остановим
  } catch (e) {
    console.error(e);
    isRecording = false;
    setMicUI(false);
    const s = document.getElementById("status"); if (s) s.innerText = "❌ Нет доступа к микрофону";
  }
}

// Остановка записи
function stopRecording(reasonText) {
  if (mediaRecorder && isRecording && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    const s = document.getElementById("status");
    if (s && reasonText) s.innerText = reasonText;
  }
}

// Авто-старт/стоп по активности вкладки
document.addEventListener("visibilitychange", async () => {
  if (document.hidden) {
    // вкладка стала неактивной — всегда выключаем микрофон
    stopRecording("⏸ Микрофон отключён — вкладка неактивна");
  } else {
    // вкладка снова активна — включаем микрофон, если разрешён авто-возврат
    if (allowAutoResume && !isRecording) {
      const s = document.getElementById("status"); if (s) s.innerText = "🎤 Возобновляю запись…";
      await startRecording();
    }
  }
});

// На уход/перезагрузку страницы — стоп
window.addEventListener("pagehide", () => {
  stopRecording("⏸ Микрофон отключён — страница скрыта");
});

// Кнопка — явный старт/стоп
function toggleRecording() {
  const micBtn = document.getElementById("micBtn");
  const state = micBtn?.dataset.state;
  if (state === "recording") {
    stopRecording("⏹ Останавливаю запись…");
  } else {
    startRecording();
  }
}

/* Вспомогательные UI/утилиты — оставь как есть у тебя */
function setMicUI(active) {
  const status = document.getElementById("status");
  const micBtn = document.getElementById("micBtn");
  const sendBtn = document.getElementById("sendBtn");
  const input = document.getElementById("textInput");
  if (active) {
    status && (status.innerText = "🎤 Запись идёт… вкладка активна");
    if (micBtn) { micBtn.textContent = "⏹ Остановить"; micBtn.dataset.state = "recording"; }
    if (sendBtn) sendBtn.disabled = true;
    if (input) input.disabled = true;
  } else {
    status && (status.innerText = "Готово");
    if (micBtn) { micBtn.textContent = "🎤 Говорить"; micBtn.dataset.state = "idle"; }
    if (sendBtn) sendBtn.disabled = false;
    if (input) input.disabled = false;
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

// Экспорт
window.toggleRecording = toggleRecording;
