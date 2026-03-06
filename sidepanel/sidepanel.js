import {
  DEFAULT_ANSWER_STYLE,
  DEFAULT_INCLUDE_TOP_OPPORTUNITIES_RISKS,
  DEFAULT_MAX_CITATIONS,
  DEFAULT_PROMPTS,
  normalizeAnswerStyle,
  normalizeIncludeTopOpportunitiesRisks,
  normalizeMaxCitations,
  normalizeSavedPrompts
} from "../shared/settings.js";

const elements = {
  syncStatus: document.getElementById("sync-status"),
  embeddingProgress: document.getElementById("embedding-progress"),
  bookmarkCountNumber: document.getElementById("bookmark-count-number"),
  syncStateWord: document.getElementById("sync-state-word"),
  providerPill: document.getElementById("provider-pill"),
  chatMode: document.getElementById("chat-mode"),
  modelPill: document.getElementById("model-pill"),
  startSync: document.getElementById("start-sync"),
  stopSync: document.getElementById("stop-sync"),
  refreshState: document.getElementById("refresh-state"),
  openOptions: document.getElementById("open-options"),
  chatForm: document.getElementById("chat-form"),
  queryInput: document.getElementById("query-input"),
  answerStyle: document.getElementById("answer-style"),
  maxCitations: document.getElementById("max-citations"),
  includeTopOpportunitiesRisks: document.getElementById("include-top-opportunities-risks"),
  newPromptInput: document.getElementById("new-prompt-input"),
  addPrompt: document.getElementById("add-prompt"),
  messages: document.getElementById("messages"),
  citations: document.getElementById("citations"),
  sendQuery: document.getElementById("send-query"),
  quickPrompts: document.getElementById("quick-prompts"),
  exportMarkdown: document.getElementById("export-markdown"),
  exportCsv: document.getElementById("export-csv"),
  shareAnswer: document.getElementById("share-answer"),
  clearData: document.getElementById("clear-data")
};

let lastExchange = null;
let savedPrompts = [...DEFAULT_PROMPTS];
let isHydratingControls = false;

elements.startSync.addEventListener("click", async () => {
  setStatus("Starting sync...");
  const response = await sendRuntimeMessage({ type: "BOOKMARKBRAIN_START_SYNC" });
  if (!response?.ok) {
    setStatus(response?.error || "Could not start sync.");
    return;
  }

  setStatus("Sync started.");
  await refreshState();
});

elements.stopSync.addEventListener("click", async () => {
  const response = await sendRuntimeMessage({ type: "BOOKMARKBRAIN_STOP_SYNC" });
  if (!response?.ok) {
    setStatus(response?.error || "Could not stop sync.");
    return;
  }

  setStatus("Sync stopped.");
  await refreshState();
});

elements.refreshState.addEventListener("click", refreshState);

elements.clearData.addEventListener("click", async () => {
  if (!confirm("Delete all synced bookmarks and embeddings? This cannot be undone.")) {
    return;
  }
  elements.clearData.disabled = true;
  const response = await sendRuntimeMessage({ type: "BOOKMARKBRAIN_CLEAR_DATA" });
  elements.clearData.disabled = false;
  if (!response?.ok) {
    setStatus(response?.error || "Could not clear data.");
    return;
  }
  setStatus("All synced data cleared.");
  await refreshState();
});

elements.openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

elements.answerStyle.addEventListener("change", async () => {
  if (isHydratingControls) {
    return;
  }
  await persistSettings({
    answerStyle: normalizeAnswerStyle(elements.answerStyle.value)
  });
});

elements.maxCitations.addEventListener("change", async () => {
  if (isHydratingControls) {
    return;
  }
  const value = normalizeMaxCitations(elements.maxCitations.value);
  elements.maxCitations.value = String(value);
  await persistSettings({
    maxCitations: value
  });
});

elements.includeTopOpportunitiesRisks.addEventListener("change", async () => {
  if (isHydratingControls) {
    return;
  }
  await persistSettings({
    includeTopOpportunitiesRisks: normalizeIncludeTopOpportunitiesRisks(
      elements.includeTopOpportunitiesRisks.checked
    )
  });
});

elements.addPrompt.addEventListener("click", async () => {
  const value = String(elements.newPromptInput.value || "").trim();
  if (!value) {
    return;
  }

  const next = normalizeSavedPrompts([...savedPrompts, value]);
  savedPrompts = next;
  renderSavedPrompts();
  elements.newPromptInput.value = "";

  const response = await persistSettings({ savedPrompts: next });
  if (!response?.ok) {
    appendMessage("system", response?.error || "Could not save prompt.");
  }
});

elements.quickPrompts.addEventListener("click", async (event) => {
  const runButton = event.target.closest(".prompt-run");
  if (runButton) {
    const prompt = runButton.getAttribute("data-prompt") || "";
    if (!prompt || elements.sendQuery.disabled) {
      return;
    }
    elements.queryInput.value = prompt;
    elements.chatForm.requestSubmit();
    return;
  }

  const removeButton = event.target.closest(".prompt-remove");
  if (!removeButton) {
    return;
  }

  const index = Number.parseInt(removeButton.getAttribute("data-index") || "-1", 10);
  if (Number.isNaN(index) || index < 0 || index >= savedPrompts.length) {
    return;
  }

  const next = savedPrompts.filter((_, itemIndex) => itemIndex !== index);
  savedPrompts = normalizeSavedPrompts(next);
  renderSavedPrompts();

  const response = await persistSettings({ savedPrompts });
  if (!response?.ok) {
    appendMessage("system", response?.error || "Could not remove prompt.");
  }
});

elements.chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = elements.queryInput.value.trim();
  if (!query) {
    return;
  }

  removeEmptyState();
  appendMessage("user", query);
  elements.queryInput.value = "";
  clearCitations();

  const previousLabel = elements.sendQuery.textContent;
  elements.sendQuery.disabled = true;
  elements.sendQuery.textContent = "Thinking...";
  setChatMode("working");

  const thinkingNode = showThinkingIndicator();

  const response = await sendRuntimeMessage({
    type: "BOOKMARKBRAIN_CHAT_QUERY",
    query,
    options: {
      answerStyle: normalizeAnswerStyle(elements.answerStyle.value),
      maxCitations: normalizeMaxCitations(elements.maxCitations.value),
      includeTopOpportunitiesRisks: normalizeIncludeTopOpportunitiesRisks(
        elements.includeTopOpportunitiesRisks.checked
      )
    }
  });

  removeThinkingIndicator(thinkingNode);
  elements.sendQuery.disabled = false;
  elements.sendQuery.textContent = previousLabel;

  if (!response?.ok) {
    appendMessage("assistant", response?.error || "Failed to answer query.", { formatted: true });
    setChatMode("error");
    return;
  }

  const answer = response?.data?.answer || "No answer generated.";
  const citations = response?.data?.citations || [];
  const mode = response?.data?.mode || "standby";
  const retrieval = response?.data?.retrieval || "keyword";

  appendMessage("assistant", answer, { formatted: true, citations });
  renderCitations(citations);
  setChatMode(`${mode}/${retrieval}`);

  lastExchange = {
    query,
    answer,
    citations,
    mode: `${mode}/${retrieval}`,
    createdAt: new Date().toISOString(),
    answerStyle: normalizeAnswerStyle(elements.answerStyle.value),
    maxCitations: normalizeMaxCitations(elements.maxCitations.value)
  };
  updateExportActions();
});

elements.exportMarkdown.addEventListener("click", () => {
  if (!lastExchange) {
    return;
  }

  const content = buildMarkdownExport(lastExchange);
  downloadTextFile(`bookmarkbrain-answer-${timestampToken()}.md`, content, "text/markdown");
});

elements.exportCsv.addEventListener("click", () => {
  if (!lastExchange) {
    return;
  }

  const content = buildCitationsCsv(lastExchange.citations);
  downloadTextFile(`bookmarkbrain-citations-${timestampToken()}.csv`, content, "text/csv");
});

elements.shareAnswer.addEventListener("click", async () => {
  if (!lastExchange) {
    return;
  }

  const shareText = buildShareText(lastExchange);
  const copied = await copyToClipboard(shareText);
  if (copied) {
    appendMessage("system", "Share text copied to clipboard.");
    setChatMode("copied");
  } else {
    appendMessage("system", "Clipboard permission blocked. Use Export Markdown instead.");
    setChatMode("clipboard-blocked");
  }
});

async function refreshState() {
  const response = await sendRuntimeMessage({ type: "BOOKMARKBRAIN_GET_STATE" });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to load state.");
    return;
  }

  const { syncState, bookmarkCount, embeddingCount, settings, storage } = response.data;
  const normalizedSettings = normalizeSettings(settings || {});

  elements.bookmarkCountNumber.textContent = String(bookmarkCount || 0);
  elements.syncStateWord.textContent = syncState?.isSyncing ? "Syncing" : "Idle";

  const provider = normalizedSettings.provider || "unknown";
  const autoFlag = normalizedSettings.autoSyncEnabled ? "auto" : "manual";
  const scrollFlag = normalizedSettings.autoScrollDuringSync ? "scroll:on" : "scroll:off";
  const semanticFlag = normalizedSettings.embeddingSearchEnabled ? "semantic:on" : "semantic:off";
  const embedCount =
    normalizedSettings.embeddingSearchEnabled && Number.isFinite(embeddingCount)
      ? ` · vec:${embeddingCount}`
      : "";
  elements.providerPill.textContent = `${provider} · ${autoFlag} · ${scrollFlag} · ${semanticFlag}${embedCount}`;
  setModelPill(normalizedSettings);

  isHydratingControls = true;
  elements.answerStyle.value = normalizedSettings.answerStyle;
  elements.maxCitations.value = String(normalizedSettings.maxCitations);
  elements.includeTopOpportunitiesRisks.checked = normalizedSettings.includeTopOpportunitiesRisks;
  isHydratingControls = false;

  savedPrompts = normalizedSettings.savedPrompts;
  renderSavedPrompts();

  setStatus(formatSyncStatus(syncState, storage));
  setEmbeddingProgress({
    embeddingCount,
    bookmarkCount,
    semanticEnabled: normalizedSettings.embeddingSearchEnabled
  });
}

async function persistSettings(partial) {
  const response = await sendRuntimeMessage({
    type: "BOOKMARKBRAIN_SAVE_SETTINGS",
    settings: partial
  });
  return response;
}

function setStatus(text) {
  elements.syncStatus.textContent = text;
}

function setEmbeddingProgress({ embeddingCount, bookmarkCount, semanticEnabled }) {
  const total = Number.isFinite(bookmarkCount) ? bookmarkCount : 0;
  const vectors = Number.isFinite(embeddingCount) ? embeddingCount : 0;

  if (!semanticEnabled) {
    elements.embeddingProgress.textContent = "Vectors: off (semantic search disabled)";
    return;
  }

  if (total <= 0) {
    elements.embeddingProgress.textContent = "Vectors: 0/0";
    return;
  }

  if (vectors < total) {
    elements.embeddingProgress.textContent = `Vectors: ${vectors}/${total} indexing...`;
    return;
  }

  elements.embeddingProgress.textContent = `Vectors: ${vectors}/${total} ready`;
}

function formatSyncStatus(syncState, storage) {
  const parts = [];
  const modeText = syncState?.autoManaged ? "Mode: auto-sync" : "Mode: manual";
  parts.push(modeText);

  if (syncState?.lastIngestAt) {
    parts.push(`Last ingest: ${formatTime(syncState.lastIngestAt)}`);
  } else {
    parts.push("No ingest yet");
  }

  if (syncState?.lastError) {
    parts.push(`Issue: ${syncState.lastError}`);
  } else {
    parts.push("No sync errors");
  }

  if (storage?.nearQuota) {
    const mb = (storage.bytesInUse / (1024 * 1024)).toFixed(1);
    parts.push(`Storage high: ${mb}MB used`);
  }

  return parts.join(" | ");
}

function formatTime(rawDate) {
  const date = new Date(rawDate);
  if (Number.isNaN(date.getTime())) {
    return rawDate;
  }
  return date.toLocaleString();
}

function appendMessage(role, text, options = {}) {
  const node = document.createElement("article");
  node.className = `msg ${role}`;

  const citationMap = new Map(
    (options.citations || []).map((c) => [c.rank, c.url])
  );

  const contentNode = document.createElement("div");
  contentNode.className = "msg-content";
  if (options.formatted) {
    renderMarkdownLite(contentNode, text, citationMap);
  } else {
    contentNode.textContent = text;
  }

  node.appendChild(contentNode);
  elements.messages.appendChild(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function renderMarkdownLite(container, text, citationMap = new Map()) {
  const source = String(text || "").trim();
  if (!source) {
    container.textContent = "";
    return;
  }

  const lines = source.split("\n");
  const fragment = document.createDocumentFragment();

  let paragraphBuffer = [];
  let currentList = null;
  let listType = null;
  let inCodeBlock = false;
  let codeBuffer = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) {
      return;
    }
    const p = document.createElement("p");
    p.innerHTML = inlineFormat(paragraphBuffer.join(" "), citationMap);
    fragment.appendChild(p);
    paragraphBuffer = [];
  };

  const flushList = () => {
    if (!currentList) {
      return;
    }
    fragment.appendChild(currentList);
    currentList = null;
    listType = null;
  };

  const flushCodeBlock = () => {
    if (!inCodeBlock) {
      return;
    }
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = codeBuffer.join("\n");
    pre.appendChild(code);
    fragment.appendChild(pre);
    inCodeBlock = false;
    codeBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (inCodeBlock) {
        flushCodeBlock();
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = Math.min(4, headingMatch[1].length + 2);
      const heading = document.createElement(`h${level}`);
      heading.innerHTML = inlineFormat(headingMatch[2], citationMap);
      fragment.appendChild(heading);
      continue;
    }

    const bulletMatch = line.match(/^[-*]\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        currentList = document.createElement("ul");
        listType = "ul";
      }
      const li = document.createElement("li");
      li.innerHTML = inlineFormat(bulletMatch[1], citationMap);
      currentList.appendChild(li);
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        currentList = document.createElement("ol");
        listType = "ol";
      }
      const li = document.createElement("li");
      li.innerHTML = inlineFormat(orderedMatch[1], citationMap);
      currentList.appendChild(li);
      continue;
    }

    flushList();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushList();
  flushCodeBlock();
  container.appendChild(fragment);
}

function inlineFormat(input, citationMap = new Map()) {
  const tokens = [];
  let escaped = escapeHtml(input);

  escaped = escaped.replace(/`([^`]+)`/g, (_full, codeContent) => {
    const token = `__BB_CODE_${tokens.length}__`;
    tokens.push(`<code>${codeContent}</code>`);
    return token;
  });

  escaped = escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\[(\d+)\]/g, (_full, num) => {
    const rank = Number(num);
    const url = citationMap.get(rank);
    if (url && url.startsWith("https://")) {
      return `<a class="cite-ref" href="${url}" target="_blank" rel="noreferrer">[${num}]</a>`;
    }
    return `<span class="cite-ref">[${num}]</span>`;
  });

  for (let index = 0; index < tokens.length; index += 1) {
    const token = `__BB_CODE_${index}__`;
    escaped = escaped.replace(token, tokens[index]);
  }

  return escaped;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEmptyState() {
  if (elements.messages.children.length > 0) {
    return;
  }
  appendMessage(
    "system",
    "Ask about your saved items. Start sync on x.com/i/bookmarks or reddit.com/user/<you>/saved first."
  );
}

function removeEmptyState() {
  const systemNodes = Array.from(elements.messages.querySelectorAll(".msg.system"));
  if (systemNodes.length === 1 && elements.messages.children.length === 1) {
    systemNodes[0].remove();
  }
}

function clearCitations() {
  elements.citations.innerHTML = "";
}

function renderCitations(citations) {
  clearCitations();
  if (!citations.length) {
    return;
  }

  const title = document.createElement("p");
  title.className = "sync-line";
  title.textContent = "Sources";
  elements.citations.appendChild(title);

  for (const citation of citations) {
    const wrapper = document.createElement("div");
    wrapper.className = "citation";

    const link = document.createElement("a");
    link.href = citation.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `[${citation.rank}] ${formatCitationUrl(citation.url)}`;

    const snippet = document.createElement("p");
    snippet.textContent = citation.snippet || "";

    wrapper.appendChild(link);
    wrapper.appendChild(snippet);
    elements.citations.appendChild(wrapper);
  }
}

function formatCitationUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch (_error) {
    return url;
  }
}

function setChatMode(mode) {
  elements.chatMode.textContent = mode;
}

function setModelPill(settings) {
  const provider = settings.provider || "openrouter";
  let model = "";
  if (provider === "openai") {
    model = settings.openaiChatModel || "gpt-4o-mini";
  } else {
    model = settings.openrouterChatModel || "openai/gpt-4o-mini";
  }
  elements.modelPill.textContent = model;
  elements.modelPill.title = `${provider}: ${model}`;
}

function showThinkingIndicator() {
  const node = document.createElement("article");
  node.className = "msg thinking";
  const dots = document.createElement("div");
  dots.className = "thinking-dots";
  dots.innerHTML = "<span></span><span></span><span></span>";
  node.appendChild(dots);
  elements.messages.appendChild(node);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  return node;
}

function removeThinkingIndicator(node) {
  if (node && node.parentNode) {
    node.remove();
  }
}

function updateExportActions() {
  const enabled = Boolean(lastExchange);
  elements.exportMarkdown.disabled = !enabled;
  elements.exportCsv.disabled = !enabled;
  elements.shareAnswer.disabled = !enabled;
}

function renderSavedPrompts() {
  elements.quickPrompts.innerHTML = "";
  const prompts = normalizeSavedPrompts(savedPrompts);

  for (let index = 0; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    const item = document.createElement("div");
    item.className = "prompt-item";

    const runButton = document.createElement("button");
    runButton.type = "button";
    runButton.className = "chip prompt-run";
    runButton.setAttribute("data-prompt", prompt);
    runButton.title = prompt;
    runButton.textContent = prompt;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "prompt-remove";
    removeButton.setAttribute("data-index", String(index));
    removeButton.setAttribute("aria-label", `Remove prompt ${index + 1}`);
    removeButton.textContent = "x";

    item.appendChild(runButton);
    item.appendChild(removeButton);
    elements.quickPrompts.appendChild(item);
  }
}

function buildMarkdownExport(exchange) {
  const sections = [
    "# BookmarkBrain Answer",
    `- Date: ${new Date(exchange.createdAt).toLocaleString()}`,
    `- Mode: ${exchange.mode}`,
    `- Style: ${exchange.answerStyle}`,
    `- Max citations: ${exchange.maxCitations}`,
    "",
    "## Question",
    exchange.query,
    "",
    "## Answer",
    exchange.answer,
    "",
    "## Sources"
  ];

  if (!exchange.citations.length) {
    sections.push("- No citations available.");
  } else {
    for (const citation of exchange.citations) {
      sections.push(`- [${citation.rank}] ${citation.url}`);
    }
  }

  return sections.join("\n");
}

function buildCitationsCsv(citations) {
  const rows = [["rank", "url", "snippet"]];
  for (const citation of citations) {
    rows.push([String(citation.rank), citation.url || "", citation.snippet || ""]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function buildShareText(exchange) {
  const lines = [
    `BookmarkBrain answer (${new Date(exchange.createdAt).toLocaleString()}):`,
    "",
    `Q: ${exchange.query}`,
    "",
    exchange.answer,
    "",
    "Sources:"
  ];

  if (!exchange.citations.length) {
    lines.push("- none");
  } else {
    for (const citation of exchange.citations) {
      lines.push(`[${citation.rank}] ${citation.url}`);
    }
  }

  return lines.join("\n");
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_error) {
      // Fallback below.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  document.body.appendChild(textarea);
  textarea.select();
  const success = document.execCommand("copy");
  textarea.remove();
  return success;
}

function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function timestampToken() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function normalizeSettings(rawSettings) {
  return {
    provider: rawSettings.provider || "openrouter",
    autoSyncEnabled: Boolean(rawSettings.autoSyncEnabled),
    autoScrollDuringSync: Boolean(rawSettings.autoScrollDuringSync),
    embeddingSearchEnabled: Boolean(rawSettings.embeddingSearchEnabled),
    answerStyle: normalizeAnswerStyle(rawSettings.answerStyle, DEFAULT_ANSWER_STYLE),
    maxCitations: normalizeMaxCitations(rawSettings.maxCitations, {
      fallback: DEFAULT_MAX_CITATIONS
    }),
    includeTopOpportunitiesRisks: normalizeIncludeTopOpportunitiesRisks(
      rawSettings.includeTopOpportunitiesRisks,
      DEFAULT_INCLUDE_TOP_OPPORTUNITIES_RISKS
    ),
    savedPrompts: normalizeSavedPrompts(rawSettings.savedPrompts, {
      fallback: DEFAULT_PROMPTS,
      allowEmpty: true
    }),
    openrouterChatModel: rawSettings.openrouterChatModel || "openai/gpt-4o-mini",
    openaiChatModel: rawSettings.openaiChatModel || "gpt-4o-mini"
  };
}

function sendRuntimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }
      resolve(response);
    });
  });
}

updateExportActions();
renderEmptyState();
renderSavedPrompts();
refreshState();
