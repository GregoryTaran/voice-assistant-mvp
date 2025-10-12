document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  let isTalking = false;

  micBtn.addEventListener("click", () => {
    isTalking = !isTalking;

    if (isTalking) {
      micBtn.classList.add("active");
      status.textContent = "Разговор начался…";
    } else {
      micBtn.classList.remove("active");
      status.textContent = "Разговор завершён.";
    }
  });
});
