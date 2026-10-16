(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const root = $("#loadingAvatar");
  const renderer = window.NovaAvatarRenderer?.create(root);
  const message = $("#spriteMessage");
  const status = $("#modelStatus");
  const openAnyway = $("#openAnyway");
  const particles = $("#particleLayer");
  let redirectTimer = null;
  let isReady = false;
  function burst(x, y) {
    const symbols = ["✦", "✧", "•", "✳"];
    for (let index = 0; index < 10; index++) {
      const particle = document.createElement("span");
      particle.className = "particle";
      particle.textContent = symbols[index % symbols.length];
      particle.style.left = `${x + (Math.random() * 70 - 35)}px`;
      particle.style.top = `${y + (Math.random() * 28 - 14)}px`;
      particle.style.animationDelay = `${Math.random() * .16}s`;
      particles.append(particle);
      setTimeout(() => particle.remove(), 1400);
    }
  }

  function react(mood, text, event) {
    root.dataset.state = mood;
    renderer?.setExpression(mood);
    message.textContent = text;
    burst(event.clientX, event.clientY);
    setTimeout(() => {
      if (root.dataset.state === mood) root.dataset.state = isReady ? "happy" : "thinking";
    }, 1500);
  }

  document.querySelectorAll("[data-mood]").forEach((button) => {
    button.addEventListener("click", (event) => react(button.dataset.mood, button.dataset.message, event));
  });
  root.addEventListener("click", (event) => react("happy", "NOVA is happy you stopped by, sir!", event));

  async function checkServer() {
    try {
      const response = await fetch("/api/status", { cache: "no-store" });
      if (!response.ok) throw new Error("NOVA is reconnecting to its local server…");
      const data = await response.json();
      openAnyway.classList.add("hidden");
      const geminiReady = navigator.onLine && data.gemini?.configured && (data.settings?.ai_provider || "auto") === "auto";
      if (data.status === "ready" || geminiReady) {
        if (isReady) return;
        isReady = true;
        status.textContent = geminiReady && data.status !== "ready"
          ? "Gemini is ready, sir. Opening text chat…"
          : "NOVA is ready, sir. Opening your workspace…";
        root.dataset.state = "happy";
        renderer?.setExpression("happy");
        $("#loadingProgress").style.width = "100%";
        $("#loadingProgress").style.animation = "none";
        clearInterval(pollTimer);
        redirectTimer = setTimeout(() => location.replace("/"), 900);
      } else if (data.status === "error") {
        status.textContent = "The local model couldn’t finish loading.";
        message.textContent = data.error || "You can still open NOVA and check its model settings.";
        root.dataset.state = "curious";
        openAnyway.classList.remove("hidden");
      } else {
        status.textContent = "Warming up Qwen3 for quick replies…";
        root.dataset.state = "thinking";
      }
    } catch {
      status.textContent = "Connecting to the local NOVA server…";
      root.dataset.state = "thinking";
    }
  }

  checkServer();
  const pollTimer = setInterval(checkServer, 1300);
  window.addEventListener("pagehide", () => {
    clearInterval(pollTimer);
    clearTimeout(redirectTimer);
  }, { once: true });
})();
