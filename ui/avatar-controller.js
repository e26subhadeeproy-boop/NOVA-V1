(function () {
  const labels = {
    idle: "Here with you",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    happy: "Glad to help!",
    confused: "Let me think…",
    error: "A little hiccup",
    sleep: "Taking a tiny pause",
  };

  function create(root) {
    if (!root) return null;
    const art = window.NovaAvatarRenderer?.create(root);
    const status = document.querySelector("#avatarStatus");
    const waveform = document.querySelector("#avatarWaveform");
    const statusBar = document.querySelector("#voiceStatusBar");
    const statusLabel = document.querySelector("#voiceStatusLabel");
    const statusDetail = document.querySelector("#voiceStatusDetail");
    let sleepTimer;
    let happyTimer;
    let current = "idle";
    let animationsEnabled = true;
    let profileTimer;
    let profileIndex = 0;
    const bodies = ["nova-float", "nova-sway", "nova-bop", "nova-peek", "nova-wiggle", "nova-puff"];
    const eyes = ["nova-blink", "nova-curious", "nova-sparkle", "nova-focus", "nova-wink", "nova-wide"];
    const profiles = bodies.flatMap((body, bodyIndex) => eyes.map((eye, eyeIndex) => ({
      name: `m${bodyIndex + 1}-e${eyeIndex + 1}`, body, eye,
    })));
    const activityWake = () => {
      if (current === "sleep") setState("idle");
      else if (current === "idle") resetSleepTimer();
    };
    window.addEventListener("pointerdown", activityWake, { passive: true });
    window.addEventListener("keydown", activityWake);

    function setIdleProfile() {
      if (profileTimer) clearInterval(profileTimer);
      profileTimer = null;
      if (current !== "idle" || !animationsEnabled) return;
      const profile = profiles[profileIndex++ % profiles.length];
      root.dataset.avatarAnimation = profile.name;
      root.style.setProperty("--nova-idle-body", profile.body);
      root.style.setProperty("--nova-idle-eyes", profile.eye);
      profileTimer = setInterval(() => {
        if (current !== "idle" || !animationsEnabled) return setIdleProfile();
        const next = profiles[profileIndex++ % profiles.length];
        root.dataset.avatarAnimation = next.name;
        root.style.setProperty("--nova-idle-body", next.body);
        root.style.setProperty("--nova-idle-eyes", next.eye);
      }, 4200);
    }

    function setState(next, { transient = false } = {}) {
      current = labels[next] ? next : "idle";
      root.dataset.state = current;
      root.setAttribute("aria-label", `NOVA companion, ${labels[current]}`);
      if (status) status.textContent = labels[current];
      if (statusBar) statusBar.dataset.state = current;
      if (statusLabel) statusLabel.textContent = ({ idle: "Ready", listening: "Listening", thinking: "Thinking", speaking: "Speaking", happy: "Ready", confused: "Needs clarification", error: "Audio issue", sleep: "Sleeping" })[current];
      if (statusDetail) statusDetail.textContent = ({ idle: "Say “Hey NOVA” or tap the mic", listening: "Speak now — tap the mic to stop", thinking: "Working on your reply", speaking: "Reading NOVA’s reply aloud", happy: "Tap the mic when you’re ready", confused: "NOVA needs a little clarification", error: "Check microphone or speaker access", sleep: "Say “Hey NOVA” to wake NOVA" })[current];
      setIdleProfile();
      if (waveform) waveform.classList.toggle("waveform-active", current === "speaking");
      art?.setExpression(animationsEnabled ? current : "friendly");
      if (happyTimer) clearTimeout(happyTimer);
      if (transient) happyTimer = setTimeout(() => setState("idle"), 1500);
      resetSleepTimer();
    }

    function resetSleepTimer() {
      if (sleepTimer) clearTimeout(sleepTimer);
      if (current === "idle") sleepTimer = setTimeout(() => setState("sleep"), 120000);
    }

    root.querySelector(".avatar-art-frame")?.addEventListener("click", () => {
      if (current === "sleep") setState("idle");
    });

    setState("idle");
    return {
      setState,
      setMouth: (level) => { if (animationsEnabled) art?.setMouth(level); },
      getState: () => current,
      setAnimationsEnabled(enabled) {
        animationsEnabled = Boolean(enabled);
        root.classList.toggle("animations-off", !enabled);
        setIdleProfile();
        if (!enabled) { art?.setMouth(0); art?.setExpression("friendly"); }
      },
      wake() { if (current === "sleep") setState("idle"); },
    };
  }

  window.NovaAvatarController = { create };
})();
