const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  chats: [],
  chat: null,
  settings: {
    temperature: 0.7,
    top_p: 0.9,
    max_new_tokens: 32,
    speed_profile: "fast",
    use_memory: true,
    ai_provider: "auto",
  },
  busy: false,
  generationId: null,
  toastTimer: null,
  searchTimer: null,
  recognition: null,
  wakeRecognition: null,
};

window.NovaAvatar = window.NovaAvatarController?.create($("#avatarDock"));
window.NovaAvatar?.setAnimationsEnabled(localStorage.getItem("nova-avatar-enabled") !== "false");

function setConversationMode(mode) {
  let selected = mode === "voice" ? "voice" : "text";
  if (selected === "voice" && !navigator.onLine) {
    selected = "text";
    toast("Voice mode needs an internet connection. NOVA is using offline text mode.");
  }
  $("#mainPanel").dataset.mode = selected;
  $$("[data-mode-choice]").forEach((button) => {
    const active = button.dataset.modeChoice === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  localStorage.setItem("nova-mode", selected);
  document.querySelector(".app-shell")?.classList.toggle("voice-full", selected === "voice");
  document.querySelector(".app-shell")?.classList.toggle("voice-mini", false);
  if (selected === "voice") {
    $("#messageInput").blur();
    if (!state.busy && !state.recognition) window.NovaAvatar?.setState("idle");
    if (localStorage.getItem("nova-wake-phrase") !== "false") startWakeListener();
  } else {
    stopWakeListener();
    window.NovaVoiceSync?.cancel();
    if (state.recognition) state.recognition.stop();
    window.NovaAvatar?.setState("sleep");
  }
}

function syncConnectivity() {
  const online = navigator.onLine;
  const badge = $("#networkStatus");
  if (badge) {
    badge.textContent = online ? "ONLINE" : "OFFLINE · TEXT ONLY";
    badge.dataset.online = String(online);
  }
  const voiceTab = $('[data-mode-choice="voice"]');
  if (voiceTab) {
    voiceTab.disabled = !online;
    voiceTab.title = online ? "Use voice mode" : "Voice mode needs an internet connection";
  }
  if (!online && $("#mainPanel")?.dataset.mode === "voice") setConversationMode("text");
  if (!online) {
    window.NovaVoiceSync?.cancel();
    if (state.recognition) state.recognition.stop();
    stopWakeListener();
  }
}
window.addEventListener("online", syncConnectivity);
window.addEventListener("offline", syncConnectivity);

function setVoiceLayout(layout) {
  if ($("#mainPanel").dataset.mode !== "voice") setConversationMode("voice");
  const mini = layout === "mini";
  const shell = document.querySelector(".app-shell");
  shell.classList.toggle("voice-mini", mini);
  shell.classList.toggle("voice-full", !mini);
  localStorage.setItem("nova-voice-layout", mini ? "mini" : "full");
  if (mini) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("nova-voice-position") || "null"); } catch { /* Ignore invalid saved position. */ }
    const dock = $("#avatarDock");
    const x = Number.isFinite(saved?.x) ? saved.x : innerWidth - dock.offsetWidth - 22;
    const y = Number.isFinite(saved?.y) ? saved.y : innerHeight - dock.offsetHeight - 22;
    dock.style.left = `${Math.max(8, Math.min(innerWidth - dock.offsetWidth - 8, x))}px`;
    dock.style.top = `${Math.max(8, Math.min(innerHeight - dock.offsetHeight - 8, y))}px`;
  } else {
    $("#avatarDock").style.left = "";
    $("#avatarDock").style.top = "";
  }
}

$$("[data-mode-choice]").forEach((button) => {
  button.addEventListener("click", () => setConversationMode(button.dataset.modeChoice));
});
setConversationMode(localStorage.getItem("nova-mode") || "text");
if ($("#mainPanel").dataset.mode === "voice") setVoiceLayout(localStorage.getItem("nova-voice-layout") || "full");

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[char]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data;
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.add("hidden"), 2600);
}

function setError(message) {
  const banner = $("#errorBanner");
  banner.textContent = message;
  banner.classList.toggle("hidden", !message);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function renderInline(source) {
  let text = escapeHtml(source);
  const saved = [];
  const hold = (html) => {
    const key = `__NOVA_HOLD_${saved.length}__`;
    saved.push(html);
    return key;
  };

  text = text.replace(/`([^`]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, label, url) => {
    const safeUrl = url.replace(/&amp;/g, "&");
    return hold(`<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  });
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return text.replace(/__NOVA_HOLD_(\d+)__/g, (_, index) => saved[Number(index)]);
}

function highlightCode(code, language) {
  const escaped = escapeHtml(code);
  const keywords = /\b(const|let|var|function|return|if|else|for|while|class|new|import|from|export|default|async|await|try|catch|throw|def|print|in|not|and|or|True|False|None|public|static|void|int|string|bool|using|namespace|SELECT|FROM|WHERE|INSERT|UPDATE|DELETE)\b/g;
  const tokenPattern = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/|&quot;.*?&quot;|&#39;.*?&#39;|\b\d+(?:\.\d+)?\b)/g;
  let output = "";
  let offset = 0;
  for (const match of escaped.matchAll(tokenPattern)) {
    output += escaped.slice(offset, match.index).replace(keywords, '<span class="tok-keyword">$1</span>');
    const token = match[0];
    let className = "tok-comment";
    if (token.startsWith("&quot;") || token.startsWith("&#39;")) className = "tok-string";
    else if (/^\d/.test(token)) className = "tok-number";
    output += `<span class="${className}">${token}</span>`;
    offset = match.index + token.length;
  }
  output += escaped.slice(offset).replace(keywords, '<span class="tok-keyword">$1</span>');
  return output;
}

function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let listType = "";
  let code = null;

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      const tag = listType === "ol" ? "ol" : "ul";
      blocks.push(`<${tag}>${list.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
      list = [];
      listType = "";
    }
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```([\w+#.-]*)\s*$/);
    if (fence) {
      flushParagraph();
      flushList();
      if (code === null) code = { language: fence[1] || "text", lines: [] };
      else {
        const lang = escapeHtml(code.language);
        blocks.push(`<pre><span class="code-lang">${lang}</span><code class="language-${lang}">${highlightCode(code.lines.join("\n"), code.language)}</code></pre>`);
        code = null;
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    const listItem = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const nextType = /^\s*\d+[.)]/.test(line) ? "ol" : "ul";
      if (list.length && nextType !== listType) flushList();
      listType = nextType;
      list.push(listItem[1]);
      continue;
    }
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (code) {
    blocks.push(`<pre><span class="code-lang">${escapeHtml(code.language)}</span><code>${highlightCode(code.lines.join("\n"), code.language)}</code></pre>`);
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

function addMessage(role, content, { pending = false, time = new Date().toISOString() } = {}) {
  const list = $("#messageList");
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.dataset.role = role;
  const avatar = role === "assistant" ? "✳" : "Y";
  const name = role === "assistant" ? "NOVA" : "You";
  const bodyContent = pending && !content
    ? '<span class="typing-dots" aria-label="NOVA is working"><i></i><i></i><i></i></span>'
    : renderMarkdown(content);
  message.innerHTML = `<div class="message-avatar">${avatar}</div><div class="message-body"><div class="message-meta">${name}<time>${formatTime(time)}</time></div><div class="message-content">${bodyContent}</div>${role === "assistant" ? '<div class="message-actions"><button type="button" data-copy>Copy</button><button type="button" data-speak>Speak</button></div>' : ""}</div>`;
  list.append(message);
  $("#chatStage").scrollTop = $("#chatStage").scrollHeight;
  return message;
}

function updateAssistantMessage(element, content, pending = false) {
  const contentElement = $(".message-content", element);
  contentElement.innerHTML = pending && !content
    ? '<span class="typing-dots" aria-label="NOVA is working"><i></i><i></i><i></i></span>'
    : renderMarkdown(content);
  $("#chatStage").scrollTop = $("#chatStage").scrollHeight;
}

async function loadChats(query = "") {
  try {
    const data = await api(`/api/chats${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    state.chats = data.chats;
    renderChats();
  } catch (error) {
    toast(error.message);
  }
}

async function refreshCurrentChatTitle() {
  if (!state.chat) return;
  const updatedChat = await api(`/api/chats/${encodeURIComponent(state.chat.id)}`);
  state.chat.title = updatedChat.title;
  $("#activeTitle").textContent = updatedChat.title;
}

function renderChats() {
  const list = $("#conversationList");
  list.replaceChildren();
  $("#sidebarEmpty").classList.toggle("hidden", state.chats.length > 0);
  for (const chat of state.chats) {
    const item = document.createElement("div");
    item.className = `conversation-item${state.chat?.id === chat.id ? " active" : ""}`;
    item.dataset.chatId = chat.id;
    item.innerHTML = `<span class="conversation-icon">${chat.pinned ? "◆" : "◌"}</span><span class="conversation-title" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title)}</span><span class="conversation-actions"><button type="button" data-chat-action="pin" title="${chat.pinned ? "Unpin" : "Pin"}">${chat.pinned ? "◆" : "⌖"}</button><button type="button" data-chat-action="rename" title="Rename">✎</button><button type="button" data-chat-action="archive" title="Archive">↧</button><button type="button" data-chat-action="delete" title="Delete">×</button></span>`;
    list.append(item);
  }
}

async function selectChat(chatId) {
  try {
    const chat = await api(`/api/chats/${encodeURIComponent(chatId)}`);
    state.chat = chat;
    updateExportButton();
    $("#activeTitle").textContent = chat.title;
    $("#welcomeScreen").classList.toggle("hidden", chat.messages.length > 0);
    $("#messageList").classList.toggle("hidden", chat.messages.length === 0);
    $("#messageList").replaceChildren();
    for (const item of chat.messages) addMessage(item.role, item.content, { time: item.created_at });
    renderChats();
    $("#sidebar").classList.remove("sidebar-open");
    setError("");
  } catch (error) {
    toast(error.message);
  }
}

async function createChat() {
  try {
    const chat = await api("/api/chats", { method: "POST", body: JSON.stringify({}) });
    state.chat = chat;
    updateExportButton();
    $("#activeTitle").textContent = chat.title;
    $("#welcomeScreen").classList.remove("hidden");
    $("#messageList").classList.add("hidden");
    $("#messageList").replaceChildren();
    await loadChats($("#chatSearch").value.trim());
    $("#messageInput").focus();
    $("#sidebar").classList.remove("sidebar-open");
  } catch (error) {
    toast(error.message);
  }
}

async function actOnChat(chatId, action) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) return;
  try {
    if (action === "pin") {
      await api(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PUT",
        body: JSON.stringify({ pinned: !chat.pinned }),
      });
    } else if (action === "rename") {
      const title = window.prompt("Conversation name", chat.title);
      if (!title?.trim()) return;
      await api(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PUT",
        body: JSON.stringify({ title: title.trim() }),
      });
      if (state.chat?.id === chatId) $("#activeTitle").textContent = title.trim();
    } else if (action === "archive") {
      if (!window.confirm(`Archive “${chat.title}”?`)) return;
      await api(`/api/chats/${encodeURIComponent(chatId)}`, {
        method: "PUT",
        body: JSON.stringify({ archived: true }),
      });
      if (state.chat?.id === chatId) await createChat();
    } else if (action === "delete") {
      if (!window.confirm(`Delete “${chat.title}” permanently?`)) return;
      await api(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
      if (state.chat?.id === chatId) {
        state.chat = null;
        updateExportButton();
        $("#activeTitle").textContent = "New conversation";
        $("#messageList").replaceChildren();
        $("#messageList").classList.add("hidden");
        $("#welcomeScreen").classList.remove("hidden");
      }
    }
    await loadChats($("#chatSearch").value.trim());
  } catch (error) {
    toast(error.message);
  }
}

function setBusy(busy) {
  state.busy = busy;
  const button = $("#sendButton");
  button.classList.toggle("stop-mode", busy);
  button.setAttribute("aria-label", busy ? "Stop generation" : "Send message");
  button.disabled = !busy && $("#messageInput").value.trim().length === 0;
}

function updateExportButton() {
  $("#exportChat").disabled = !state.chat;
}

async function exportChat() {
  if (!state.chat) return;
  try {
    const chat = await api(`/api/chats/${encodeURIComponent(state.chat.id)}`);
    const transcript = chat.messages.map((message) => {
      const speaker = message.role === "assistant" ? "NOVA" : "You";
      return `## ${speaker}\n\n${message.content}`;
    }).join("\n\n---\n\n");
    const file = new Blob([`# ${chat.title}\n\n${transcript}\n`], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${chat.title.replace(/[<>:"/\\|?*]/g, "-").trim() || "nova-chat"}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Conversation exported as Markdown.");
  } catch (error) {
    toast(error.message);
  }
}

async function stopGeneration() {
  if (!state.generationId) return;
  try {
    await api("/api/stop", {
      method: "POST",
      body: JSON.stringify({ generation_id: state.generationId }),
    });
  } catch (error) {
    toast(error.message);
  }
}

async function sendMessage(explicitText) {
  if (state.busy) {
    await stopGeneration();
    return;
  }
  const input = $("#messageInput");
  const text = (explicitText ?? input.value).trim();
  if (!text) return;
  window.NovaVoiceSync?.cancel();
  setError("");
  if (!state.chat) {
    await createChat();
    if (!state.chat) return;
  }
  if (!$("#welcomeScreen").classList.contains("hidden")) {
    $("#welcomeScreen").classList.add("hidden");
    $("#messageList").classList.remove("hidden");
  }
  addMessage("user", text);
  input.value = "";
  resizeInput();
  setBusy(true);
  window.NovaAvatar?.setState("thinking");
  const assistantMessage = addMessage("assistant", "", { pending: true });
  const answerElement = $(".message-content", assistantMessage);
  let answer = "";
  let answerRenderTimer = null;
  const generationId = crypto.randomUUID();
  state.generationId = generationId;
  const requestSettings = { ...state.settings, ...(!navigator.onLine ? { ai_provider: "local" } : {}) };
  let generationStats = null;
  let avatarMood = "happy";

  try {
    const response = await fetch(`/api/chats/${encodeURIComponent(state.chat.id)}/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        generation_id: generationId,
        settings: requestSettings,
      }),
    });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || `Request failed (${response.status}).`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const events = pending.split("\n\n");
      pending = events.pop() || "";
      for (const entry of events) {
        const eventType = entry.match(/^event:\s*(.+)$/m)?.[1];
        const dataLine = entry.match(/^data:\s*(.+)$/m)?.[1];
        if (!dataLine) continue;
        const event = JSON.parse(dataLine);
        if (eventType === "token") {
          answer += event.text;
          if (answerRenderTimer === null) {
            answerRenderTimer = setTimeout(() => {
              answerRenderTimer = null;
              answerElement.innerHTML = renderMarkdown(answer);
              const stage = $("#chatStage");
              if (stage.scrollHeight - stage.scrollTop - stage.clientHeight < 90) stage.scrollTop = stage.scrollHeight;
            }, 60);
          }
        } else if (eventType === "error") {
          throw new Error(event.error || "NOVA could not generate a response.");
        } else if (eventType === "done") {
          generationStats = event;
        }
      }
    }
    if (pending.trim()) {
      const dataLine = pending.match(/^data:\s*(.+)$/m)?.[1];
      if (dataLine) {
        const event = JSON.parse(dataLine);
        if (event.error) throw new Error(event.error);
      }
    }
    if (answerRenderTimer !== null) clearTimeout(answerRenderTimer);
    answerRenderTimer = null;
    if (answer) answerElement.innerHTML = renderMarkdown(answer);
    if (answer && generationStats) {
      if (/\b(not sure|could you clarify|unclear|confused)\b/i.test(answer)) avatarMood = "confused";
      const profile = requestSettings.speed_profile;
      const profileLabel = profile === "balanced"
        ? "Medium"
        : profile[0].toUpperCase() + profile.slice(1);
      const details = [
        generationStats.model || "Local model",
        `${generationStats.output_tokens} tokens`,
        `${Number(generationStats.tokens_per_second).toFixed(2)} tok/s`,
        `${Number(generationStats.elapsed_seconds).toFixed(2)}s`,
        profileLabel,
      ];
      if (Number.isFinite(generationStats.time_to_first_text)) {
        details.splice(2, 0, `first text ${generationStats.time_to_first_text.toFixed(2)}s`);
      }
      const metric = document.createElement("span");
      metric.className = "response-metric";
      metric.textContent = details.join(" · ");
      $(".message-meta", assistantMessage).append(metric);
    }
    if (!answer) assistantMessage.remove();
    await loadChats($("#chatSearch").value.trim());
    await refreshCurrentChatTitle();
  } catch (error) {
    avatarMood = "error";
    if (answerRenderTimer !== null) clearTimeout(answerRenderTimer);
    answerRenderTimer = null;
    if (answer) updateAssistantMessage(assistantMessage, answer);
    else assistantMessage.remove();
    setError(error.message);
    await loadChats($("#chatSearch").value.trim());
    try {
      await refreshCurrentChatTitle();
    } catch (refreshError) {
      toast(refreshError.message);
    }
  } finally {
    state.generationId = null;
    setBusy(false);
    window.NovaAvatar?.setState(avatarMood, { transient: avatarMood === "happy" || avatarMood === "confused" });
    if (avatarMood !== "error" && navigator.onLine && $("#mainPanel").dataset.mode === "voice" && answer) speakText(answerElement.textContent, true);
    else if ($("#mainPanel").dataset.mode === "voice") setTimeout(startWakeListener, 500);
    input.focus();
  }
}

function resizeInput() {
  const input = $("#messageInput");
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  $("#sendButton").disabled = state.busy ? false : !input.value.trim();
}

function updateRangeValue(inputId, outputId, digits = 2) {
  const value = Number($(inputId).value);
  $(outputId).textContent = value.toFixed(digits).replace(/\.?0+$/, "");
}

function openModal(id) {
  $(`#${id}`).classList.remove("hidden");
}
function closeModal(id) {
  $(`#${id}`).classList.add("hidden");
}

async function openSettings() {
  try {
    const [settings, status] = await Promise.all([api("/api/settings"), api("/api/status")]);
    state.settings = settings;
    $("#temperatureSetting").value = settings.temperature;
    $("#topPSetting").value = settings.top_p;
    $("#tokenSetting").value = settings.max_new_tokens;
    $("#memorySetting").checked = settings.use_memory;
    $("#avatarAnimationSetting").checked = localStorage.getItem("nova-avatar-enabled") !== "false";
    $("#wakePhraseSetting").checked = localStorage.getItem("nova-wake-phrase") !== "false";
    $("#settingsProfile").value = settings.speed_profile;
    $("#aiProviderSetting").value = settings.ai_provider || "auto";
    $("#geminiApiKey").value = "";
    $("#geminiKeyStatus").textContent = status.gemini?.configured
      ? `A key is saved on this device. Model: ${status.gemini.model}.`
      : "No key saved. Auto mode will use local Qwen.";
    $("#speedProfile").value = settings.speed_profile;
    updateRangeValue("#temperatureSetting", "#temperatureValue", 1);
    updateRangeValue("#topPSetting", "#topPValue", 2);
    $("#tokenValue").textContent = settings.max_new_tokens;
    const geminiActive = status.gemini?.configured && navigator.onLine && (settings.ai_provider || "auto") === "auto";
    $("#settingsModelStatus").textContent = geminiActive
      ? `Gemini ${status.gemini.model} online · Qwen local fallback ${status.status}`
      : status.status === "ready"
        ? `${status.model.device} · Qwen3 general / Qwen2.5 Coder on demand`
        : status.status === "error" ? status.error : "Loading local model…";
    $("#settingsMessage").textContent = "";
    openModal("settingsModal");
  } catch (error) {
    toast(error.message);
  }
}

async function openMemories() {
  openModal("memoryModal");
  await loadMemories();
}

async function loadMemories() {
  try {
    const data = await api("/api/memories");
    const list = $("#memoryList");
    list.replaceChildren();
    if (!data.memories.length) {
      list.innerHTML = '<div class="memory-empty">No saved memories yet. Add something you would like NOVA to remember.</div>';
      return;
    }
    for (const [id, text, category, created] of data.memories) {
      const item = document.createElement("div");
      item.className = "memory-item";
      item.innerHTML = `<div class="memory-item-copy"><p>${escapeHtml(text)}</p><small>${escapeHtml(category)} · ${escapeHtml(created)}</small></div><button class="memory-delete" data-memory-id="${id}" type="button">Forget</button>`;
      list.append(item);
    }
  } catch (error) {
    $("#memoryList").innerHTML = `<div class="memory-empty">${escapeHtml(error.message)}</div>`;
  }
}

async function loadStatus() {
  try {
    const data = await api("/api/status");
    const cloudReady = Boolean(data.gemini?.configured && navigator.onLine && (data.settings?.ai_provider || "auto") === "auto");
    const modelReady = data.status === "ready" || cloudReady;
    const dot = $("#modelDot");
    dot.classList.toggle("ready", modelReady);
    dot.classList.toggle("error", data.status === "error" && !cloudReady);
    $("#modelName").textContent = cloudReady ? "Gemini online" : data.status === "ready" ? data.model.name : "Local model";
    $("#modelSubtext").textContent = cloudReady
      ? "Gemini · local fallback available"
      : data.status === "ready" ? `Qwen3 · ${data.model.device}`
        : data.status === "error" ? "Model failed to load" : "Loading model…";
    $(".local-pill .status-dot").classList.toggle("ready", modelReady);
    $("#privacyPill").textContent = cloudReady ? "GEMINI ONLINE" : "LOCAL ONLY";
    if (data.status === "error" && !cloudReady) setError(data.error || "NOVA's model failed to load.");
    updateSystemTelemetry(data.system);
  } catch (error) {
    $("#modelSubtext").textContent = "App server unavailable";
  }
}

function updateSystemTelemetry(system) {
  if (!system) return;
  $("#cpuMetric").textContent = `${system.cpu_percent.toFixed(0)}%`;
  $("#ramMetric").textContent = `${system.ram_used_gb.toFixed(1)}/${system.ram_total_gb.toFixed(1)} GB`;
  $("#gpuMetric").textContent = system.gpu.available
    ? `${system.gpu.memory_used_gb ?? "—"}/${system.gpu.memory_total_gb ?? "—"} GB`
    : "Not detected";
  $("#processRamMetric").textContent = `${system.process_ram_gb.toFixed(1)} GB`;
  const warning = $("#systemWarning");
  warning.textContent = system.warnings.join(" ");
  warning.classList.toggle("hidden", system.warnings.length === 0);
  warning.classList.toggle("warning-critical", system.ram_percent >= 95
    || system.cpu_percent >= 98
    || (system.gpu.memory_percent !== null && system.gpu.memory_percent >= 95));
}

$("#newChatButton").addEventListener("click", createChat);
$("#exportChat").addEventListener("click", exportChat);
$("#openSettings").addEventListener("click", openSettings);
$("#topSettings").addEventListener("click", openSettings);
$("#openMemory").addEventListener("click", openMemories);
$("#openSidebar").addEventListener("click", () => $("#sidebar").classList.add("sidebar-open"));
$("#closeSidebar").addEventListener("click", () => $("#sidebar").classList.remove("sidebar-open"));
$("#themeButton").addEventListener("click", () => {
  document.body.classList.toggle("light-theme");
  localStorage.setItem("nova-theme", document.body.classList.contains("light-theme") ? "light" : "dark");
});
if (localStorage.getItem("nova-theme") === "light") document.body.classList.add("light-theme");

$("#chatSearch").addEventListener("input", (event) => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(() => loadChats(event.target.value.trim()), 180);
});
$("#conversationList").addEventListener("click", (event) => {
  const actionButton = event.target.closest("[data-chat-action]");
  const item = event.target.closest("[data-chat-id]");
  if (!item) return;
  if (actionButton) {
    event.stopPropagation();
    actOnChat(item.dataset.chatId, actionButton.dataset.chatAction);
  } else {
    selectChat(item.dataset.chatId);
  }
});
$("#composerForm").addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage();
});
$("#messageInput").addEventListener("input", resizeInput);
$("#messageInput").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (!state.busy) sendMessage();
  }
});
$$(".suggestion-card").forEach((card) => card.addEventListener("click", () => {
  $("#messageInput").value = card.dataset.prompt;
  resizeInput();
  $("#messageInput").focus();
}));
$("#sendButton").addEventListener("click", (event) => {
  if (state.busy) {
    event.preventDefault();
    stopGeneration();
  }
});
$("#messageList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]");
  const speakButton = event.target.closest("[data-speak]");
  if (speakButton) {
    speakText($(".message-content", speakButton.closest(".message")).innerText);
    return;
  }
  if (!button) return;
  const content = $(".message-content", button.closest(".message")).innerText;
  try {
    await navigator.clipboard.writeText(content);
    toast("Response copied.");
  } catch {
    toast("Clipboard access is not available in this browser.");
  }
});

function speakText(text, resumeWake = false) {
  if (!String(text || "").trim()) { toast("There is no reply to play yet."); return; }
  if ($("#mainPanel").dataset.mode === "voice") stopWakeListener();
  if (window.NovaVoiceSync) {
    if (!window.NovaVoiceSync.speak(text, {
      onStart: () => { $("#avatarSpeak").classList.add("voice-active"); $("#avatarSpeak").title = "Stop speaking"; },
      onEnd: (failed) => {
      $("#avatarSpeak").classList.remove("voice-active");
      $("#avatarSpeak").title = "Play the latest reply";
      if (failed) toast("Speech playback failed. Check your browser’s speaker output and try again.");
      if (resumeWake && $("#mainPanel").dataset.mode === "voice") setTimeout(startWakeListener, 500);
    } })) {
      toast("Speech playback is not supported in this browser.");
      $("#avatarSpeak").classList.remove("voice-active");
      if (resumeWake) setTimeout(startWakeListener, 500);
    }
  } else if ("speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined") {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = navigator.language || "en-US";
    utterance.onerror = () => toast("Speech playback failed. Check your browser’s speaker output and try again.");
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  } else {
    toast("Speech playback is not supported in this browser.");
    if (resumeWake) setTimeout(startWakeListener, 500);
  }
}

function startVoiceInput(pushToTalk = false) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { toast("Voice input is not supported in this browser."); return false; }
  if (state.recognition) return false;
  stopWakeListener();
  window.NovaVoiceSync?.cancel();
  const recognition = new SpeechRecognition();
  state.recognition = recognition;
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const transcript = [...event.results].map((result) => result[0]?.transcript?.trim() || "").filter(Boolean).join(" ").trim();
    if (!transcript || recognition.submitted) return;
    recognition.submitted = true;
    $("#messageInput").value = transcript;
    resizeInput();
    if (pushToTalk && transcript) {
      window.NovaAvatar?.setState("thinking");
      sendMessage(transcript);
    }
  };
  recognition.onerror = (event) => {
    if (event.error !== "no-speech" && event.error !== "aborted") {
      const message = event.error === "not-allowed"
        ? "Microphone permission is blocked. Allow it for NOVA in your browser settings."
        : event.error === "audio-capture" ? "No microphone was found. Check the selected input device."
          : "Voice input failed. Check microphone access and try again.";
      toast(message);
      window.NovaAvatar?.setState("error");
    } else if (event.error === "no-speech") toast("I didn’t hear speech. Tap the microphone and try again.");
  };
  recognition.onend = () => {
    state.recognition = null;
    $("#avatarMic").classList.remove("voice-active");
    $("#avatarMic").setAttribute("aria-pressed", "false");
    $("#avatarMic").title = "Tap to speak";
    if (window.NovaAvatar?.getState() === "listening") window.NovaAvatar.setState("idle");
    if (pushToTalk && $("#mainPanel").dataset.mode === "voice") setTimeout(startWakeListener, 500);
  };
  try {
    recognition.start();
    $("#avatarMic").classList.add("voice-active");
    $("#avatarMic").setAttribute("aria-pressed", "true");
    $("#avatarMic").title = "Listening — tap to stop";
    window.NovaAvatar?.setState("listening");
    return true;
  } catch {
    state.recognition = null;
    toast("Voice input could not start.");
    return false;
  }
}

function stopVoiceInput() {
  if (!state.recognition) return;
  try { state.recognition.stop(); } catch { /* Recognition may have ended already. */ }
}

function stopWakeListener() {
  const recognition = state.wakeRecognition;
  state.wakeRecognition = null;
  if (recognition) { try { recognition.abort(); } catch { /* Recognition may already have ended. */ } }
}

function startWakeListener() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition || $("#mainPanel").dataset.mode !== "voice" || localStorage.getItem("nova-wake-phrase") === "false" || state.busy || state.recognition || state.wakeRecognition || window.speechSynthesis?.speaking) return;
  const recognition = new SpeechRecognition();
  state.wakeRecognition = recognition;
  recognition.lang = navigator.language || "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    for (let index = event.resultIndex; index < event.results.length; index++) {
      if (!event.results[index].isFinal) continue;
      const transcript = event.results[index][0].transcript.trim();
      const match = transcript.match(/\b(?:hey|ok|okay)\s+nova\b[,.!?;:]?\s*(.*)/i);
      if (!match) continue;
      const request = match[1].trim();
      stopWakeListener();
      if (request) sendMessage(request);
      else startVoiceInput(true);
      return;
    }
  };
  recognition.onerror = () => { if (state.wakeRecognition === recognition) stopWakeListener(); };
  recognition.onend = () => {
    if (state.wakeRecognition !== recognition) return;
    state.wakeRecognition = null;
    if ($("#mainPanel").dataset.mode === "voice" && localStorage.getItem("nova-wake-phrase") !== "false") setTimeout(startWakeListener, 600);
  };
  try { recognition.start(); } catch { state.wakeRecognition = null; }
}

function renderActivity(entries) {
  const list = $("#activityList");
  list.replaceChildren();
  if (!entries.length) { list.innerHTML = '<p class="activity-empty">No greeting activity yet.</p>'; return; }
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "activity-entry";
    const when = new Date(entry.created_at);
    row.innerHTML = `<strong>${escapeHtml(entry.message)}</strong><small>${escapeHtml(entry.platform)} · ${Number.isNaN(when.getTime()) ? "" : when.toLocaleString()}</small>`;
    list.append(row);
  }
}

async function openActivity() {
  try {
    const [automations, activity] = await Promise.all([api("/api/automations"), api("/api/activity")]);
    $("#desktopGreeting").checked = automations.desktop_greeting;
    $("#mobileGreeting").checked = automations.mobile_greeting;
    $("#speakGreeting").checked = localStorage.getItem("nova-speak") === "true";
    renderActivity(activity.entries);
    openModal("activityModal");
  } catch (error) { toast(error.message); }
}

async function runGreetingAutomation() {
  const platform = matchMedia("(max-width: 700px)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ? "mobile" : "desktop";
  const automations = await api("/api/automations");
  if (!automations[`${platform}_greeting`]) return;
  const dayKey = `nova-greeting-${platform}-${new Date().toLocaleDateString()}`;
  if (localStorage.getItem(dayKey)) return;
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const message = `Good ${part}, sir! I’m NOVA, created by Subhadeep Roy (pronounced Subho-dip). What would you like to work on?`;
  await api("/api/activity", { method: "POST", body: JSON.stringify({ message, platform }) });
  localStorage.setItem(dayKey, "true");
  toast(message);
  if (localStorage.getItem("nova-speak") === "true") speakText(message);
}

$("#openActivity").addEventListener("click", openActivity);
$("#saveAutomations").addEventListener("click", async () => {
  try {
    await api("/api/automations", { method: "PUT", body: JSON.stringify({
      desktop_greeting: $("#desktopGreeting").checked,
      mobile_greeting: $("#mobileGreeting").checked,
    }) });
    localStorage.setItem("nova-speak", String($("#speakGreeting").checked));
    $("#automationMessage").textContent = "Automations saved.";
  } catch (error) { $("#automationMessage").textContent = error.message; }
});

const avatarMic = $("#avatarMic");
avatarMic.addEventListener("click", () => {
  if (state.recognition) stopVoiceInput();
  else startVoiceInput(true);
});
$("#avatarSpeak").addEventListener("click", () => {
  if (window.NovaVoiceSync?.isSpeaking()) {
    window.NovaVoiceSync.cancel();
    $("#avatarSpeak").classList.remove("voice-active");
    $("#avatarSpeak").title = "Play the latest reply";
    window.NovaAvatar?.setState("idle");
    if ($("#mainPanel").dataset.mode === "voice") setTimeout(startWakeListener, 500);
    return;
  }
  const latestReply = $$(".message.assistant .message-content").at(-1)?.textContent || "";
  speakText(latestReply, $("#mainPanel").dataset.mode === "voice");
});
$("#avatarMinimize").addEventListener("click", () => setVoiceLayout("mini"));
$("#avatarFull").addEventListener("click", () => setVoiceLayout("full"));
$("#avatarExit").addEventListener("click", () => setConversationMode("text"));
const avatarDock = $("#avatarDock");
let dragState = null;
window.addEventListener("resize", () => {
  if (!document.querySelector(".app-shell").classList.contains("voice-mini")) return;
  const x = Math.max(8, Math.min(innerWidth - avatarDock.offsetWidth - 8, avatarDock.offsetLeft));
  const y = Math.max(8, Math.min(innerHeight - avatarDock.offsetHeight - 8, avatarDock.offsetTop));
  avatarDock.style.left = `${x}px`;
  avatarDock.style.top = `${y}px`;
});
$(".avatar-dock-copy", avatarDock).addEventListener("pointerdown", (event) => {
  if (!document.querySelector(".app-shell").classList.contains("voice-mini")) return;
  dragState = { pointerId: event.pointerId, dx: event.clientX - avatarDock.offsetLeft, dy: event.clientY - avatarDock.offsetTop };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.preventDefault();
});
$(".avatar-dock-copy", avatarDock).addEventListener("pointermove", (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const x = Math.max(8, Math.min(innerWidth - avatarDock.offsetWidth - 8, event.clientX - dragState.dx));
  const y = Math.max(8, Math.min(innerHeight - avatarDock.offsetHeight - 8, event.clientY - dragState.dy));
  avatarDock.style.left = `${x}px`;
  avatarDock.style.top = `${y}px`;
});
$(".avatar-dock-copy", avatarDock).addEventListener("pointerup", (event) => {
  if (!dragState) return;
  dragState = null;
  localStorage.setItem("nova-voice-position", JSON.stringify({ x: avatarDock.offsetLeft, y: avatarDock.offsetTop }));
});
$(".avatar-dock-copy", avatarDock).addEventListener("pointercancel", () => { dragState = null; });
$$("[data-close]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.close)));
$$(".modal-backdrop").forEach((backdrop) => backdrop.addEventListener("click", (event) => {
  if (event.target === backdrop) backdrop.classList.add("hidden");
}));
$("#temperatureSetting").addEventListener("input", () => updateRangeValue("#temperatureSetting", "#temperatureValue", 1));
$("#topPSetting").addEventListener("input", () => updateRangeValue("#topPSetting", "#topPValue", 2));
$("#tokenSetting").addEventListener("input", () => $("#tokenValue").textContent = $("#tokenSetting").value);
const profileTokenBudgets = { fast: 32, balanced: 96, deep: 192 };
function chooseProfile(profile) {
  $("#speedProfile").value = profile;
  $("#settingsProfile").value = profile;
  $("#tokenSetting").value = profileTokenBudgets[profile];
  $("#tokenValue").textContent = profileTokenBudgets[profile];
}
$("#speedProfile").addEventListener("change", async (event) => {
  chooseProfile(event.target.value);
  try {
    state.settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        ...state.settings,
        speed_profile: event.target.value,
        max_new_tokens: profileTokenBudgets[event.target.value],
      }),
    });
    $("#settingsMessage").textContent = "";
  } catch (error) {
    toast(error.message);
    $("#speedProfile").value = state.settings.speed_profile;
  }
});
$("#settingsProfile").addEventListener("change", (event) => chooseProfile(event.target.value));
$("#saveSettings").addEventListener("click", async () => {
  try {
    state.settings = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        temperature: Number($("#temperatureSetting").value),
        top_p: Number($("#topPSetting").value),
        max_new_tokens: Number($("#tokenSetting").value),
        speed_profile: $("#settingsProfile").value,
        use_memory: $("#memorySetting").checked,
        ai_provider: $("#aiProviderSetting").value,
      }),
    });
    $("#settingsMessage").textContent = "Preferences saved.";
    const avatarAnimations = $("#avatarAnimationSetting").checked;
    localStorage.setItem("nova-avatar-enabled", String(avatarAnimations));
    window.NovaAvatar?.setAnimationsEnabled(avatarAnimations);
    const wakePhraseEnabled = $("#wakePhraseSetting").checked;
    localStorage.setItem("nova-wake-phrase", String(wakePhraseEnabled));
    if (wakePhraseEnabled && $("#mainPanel").dataset.mode === "voice") startWakeListener();
    else stopWakeListener();
    $("#speedProfile").value = state.settings.speed_profile;
    $("#memoryHint").textContent = state.settings.use_memory ? "✳ Memory on" : "✳ Memory off";
  } catch (error) {
    $("#settingsMessage").textContent = error.message;
  }
});
$("#saveGeminiKey").addEventListener("click", async () => {
  const input = $("#geminiApiKey");
  try {
    await api("/api/gemini-key", { method: "PUT", body: JSON.stringify({ api_key: input.value }) });
    input.value = "";
    $("#geminiKeyStatus").textContent = "Key saved on this device. Auto mode will try Gemini while online.";
  } catch (error) {
    $("#geminiKeyStatus").textContent = error.message;
  }
});
$("#clearGeminiKey").addEventListener("click", async () => {
  try {
    const result = await api("/api/gemini-key", { method: "DELETE" });
    $("#geminiKeyStatus").textContent = result.configured
      ? "An environment key remains active; remove it from the server environment to disable Gemini."
      : "No Gemini key saved. Auto mode will use local Qwen.";
    $("#geminiApiKey").value = "";
  } catch (error) {
    $("#geminiKeyStatus").textContent = error.message;
  }
});
$("#memoryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#memoryInput");
  if (!input.value.trim()) return;
  try {
    await api("/api/memories", {
      method: "POST",
      body: JSON.stringify({ memory: input.value.trim(), category: "general" }),
    });
    input.value = "";
    await loadMemories();
    toast("Memory saved.");
  } catch (error) {
    $("#memoryMessage").textContent = error.message;
  }
});
$("#memoryList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-memory-id]");
  if (!button) return;
  try {
    await api(`/api/memories/${button.dataset.memoryId}`, { method: "DELETE" });
    await loadMemories();
  } catch (error) {
    toast(error.message);
  }
});
$("#clearMemories").addEventListener("click", async () => {
  if (!window.confirm("Forget every saved memory? This cannot be undone.")) return;
  try {
    await api("/api/memories", { method: "DELETE", body: JSON.stringify({ confirm: true }) });
    await loadMemories();
    toast("All memories cleared.");
  } catch (error) {
    $("#memoryMessage").textContent = error.message;
  }
});
$("#memoryHint").addEventListener("click", openMemories);
document.addEventListener("keydown", (event) => {
  const target = event.target;
  const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    createChat();
  } else if (event.key === "/" && !editing) {
    event.preventDefault();
    $("#chatSearch").focus();
  } else if (event.key === "Escape") {
    $$(".modal-backdrop").forEach((modal) => modal.classList.add("hidden"));
    $("#sidebar").classList.remove("sidebar-open");
  }
});

async function initialize() {
  syncConnectivity();
  try {
    const settings = await api("/api/settings");
    state.settings = settings;
    $("#speedProfile").value = settings.speed_profile;
    $("#settingsProfile").value = settings.speed_profile;
    $("#tokenSetting").value = settings.max_new_tokens;
    $("#tokenValue").textContent = settings.max_new_tokens;
    $("#memoryHint").textContent = settings.use_memory ? "✳ Memory on" : "✳ Memory off";
  } catch (error) {
    setError(error.message);
  }
  await Promise.all([loadChats(), loadStatus()]);
  runGreetingAutomation().catch((error) => console.warn("Greeting automation unavailable:", error));
  setInterval(loadStatus, 3000);
  setInterval(() => {
    if (!state.busy) loadChats($("#chatSearch").value.trim());
  }, 15000);
  $("#messageInput").focus();
}

initialize();
