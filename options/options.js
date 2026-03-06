import {
  DEFAULT_ANSWER_STYLE,
  DEFAULT_INCLUDE_TOP_OPPORTUNITIES_RISKS,
  DEFAULT_MAX_CITATIONS,
  normalizeAnswerStyle,
  normalizeIncludeTopOpportunitiesRisks,
  normalizeMaxCitations
} from "../shared/settings.js";

const elements = {
  provider: document.getElementById("provider"),
  autoSyncEnabled: document.getElementById("auto-sync-enabled"),
  autoScrollDuringSync: document.getElementById("auto-scroll-during-sync"),
  scrollSpeed: document.getElementById("scroll-speed"),
  embeddingSearchEnabled: document.getElementById("embedding-search-enabled"),
  answerStyle: document.getElementById("answer-style"),
  maxCitations: document.getElementById("max-citations"),
  includeTopOpportunitiesRisks: document.getElementById("include-top-opportunities-risks"),
  openrouterSettings: document.getElementById("openrouter-settings"),
  openrouterChatModelList: document.getElementById("openrouter-chat-model-list"),
  openrouterModelsStatus: document.getElementById("openrouter-models-status"),
  openaiSettings: document.getElementById("openai-settings"),
  openrouterApiKey: document.getElementById("openrouter-api-key"),
  clearOpenrouterKey: document.getElementById("clear-openrouter-key"),
  openrouterKeyStatus: document.getElementById("openrouter-key-status"),
  openrouterChatModel: document.getElementById("openrouter-chat-model"),
  openrouterEmbeddingModel: document.getElementById("openrouter-embedding-model"),
  saveOpenrouterFav: document.getElementById("save-openrouter-fav"),
  favModelsOpenrouter: document.getElementById("openrouter-fav-models"),
  openaiApiKey: document.getElementById("openai-api-key"),
  clearOpenaiKey: document.getElementById("clear-openai-key"),
  openaiKeyStatus: document.getElementById("openai-key-status"),
  openaiChatModel: document.getElementById("openai-chat-model"),
  openaiEmbeddingModel: document.getElementById("openai-embedding-model"),
  saveOpenaiFav: document.getElementById("save-openai-fav"),
  favModelsOpenai: document.getElementById("openai-fav-models"),
  saveSettings: document.getElementById("save-settings"),
  clearData: document.getElementById("clear-data"),
  status: document.getElementById("status")
};

let favoriteOpenrouterModels = [];
let favoriteOpenaiModels = [];

elements.provider.addEventListener("change", () => {
  updateProviderVisibility(elements.provider.value);
});

elements.saveOpenrouterFav.addEventListener("click", async () => {
  const model = elements.openrouterChatModel.value.trim();
  if (!model || favoriteOpenrouterModels.includes(model)) {
    return;
  }
  favoriteOpenrouterModels = [...favoriteOpenrouterModels, model].slice(0, 20);
  renderFavModels("openrouter");
  await saveFavorites();
});

elements.saveOpenaiFav.addEventListener("click", async () => {
  const model = elements.openaiChatModel.value.trim();
  if (!model || favoriteOpenaiModels.includes(model)) {
    return;
  }
  favoriteOpenaiModels = [...favoriteOpenaiModels, model].slice(0, 20);
  renderFavModels("openai");
  await saveFavorites();
});

elements.saveSettings.addEventListener("click", async () => {
  const settings = {
    provider: elements.provider.value,
    autoSyncEnabled: elements.autoSyncEnabled.checked,
    autoScrollDuringSync: elements.autoScrollDuringSync.checked,
    scrollSpeed: elements.scrollSpeed.value,
    embeddingSearchEnabled: elements.embeddingSearchEnabled.checked,
    answerStyle: normalizeAnswerStyle(elements.answerStyle.value),
    maxCitations: normalizeMaxCitations(elements.maxCitations.value, {
      fallback: DEFAULT_MAX_CITATIONS
    }),
    includeTopOpportunitiesRisks: normalizeIncludeTopOpportunitiesRisks(
      elements.includeTopOpportunitiesRisks.checked,
      DEFAULT_INCLUDE_TOP_OPPORTUNITIES_RISKS
    ),
    openrouterChatModel: elements.openrouterChatModel.value.trim(),
    openrouterEmbeddingModel: elements.openrouterEmbeddingModel.value.trim(),
    openaiChatModel: elements.openaiChatModel.value.trim(),
    openaiEmbeddingModel: elements.openaiEmbeddingModel.value.trim()
  };

  const openrouterApiKey = elements.openrouterApiKey.value.trim();
  const openaiApiKey = elements.openaiApiKey.value.trim();
  if (openrouterApiKey) {
    settings.openrouterApiKey = openrouterApiKey;
  }
  if (openaiApiKey) {
    settings.openaiApiKey = openaiApiKey;
  }

  const response = await sendRuntimeMessage({
    type: "BOOKMARKBRAIN_SAVE_SETTINGS",
    settings
  });

  if (!response?.ok) {
    setStatus(response?.error || "Failed to save settings.", true);
    return;
  }

  elements.openrouterApiKey.value = "";
  elements.openaiApiKey.value = "";
  const merged = response?.data?.settings || settings;
  updateKeyStatus(Boolean(merged.hasOpenrouterApiKey || merged.openrouterApiKey), "openrouter");
  updateKeyStatus(Boolean(merged.hasOpenaiApiKey || merged.openaiApiKey), "openai");
  setStatus("Settings saved.");
});

elements.clearData.addEventListener("click", async () => {
  const confirmed = confirm("Clear all indexed bookmarks and sync state?");
  if (!confirmed) {
    return;
  }

  const response = await sendRuntimeMessage({ type: "BOOKMARKBRAIN_CLEAR_DATA" });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to clear data.", true);
    return;
  }

  setStatus("Indexed data cleared.");
});

elements.clearOpenrouterKey.addEventListener("click", async () => {
  await clearProviderKey("openrouter");
});

elements.clearOpenaiKey.addEventListener("click", async () => {
  await clearProviderKey("openai");
});

async function init() {
  const response = await sendRuntimeMessage({ type: "BOOKMARKBRAIN_GET_SETTINGS" });
  if (!response?.ok) {
    setStatus(response?.error || "Failed to load settings.", true);
    return;
  }

  const settings = response.data || {};
  elements.provider.value = settings.provider || "openrouter";
  elements.autoSyncEnabled.checked = Boolean(settings.autoSyncEnabled);
  elements.autoScrollDuringSync.checked = Boolean(settings.autoScrollDuringSync);
  elements.scrollSpeed.value = settings.scrollSpeed || "normal";
  elements.embeddingSearchEnabled.checked = Boolean(settings.embeddingSearchEnabled);
  elements.answerStyle.value = normalizeAnswerStyle(settings.answerStyle, DEFAULT_ANSWER_STYLE);
  elements.maxCitations.value = String(
    normalizeMaxCitations(settings.maxCitations, {
      fallback: DEFAULT_MAX_CITATIONS
    })
  );
  elements.includeTopOpportunitiesRisks.checked = normalizeIncludeTopOpportunitiesRisks(
    settings.includeTopOpportunitiesRisks,
    DEFAULT_INCLUDE_TOP_OPPORTUNITIES_RISKS
  );
  elements.openrouterApiKey.value = "";
  elements.openrouterChatModel.value = settings.openrouterChatModel || "openai/gpt-4o-mini";
  elements.openrouterEmbeddingModel.value =
    settings.openrouterEmbeddingModel || "google/gemini-embedding-001";
  elements.openaiApiKey.value = "";
  elements.openaiChatModel.value = settings.openaiChatModel || "gpt-4o-mini";
  elements.openaiEmbeddingModel.value =
    settings.openaiEmbeddingModel || "text-embedding-3-small";
  updateKeyStatus(Boolean(settings.hasOpenrouterApiKey), "openrouter");
  updateKeyStatus(Boolean(settings.hasOpenaiApiKey), "openai");

  favoriteOpenrouterModels = Array.isArray(settings.favoriteOpenrouterModels)
    ? settings.favoriteOpenrouterModels
    : [];
  favoriteOpenaiModels = Array.isArray(settings.favoriteOpenaiModels)
    ? settings.favoriteOpenaiModels
    : [];
  renderFavModels("openrouter");
  renderFavModels("openai");

  updateProviderVisibility(elements.provider.value);
  void fetchOpenRouterModels();
}

async function fetchOpenRouterModels() {
  elements.openrouterModelsStatus.textContent = "Loading models from OpenRouter...";
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    const models = (payload?.data || [])
      .filter((m) => m?.id && m?.architecture?.output_modalities?.includes("text"))
      .sort((a, b) => a.id.localeCompare(b.id));

    elements.openrouterChatModelList.innerHTML = "";
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model.id;
      option.label = model.name || model.id;
      elements.openrouterChatModelList.appendChild(option);
    }

    elements.openrouterModelsStatus.textContent =
      models.length > 0 ? `${models.length} models available.` : "No models loaded.";
  } catch (_error) {
    elements.openrouterModelsStatus.textContent =
      "Could not load model list. You can still type a model ID manually.";
  }
}

function updateProviderVisibility(provider) {
  elements.openrouterSettings.style.display = provider === "openrouter" ? "grid" : "none";
  elements.openaiSettings.style.display = provider === "openai" ? "grid" : "none";
}

function setStatus(text, isError = false) {
  elements.status.textContent = text;
  elements.status.style.color = isError ? "#ff9aa6" : "#8ae9c7";
}

function updateKeyStatus(hasKey, provider) {
  if (provider === "openrouter") {
    elements.openrouterKeyStatus.textContent = hasKey
      ? "API key saved. Leave blank to keep current key."
      : "No API key saved.";
    return;
  }
  elements.openaiKeyStatus.textContent = hasKey
    ? "API key saved. Leave blank to keep current key."
    : "No API key saved.";
}

async function clearProviderKey(provider) {
  const providerLabel = provider === "openrouter" ? "OpenRouter" : "OpenAI";
  const confirmed = confirm(`Clear stored ${providerLabel} API key?`);
  if (!confirmed) {
    return;
  }

  const settings =
    provider === "openrouter"
      ? { openrouterApiKey: "" }
      : { openaiApiKey: "" };

  const response = await sendRuntimeMessage({
    type: "BOOKMARKBRAIN_SAVE_SETTINGS",
    settings
  });

  if (!response?.ok) {
    setStatus(response?.error || `Failed to clear ${providerLabel} key.`, true);
    return;
  }

  if (provider === "openrouter") {
    elements.openrouterApiKey.value = "";
    updateKeyStatus(false, "openrouter");
  } else {
    elements.openaiApiKey.value = "";
    updateKeyStatus(false, "openai");
  }

  setStatus(`${providerLabel} API key cleared.`);
}

function renderFavModels(provider) {
  const container = provider === "openrouter" ? elements.favModelsOpenrouter : elements.favModelsOpenai;
  const models = provider === "openrouter" ? favoriteOpenrouterModels : favoriteOpenaiModels;
  container.innerHTML = "";

  for (let index = 0; index < models.length; index += 1) {
    const model = models[index];
    const item = document.createElement("div");
    item.className = "fav-chip-item";

    const useBtn = document.createElement("button");
    useBtn.type = "button";
    useBtn.className = "fav-chip-use";
    useBtn.textContent = model;
    useBtn.title = `Use ${model}`;
    useBtn.addEventListener("click", () => {
      if (provider === "openrouter") {
        elements.openrouterChatModel.value = model;
      } else {
        elements.openaiChatModel.value = model;
      }
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "fav-chip-remove";
    removeBtn.setAttribute("aria-label", `Remove ${model}`);
    removeBtn.textContent = "×";
    removeBtn.addEventListener("click", async () => {
      if (provider === "openrouter") {
        favoriteOpenrouterModels = favoriteOpenrouterModels.filter((_, i) => i !== index);
        renderFavModels("openrouter");
      } else {
        favoriteOpenaiModels = favoriteOpenaiModels.filter((_, i) => i !== index);
        renderFavModels("openai");
      }
      await saveFavorites();
    });

    item.appendChild(useBtn);
    item.appendChild(removeBtn);
    container.appendChild(item);
  }
}

async function saveFavorites() {
  await sendRuntimeMessage({
    type: "BOOKMARKBRAIN_SAVE_SETTINGS",
    settings: { favoriteOpenrouterModels, favoriteOpenaiModels }
  });
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

init();
