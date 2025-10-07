let mediaRecorder = null;
let audioChunks = [];
let currentStream = null;
let isRecording = false;

// Для VAD (детектор речи)
let audioCtx = null;
let analyser = null;
let vadTimer = null;
let hadSpeech = false;

// История в sessionStorage
const MAX_TURNS = 10;
let convo = JSON.parse(sessionStorage.getItem("clarity_history") || "[]");

function saveHistory() {
  sessionStorage.setItem("clarity_history", JSON.stringify(convo.slice(-MAX_TURNS * 2)));
}

function addToHistory(query, answer) {
  const history = document.getElementById("history");
  const div = document.createElement("div");
  div.className = "item";
  div.innerHTML = `
    <div class="q">🧑‍💬 ${query || "(без текста)"} </div>
    <div class="a">🤖 ${answer || "—"}</div>
  `;
  history.prepend(div);

  if (query) convo.push({ role: "user", content: query });
  if (answer) convo.push({ role: "assistant", content: answer });
  convo = convo.slice(-MAX_TURNS * 2);
  saveHistory();
}

window.addEventListener("DOMContentLoaded", () => {
  for (let i = Math.max(0, convo.length - MAX_TURNS * 2); i < convo.length; i += 2) {
    const q = convo[i]?.content || "";
    const a = convo[i + 1]?.content || "";
    if (!q && !a) continue;
    const history = document.getElementById("history");
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="q">🧑‍💬 ${q || "(без текста)"} </div>
      <div class="a">🤖 ${a || "—"}</div>
    `;
    history.prepend(div);
  }
});

function clipConvoForSend() {
  const maxChars = 6000;
  let acc = [];
  let total = 0;
  for (let i = convo.length - 1; i >= 0; i--) {
    const s = (convo[i].content || "").slice(0, 1000);
    if (total + s.length > maxChars) break;
    acc.unshift({ role: convo[i].role, content: s });
    total += s.length;
  }
  return acc;
}

function setUIRecording(on, note) {
  const status = document.getElementById("status");
  const micBtn = document.getElementById("micBtn");
  const sendBtn = document.getElementById("sendBtn");
  const input = document.getElementById("textInput");
  if (on) {
    status.innerText = note || "🎤 Слушаю… (5 сек)";
    micBtn.textContent = "⏳ Идёт запись…";
    micBtn.disabled = true;
    sendBtn.disabled = true;
    input.disabled = true;
  } else {
    status.innerText = note || "Готово";
    micBtn.textContent = "🎤 Говорить (5 сек)";
    micBtn.disabled = false;
    sendBtn.disabled = false;
    input.disabled = false;
  }
}

/* ---------- ONE-SHOT RECORD (5 сек) с VAD ---------- */
async function startOneShotRecording() {
  if (isRecording) return;
  try {
    setUIRecording(true, "🎤 Слушаю… (5 сек)");
    hadSpeech = false;

    // 1) Доступ к микрофону
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    currentStream = stream;
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    isRecording = true;

    // 2) VAD через WebAudio (оценка RMS)
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);

    const buf = new Uint8Array(analyser.fftSize);
    const THRESHOLD = 10; // чем меньше — тем чувствительнее (амплитуда 0..255)
    const FRAMES_REQUIRED = 5; // требуем кол-во "громких" сэмплов подряд
    let hotFrames = 0;

    vadTimer = setInterval(() => {
      analyser.getByteTimeDomainData(buf);
      // оценим RMS
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] - 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / buf.length); // ~0..~40
      if (rms > THRESHOLD) {
        hotFrames++;
        if (hotFrames >= FRAMES_REQUIRED) hadSpeech = true;
      } else {
        hotFrames = Math.max(0, hotFrames - 1);
      }
    }, 50);

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // гасим всё
      clearInterval(vadTimer); vadTimer = null;
      try { audioCtx && audioCtx.close(); } catch {}
      audioCtx = null; analyser = null;

      isRecording = false;
      try {
        if (currentStream) {
          currentStream.getTracks().forEach(t => t.stop());
          currentStream = null;
        } else if (mediaRecorder && mediaRecorder.stream) {
          mediaRecorder.stream.getTracks().forEach(t => t.stop());
        }
      } catch {}

      // если вкладка стала неактивной — ничего не отправляем
      if (document.hidden) { setUIRecording(false, "⏸ Микрофон отключён — вкладка неактивна"); return; }

      // Если речи не было — игнорируем
      if (!hadSpeech || !audioChunks.length) {
        setUIRecording(false, "🤫 Тишина — ничего не отправляю");
        return;
      }

      // Отправляем на сервер
      const status = document.getElementById("status");
      if (status) status.innerText = "⏳ Распознаю и думаю…";
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      audioChunks = [];

      const audioBase64 = await blobToBase64(audioBlob);
      const res = await fetch("/.netlify/functions/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio: audioBase64,
          history: clipConvoForSend(),
          shouldGreet: convo.length === 0
        })
      });
      const data = await res.json();
      addToHistory(data.query || "(голос)", data.text);
      setUIRecording(false, "✅ Готово");
    };

    // Старт
    mediaRecorder.start();

    // Авто-стоп через 5 секунд
    setTimeout(() => {
      if (isRecording && mediaRecorder?.state === "recording") mediaRecorder.stop();
    }, 5000);

  } catch (e) {
    console.error(e);
    isRecording = false;
    setUIRecording(false, "❌ Ошибка доступа к микрофону");
  }
}

// Стоп при уходе/сокрытии вкладки
document.addEventListener("visibilitychange", () => {
  if (document.hidden && isRecording && mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
  }
});
window.addEventListener("pagehide", () => {
  if (isRecording && mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
  }
});

// Вспомогательные
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result.split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

/* ---------- Текстовый ввод (как было) ---------- */
async function sendText() {
  const input = document.getElementById("textInput");
  const text = input.value.trim();
  if (!text) return;

  document.getElementById("status").innerText = "⏳ Думаю…";
  const res = await fetch("/.netlify/functions/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      history: clipConvoForSend(),
      shouldGreet: convo.length === 0
    })
  });

  const data = await res.json();
  addToHistory(text, data.text);
  document.getElementById("status").innerText = "✅ Готово";
  input.value = "";
}

function handleKey(e) {
  if (e.key === "Enter") sendText();
}

// Экспорт
window.startOneShotRecording = startOneShotRecording;
window.sendText = sendText;
window.handleKey = handleKey;
