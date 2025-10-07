const input = document.getElementById("input");
const chatHistory = document.getElementById("chatHistory");
const speakBtn = document.getElementById("speakBtn");
const sendBtn = document.getElementById("sendBtn");
const soundToggle = document.getElementById("soundToggle");

let soundEnabled = true;

// Toggle sound
soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggle.classList.toggle("sound-off");
  soundToggle.innerHTML = soundEnabled
    ? '<div class="wave-container"><div class="bar bar1"></div><div class="bar bar2"></div><div class="bar bar3"></div></div> 🔊 Озвучка включена'
    : '<div class="wave-container"><div class="bar bar1"></div><div class="bar bar2"></div><div class="bar bar3"></div></div> 🔇 Озвучка выключена';
});

function speak(text) {
  if (!soundEnabled) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ru-RU";
  speechSynthesis.speak(utterance);
}

function appendMessage(q, a) {
  const wrapper = document.createElement("div");
  const qDiv = document.createElement("div");
  const aDiv = document.createElement("div");

  qDiv.className = "question";
  aDiv.className = "answer";

  qDiv.textContent = "Вопрос: " + q;
  aDiv.textContent = "Ответ: " + a;

  wrapper.appendChild(qDiv);
  wrapper.appendChild(aDiv);

  chatHistory.insertBefore(wrapper, chatHistory.firstChild);

  speak(a);
}

async function sendToHub(userText, audioBase64 = null) {
  const body = audioBase64
    ? { audio: audioBase64, shouldGreet: false }
    : { text: userText, shouldGreet: false };

  const res = await fetch("/.netlify/functions/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  const answer = data.text || "Нет ответа.";

  appendMessage(userText || data.transcript, answer);
  input.value = "";
}

sendBtn.addEventListener("click", () => {
  const text = input.value.trim();
  if (text) sendToHub(text);
});

speakBtn.addEventListener("click", async () => {
  if (!navigator.mediaDevices) return alert("Микрофон не поддерживается.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = e => chunks.push(e.data);
  recorder.start();

  setTimeout(() => recorder.stop(), 5000);

  recorder.onstop = async () => {
    const blob = new Blob(chunks, { type: "audio/webm" });
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64 = reader.result.split(",")[1];
      await sendToHub("", base64);
    };
    reader.readAsDataURL(blob);
  };
});