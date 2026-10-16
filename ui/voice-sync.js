(function () {
  let active = null;
  let mouthTimer = null;
  let lastBoundary = 0;
  let boundaryEnergy = .35;
  let startedAt = 0;
  let textBeingSpoken = "";

  function setMouth(level) {
    window.NovaAvatar?.setMouth(level);
  }

  function stopAnimation() {
    if (mouthTimer) clearInterval(mouthTimer);
    mouthTimer = null;
    setMouth(0);
  }

  function animate(token, now) {
    if (active !== token) return;
    const elapsed = now - (lastBoundary || startedAt);
    let level = 0;
    if (token.boundariesSeen && elapsed < 520) {
      const progress = Math.min(1, elapsed / 420);
      level = boundaryEnergy * Math.sin(Math.PI * progress) * (.72 + .28 * Math.sin(now / 47));
    } else if (!token.boundariesSeen) {
      // SpeechSynthesis does not expose its output audio buffer. This follows the
      // utterance clock with syllable-like pulses until its onend event.
      const characterIndex = Math.min(textBeingSpoken.length - 1, Math.floor((now - startedAt) / 58));
      const char = textBeingSpoken[Math.max(0, characterIndex)]?.toLowerCase() || " ";
      const vowel = "aeiouy".includes(char);
      const pause = /[,.;:!?\s]/.test(char);
      level = pause ? .04 : vowel ? .72 : .28 + .18 * (1 + Math.sin(now / 63));
    }
    setMouth(level);
  }

  function cancel() {
    if (active) active.cancelled = true;
    active = null;
    window.speechSynthesis?.cancel();
    stopAnimation();
  }

  function speak(text, options = {}) {
    if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      window.NovaAvatar?.setState("error");
      return false;
    }
    cancel();
    const token = { boundariesSeen: false, cancelled: false };
    active = token;
    textBeingSpoken = String(text || "").trim();
    if (!textBeingSpoken) return false;
    const utterance = new SpeechSynthesisUtterance(textBeingSpoken);
    utterance.lang = navigator.language || "en-US";
    const availableVoices = window.speechSynthesis.getVoices();
    const language = utterance.lang.toLowerCase();
    utterance.voice = availableVoices.find((voice) => voice.lang.toLowerCase() === language)
      || availableVoices.find((voice) => voice.lang.toLowerCase().startsWith(language.split("-")[0]))
      || null;
    utterance.onstart = () => {
      if (active !== token) return;
      startedAt = performance.now();
      lastBoundary = 0;
      window.NovaAvatar?.setState("speaking");
      options.onStart?.();
      mouthTimer = setInterval(() => animate(token, performance.now()), 40);
    };
    utterance.onboundary = (event) => {
      if (active !== token) return;
      token.boundariesSeen = true;
      lastBoundary = performance.now();
      const span = Math.max(1, event.charLength || 4);
      const word = textBeingSpoken.slice(event.charIndex || 0, (event.charIndex || 0) + span).toLowerCase();
      const syllables = Math.max(1, (word.match(/[aeiouy]+/g) || []).length);
      boundaryEnergy = Math.min(.95, .34 + syllables * .13);
    };
    const finish = (failed) => {
      if (active !== token) return;
      active = null;
      stopAnimation();
      window.NovaAvatar?.setState(failed ? "error" : "happy", { transient: !failed });
      options.onEnd?.(failed);
    };
    utterance.onend = () => finish(false);
    utterance.onerror = (event) => finish(event.error !== "canceled" && event.error !== "interrupted");
    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
      return true;
    } catch {
      finish(true);
      return false;
    }
  }

  window.NovaVoiceSync = { speak, cancel, isSpeaking: () => Boolean(active) };
})();
