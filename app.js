let soundEnabled = true;
const toggleBtn = document.getElementById("toggle-sound");
const icon = toggleBtn.querySelector(".icon");
const label = toggleBtn.querySelector(".label");

toggleBtn.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  toggleBtn.classList.toggle("active", soundEnabled);
  icon.textContent = soundEnabled ? "🔊" : "🔇";
  label.textContent = soundEnabled ? "Звук включён" : "Звук выключен";
});

document.getElementById("sendBtn").addEventListener("click", () => {
  const input = document.getElementById("input").value.trim();
  if (input) sendToHub(input);
});

async function sendToHub(text) {
  const res = await fetch("/.netlify/functions/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const data = await res.json();
  const answer = data.text || "Нет ответа.";
  appendMessage(text, answer);
  if (soundEnabled) speak(answer);
}

function appendMessage(q, a) {
  const block = document.createElement("div");
  block.innerHTML = `<b>Вопрос:</b> ${q}<br><b>Ответ:</b> ${a}<hr>`;
  document.getElementById("chatHistory").prepend(block);
}

function speak(text) {
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "ru-RU";
  speechSynthesis.speak(utter);
}