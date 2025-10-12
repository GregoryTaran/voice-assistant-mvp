document.addEventListener("DOMContentLoaded", () => {
  const micBtn = document.getElementById("micBtn");
  const status = document.getElementById("status");
  let isTalking = false;

  micBtn.addEventListener("click", () => {
    isTalking = !isTalking;

    if (isTalking) {
      micBtn.classList.add("active", "pulse");
      micBtn.querySelector(".waves").classList.add("show");
      status.textContent = "Разговор начался…";
    } else {
      micBtn.classList.remove("active", "pulse");
      micBtn.querySelector(".waves").classList.remove("show");
      status.textContent = "Разговор завершён.";
    }
  });
});
