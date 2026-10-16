(function () {
  const markup = `
    <svg class="nova-bot" viewBox="0 0 160 150" role="presentation" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="shell" x1=".15" y1="0" x2=".85" y2="1"><stop stop-color="#fff"/><stop offset=".55" stop-color="#f3f7ff"/><stop offset="1" stop-color="#d9e4f3"/></linearGradient>
        <linearGradient id="screen" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#233654"/><stop offset="1" stop-color="#101a30"/></linearGradient>
        <linearGradient id="eye" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a9f6ff"/><stop offset=".4" stop-color="#54d9f5"/><stop offset="1" stop-color="#4d9ef2"/></linearGradient>
        <linearGradient id="lavender" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e7d8ff"/><stop offset="1" stop-color="#a994ff"/></linearGradient>
        <filter id="soft-shadow" x="-40%" y="-40%" width="180%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
      </defs>
      <ellipse cx="80" cy="139" rx="43" ry="6" fill="#8caee8" opacity=".16" filter="url(#soft-shadow)"/>
      <g class="bot-antenna"><path d="M80 22V11" stroke="#b9c8e0" stroke-width="4" stroke-linecap="round"/><circle class="antenna-tip" cx="80" cy="8" r="5" fill="#79eaff"/><circle cx="78.5" cy="6.5" r="1.5" fill="white" opacity=".9"/></g>
      <path class="bot-arm arm-left" d="M37 91c-9 1-13 7-13 14" fill="none" stroke="#d9e4f3" stroke-width="7" stroke-linecap="round"/>
      <path class="bot-arm arm-right" d="M123 91c9 1 13 7 13 14" fill="none" stroke="#d9e4f3" stroke-width="7" stroke-linecap="round"/>
      <ellipse class="bot-hand hand-left" cx="23" cy="108" rx="8" ry="7" fill="url(#shell)" stroke="#d0ddf0"/>
      <ellipse class="bot-hand hand-right" cx="137" cy="108" rx="8" ry="7" fill="url(#shell)" stroke="#d0ddf0"/>
      <rect x="47" y="105" width="66" height="35" rx="16" fill="url(#shell)" stroke="#d1dff0" stroke-width="1.5"/>
      <rect x="67" y="112" width="26" height="5" rx="2.5" fill="url(#lavender)" opacity=".8"/>
      <circle cx="80" cy="128" r="3" fill="#83e8f4" opacity=".8"/>
      <rect class="bot-head-shell" x="24" y="20" width="112" height="91" rx="33" fill="url(#shell)" stroke="#d8e3f1" stroke-width="1.5"/>
      <path d="M44 29c10-6 62-7 73 0" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" opacity=".9"/>
      <circle cx="35" cy="43" r="3" fill="#b8a6ff" opacity=".65"/><circle cx="125" cy="43" r="3" fill="#8ceafa" opacity=".75"/>
      <rect x="33" y="37" width="94" height="61" rx="24" fill="url(#screen)" stroke="#b7d1e9" stroke-width="1.4"/>
      <path class="brow brow-left" d="M49 48q8-5 16 0" fill="none" stroke="#83dff2" stroke-width="2" stroke-linecap="round" opacity=".8"/>
      <path class="brow brow-right" d="M95 48q8-5 16 0" fill="none" stroke="#83dff2" stroke-width="2" stroke-linecap="round" opacity=".8"/>
      <g class="bot-eyes"><ellipse class="eye eye-left" cx="58" cy="64" rx="8" ry="10" fill="url(#eye)"/><ellipse class="eye eye-right" cx="102" cy="64" rx="8" ry="10" fill="url(#eye)"/><ellipse cx="55.5" cy="60" rx="2.4" ry="3" fill="white" opacity=".93"/><ellipse cx="99.5" cy="60" rx="2.4" ry="3" fill="white" opacity=".93"/></g>
      <path class="sleep-lid lid-left" d="M50 65q8 5 16 0" fill="none" stroke="#79cee7" stroke-width="2.3" stroke-linecap="round"/>
      <path class="sleep-lid lid-right" d="M94 65q8 5 16 0" fill="none" stroke="#79cee7" stroke-width="2.3" stroke-linecap="round"/>
      <path class="mouth-smile" d="M72 80q8 8 16 0" fill="none" stroke="#9beafa" stroke-width="2.7" stroke-linecap="round"/>
      <ellipse class="mouth-open" cx="80" cy="81" rx="5" ry="1" fill="#ff9db5" opacity="0"/>
      <path class="mouth-concerned" d="M73 85q7-6 14 0" fill="none" stroke="#a8d8ed" stroke-width="2.2" stroke-linecap="round"/>
      <circle class="cheek cheek-left" cx="43" cy="78" r="4" fill="#ffb7c6" opacity=".35"/><circle class="cheek cheek-right" cx="117" cy="78" r="4" fill="#ffb7c6" opacity=".35"/>
    </svg>`;

  function create(root) {
    if (!root) return null;
    const target = root.querySelector(".avatar-art");
    if (!target) return null;
    target.innerHTML = markup;
    const mouth = target.querySelector(".mouth-open");
    const smile = target.querySelector(".mouth-smile");
    const eyes = [...target.querySelectorAll(".eye")];
    return {
      setMouth(level) {
        const amount = Math.max(0, Math.min(1, Number(level) || 0));
        mouth.setAttribute("ry", String(1 + amount * 5));
        mouth.style.opacity = String(Math.min(.95, amount * 1.3));
        smile.style.opacity = String(1 - amount);
      },
      setExpression(expression) {
        root.dataset.expression = expression || "friendly";
        if (expression === "confused") {
          eyes[0].setAttribute("cy", "65"); eyes[1].setAttribute("cy", "63");
        } else {
          eyes[0].setAttribute("cy", "64"); eyes[1].setAttribute("cy", "64");
        }
      },
    };
  }
  window.NovaAvatarRenderer = { create };
})();
