import { runChatCompletion, runEmbeddings } from "./providers/index.js";
import {
  DEFAULT_ANSWER_STYLE,
  DEFAULT_MAX_CITATIONS,
  DEFAULT_PROMPTS,
  normalizeAnswerStyle,
  normalizeMaxCitations,
  normalizeSavedPrompts
} from "../shared/settings.js";

const STORAGE_KEYS = {
  SETTINGS: "appSettings",
  BOOKMARKS: "bookmarksById",
  SYNC_STATE: "syncState",
  EMBEDDINGS: "embeddingsByTweetId"
};

const DEFAULT_SETTINGS = {
  provider: "openrouter",
  autoSyncEnabled: false,
  autoScrollDuringSync: false,
  scrollSpeed: "normal",
  embeddingSearchEnabled: false,
  answerStyle: DEFAULT_ANSWER_STYLE,
  maxCitations: DEFAULT_MAX_CITATIONS,
  savedPrompts: [...DEFAULT_PROMPTS],
  openrouterApiKey: "",
  openrouterChatModel: "openai/gpt-4o-mini",
  openrouterEmbeddingModel: "google/gemini-embedding-001",
  openaiApiKey: "",
  openaiChatModel: "gpt-4o-mini",
  openaiEmbeddingModel: "text-embedding-3-small",
  favoriteOpenrouterModels: [],
  favoriteOpenaiModels: []
};

const DEFAULT_SYNC_STATE = {
  isSyncing: false,
  syncTabId: null,
  autoManaged: false,
  lastSyncAt: null,
  lastIngestAt: null,
  lastHeartbeatAt: null,
  lastError: null,
  totalCaptured: 0
};

const STALE_SYNC_MS = 45_000;
const STORAGE_NEAR_QUOTA_THRESHOLD = 0.8;
const DEFAULT_STORAGE_LIMIT_BYTES = 10 * 1024 * 1024;
const EMBEDDING_BATCH_SIZE = 24;
const EMBEDDING_INPUT_MAX_CHARS = 3000;

let embeddingQueue = Promise.resolve();

chrome.runtime.onInstalled.addListener(async () => {
  await initializeStorage();
  await reconcileSyncStateOnWake();
  await setPanelBehavior();
  await maybeRunAutoSyncForActiveTab();
});

chrome.runtime.onStartup.addListener(async () => {
  await initializeStorage();
  await reconcileSyncStateOnWake();
  await setPanelBehavior();
  await maybeRunAutoSyncForActiveTab();
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  void handleActiveTabChange(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab?.active) {
    return;
  }

  if (!changeInfo.url && changeInfo.status !== "complete") {
    return;
  }

  void handleAutoSyncForTab(tab);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || "Unexpected error."
      });
    });
  return true;
});

async function setPanelBehavior() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn("Failed to set side panel behavior", error);
  }
}

async function initializeStorage() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.BOOKMARKS,
    STORAGE_KEYS.SYNC_STATE,
    STORAGE_KEYS.EMBEDDINGS
  ]);

  const next = {};
  const existingSettings = result[STORAGE_KEYS.SETTINGS];
  if (!existingSettings) {
    next[STORAGE_KEYS.SETTINGS] = DEFAULT_SETTINGS;
  } else {
    const normalized = normalizeSettings(existingSettings);
    if (JSON.stringify(normalized) !== JSON.stringify(existingSettings)) {
      next[STORAGE_KEYS.SETTINGS] = normalized;
    }
  }
  if (!result[STORAGE_KEYS.BOOKMARKS]) {
    next[STORAGE_KEYS.BOOKMARKS] = {};
  }
  if (!result[STORAGE_KEYS.EMBEDDINGS]) {
    next[STORAGE_KEYS.EMBEDDINGS] = {};
  }
  const existingSyncState = result[STORAGE_KEYS.SYNC_STATE];
  if (!existingSyncState) {
    next[STORAGE_KEYS.SYNC_STATE] = DEFAULT_SYNC_STATE;
  } else {
    const normalizedSyncState = normalizeSyncState(existingSyncState);
    if (JSON.stringify(normalizedSyncState) !== JSON.stringify(existingSyncState)) {
      next[STORAGE_KEYS.SYNC_STATE] = normalizedSyncState;
    }
  }

  if (Object.keys(next).length > 0) {
    await chrome.storage.local.set(next);
  }
}

async function handleMessage(message, sender) {
  if (!message?.type) {
    return { ok: false, error: "Missing message type." };
  }

  switch (message.type) {
    case "BOOKMARKBRAIN_GET_STATE":
      return getState();
    case "BOOKMARKBRAIN_START_SYNC":
      return startSync();
    case "BOOKMARKBRAIN_STOP_SYNC":
      return stopSync();
    case "BOOKMARKBRAIN_SYNC_HEARTBEAT":
      return handleSyncHeartbeat(sender);
    case "BOOKMARKBRAIN_INGEST_TWEETS":
      return ingestTweets(message.tweets, sender);
    case "BOOKMARKBRAIN_GET_SETTINGS":
      return getSettings();
    case "BOOKMARKBRAIN_SAVE_SETTINGS":
      return saveSettings(message.settings);
    case "BOOKMARKBRAIN_CLEAR_DATA":
      return clearData();
    case "BOOKMARKBRAIN_CHAT_QUERY":
      return runChatQuery(message.query, message.options);
    default:
      return { ok: false, error: `Unknown message type "${message.type}".` };
  }
}

async function getState() {
  const { appSettings, bookmarksById, syncState, embeddingsByTweetId } = await chrome.storage.local.get([
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.BOOKMARKS,
    STORAGE_KEYS.SYNC_STATE,
    STORAGE_KEYS.EMBEDDINGS
  ]);

  const settings = normalizeSettings(appSettings || DEFAULT_SETTINGS);
  const normalizedSyncState = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
  const healthySyncState = await reconcileSyncStateIfStale(normalizedSyncState);
  const storageInfo = await getStorageInfo();
  return {
    ok: true,
    data: {
      bookmarkCount: Object.keys(bookmarksById || {}).length,
      embeddingCount: Object.keys(embeddingsByTweetId || {}).length,
      syncState: healthySyncState,
      storage: storageInfo,
      settings: sanitizeSettingsForUI(settings)
    }
  };
}

function normalizeSyncState(input) {
  const merged = {
    ...DEFAULT_SYNC_STATE,
    ...(input || {})
  };

  return {
    ...merged,
    isSyncing: Boolean(merged.isSyncing),
    autoManaged: Boolean(merged.autoManaged),
    syncTabId: Number.isInteger(merged.syncTabId) ? merged.syncTabId : null
  };
}

function sanitizeSettingsForUI(settings) {
  return {
    ...settings,
    openrouterApiKey: settings.openrouterApiKey ? "********" : "",
    openaiApiKey: settings.openaiApiKey ? "********" : "",
    hasOpenrouterApiKey: Boolean(settings.openrouterApiKey),
    hasOpenaiApiKey: Boolean(settings.openaiApiKey)
  };
}

function sanitizeSettingsForOptions(settings) {
  return {
    ...settings,
    openrouterApiKey: "",
    openaiApiKey: "",
    hasOpenrouterApiKey: Boolean(settings.openrouterApiKey),
    hasOpenaiApiKey: Boolean(settings.openaiApiKey)
  };
}

function normalizeSettings(input) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(input || {})
  };

  return {
    ...merged,
    autoSyncEnabled: Boolean(merged.autoSyncEnabled),
    autoScrollDuringSync: Boolean(merged.autoScrollDuringSync),
    embeddingSearchEnabled: Boolean(merged.embeddingSearchEnabled),
    answerStyle: normalizeAnswerStyle(merged.answerStyle, DEFAULT_SETTINGS.answerStyle),
    maxCitations: normalizeMaxCitations(merged.maxCitations, {
      fallback: DEFAULT_SETTINGS.maxCitations
    }),
    savedPrompts: normalizeSavedPrompts(merged.savedPrompts, {
      fallback: DEFAULT_SETTINGS.savedPrompts,
      allowEmpty: true
    }),
    favoriteOpenrouterModels: normalizeFavModels(merged.favoriteOpenrouterModels),
    favoriteOpenaiModels: normalizeFavModels(merged.favoriteOpenaiModels)
  };
}

function normalizeFavModels(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((m) => typeof m === "string" && m.trim().length > 0).slice(0, 20);
}

async function getSettings() {
  const { appSettings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const normalized = normalizeSettings(appSettings || DEFAULT_SETTINGS);
  return {
    ok: true,
    data: sanitizeSettingsForOptions(normalized)
  };
}

async function saveSettings(partialSettings = {}) {
  const { appSettings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const current = normalizeSettings(appSettings || DEFAULT_SETTINGS);

  const merged = normalizeSettings({
    ...current,
    ...partialSettings
  });

  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: merged });

  if (Object.prototype.hasOwnProperty.call(partialSettings, "autoSyncEnabled")) {
    if (merged.autoSyncEnabled) {
      await maybeRunAutoSyncForActiveTab();
    } else {
      await stopAutoManagedSyncIfNeeded();
    }
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "autoScrollDuringSync")) {
    const { syncState } = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATE);
    const activeSync = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
    if (activeSync.isSyncing && activeSync.syncTabId) {
      await startSyncOnTab(activeSync.syncTabId, activeSync.sourceUrl || null, {
        autoManaged: Boolean(activeSync.autoManaged)
      });
    }
  }

  if (shouldTriggerEmbeddingBackfill(current, merged, partialSettings)) {
    void enqueueEmbeddingJob(async () => {
      await backfillEmbeddingsForAllBookmarks(merged);
    });
  }

  return { ok: true, data: { settings: sanitizeSettingsForOptions(merged) } };
}

function shouldTriggerEmbeddingBackfill(current, merged, partialSettings) {
  if (!merged.embeddingSearchEnabled) {
    return false;
  }

  if (
    Object.prototype.hasOwnProperty.call(partialSettings, "embeddingSearchEnabled") &&
    !current.embeddingSearchEnabled &&
    merged.embeddingSearchEnabled
  ) {
    return true;
  }

  if (Object.prototype.hasOwnProperty.call(partialSettings, "provider")) {
    return true;
  }

  if (merged.provider === "openrouter") {
    return Object.prototype.hasOwnProperty.call(partialSettings, "openrouterEmbeddingModel");
  }

  if (merged.provider === "openai") {
    return Object.prototype.hasOwnProperty.call(partialSettings, "openaiEmbeddingModel");
  }

  return false;
}

async function clearData() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.BOOKMARKS]: {},
    [STORAGE_KEYS.EMBEDDINGS]: {},
    [STORAGE_KEYS.SYNC_STATE]: {
      ...DEFAULT_SYNC_STATE,
      lastSyncAt: new Date().toISOString()
    }
  });

  return { ok: true };
}

async function startSync() {
  const tab = await getActiveBookmarksTab();
  if (!tab?.id) {
    await setSyncError("Open the X/Twitter bookmarks page in the active tab first.");
    return {
      ok: false,
      error: "Open https://x.com/i/bookmarks in your active tab first."
    };
  }

  return startSyncOnTab(tab.id, tab.url, { autoManaged: false });
}

async function ensureContentScript(tabId, syncOptions = {}) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/bookmarks-scraper.js"]
    });
    await chrome.tabs.sendMessage(tabId, {
      type: "BOOKMARKBRAIN_SYNC_START",
      options: syncOptions
    });
    return true;
  } catch (error) {
    console.warn("Failed to re-inject content script", error);
    return false;
  }
}

async function stopSync() {
  const { syncState } = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATE);
  const current = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
  const syncTabId = current.syncTabId;

  if (syncTabId) {
    await stopSyncOnTab(syncTabId);
  } else {
    const tab = await getActiveBookmarksTab();
    if (tab?.id) {
      await stopSyncOnTab(tab.id);
    }
  }

  await patchSyncState({
    isSyncing: false,
    syncTabId: null,
    autoManaged: false,
    lastHeartbeatAt: null
  });

  return { ok: true };
}

async function startSyncOnTab(tabId, tabUrl, { autoManaged }) {
  const { syncState, appSettings } = await chrome.storage.local.get([
    STORAGE_KEYS.SYNC_STATE,
    STORAGE_KEYS.SETTINGS
  ]);
  const current = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
  const settings = normalizeSettings(appSettings || DEFAULT_SETTINGS);
  const syncOptions = {
    autoScrollEnabled: Boolean(settings.autoScrollDuringSync),
    scrollSpeed: settings.scrollSpeed || "normal"
  };

  if (current.isSyncing && current.syncTabId === tabId) {
    let reachable = true;
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: "BOOKMARKBRAIN_SYNC_START",
        options: syncOptions
      });
    } catch (_error) {
      reachable = await ensureContentScript(tabId, syncOptions);
    }

    if (!reachable) {
      await patchSyncState({
        isSyncing: false,
        syncTabId: null,
        autoManaged: false,
        lastHeartbeatAt: null,
        lastError: "Sync session became stale and was reset."
      });
      return {
        ok: false,
        error: "Could not re-establish sync. Refresh bookmarks page and try again."
      };
    }

    if (current.autoManaged !== autoManaged) {
      await patchSyncState({ autoManaged });
    }
    return { ok: true };
  }

  if (current.isSyncing && current.syncTabId && current.syncTabId !== tabId) {
    await stopSyncOnTab(current.syncTabId);
  }

  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "BOOKMARKBRAIN_SYNC_START",
      options: syncOptions
    });
  } catch (_error) {
    const recovered = await ensureContentScript(tabId, syncOptions);
    if (!recovered) {
      await setSyncError("Could not reach content script on bookmarks page.");
      return {
        ok: false,
        error: "Could not start sync. Refresh the bookmarks page and try again."
      };
    }
  }

  await patchSyncState({
    isSyncing: true,
    syncTabId: tabId,
    autoManaged,
    lastSyncAt: new Date().toISOString(),
    lastHeartbeatAt: new Date().toISOString(),
    lastError: null,
    sourceUrl: tabUrl || null
  });

  return { ok: true };
}

async function stopSyncOnTab(tabId) {
  if (!tabId) {
    return;
  }

  try {
    await chrome.tabs.sendMessage(tabId, { type: "BOOKMARKBRAIN_SYNC_STOP" });
  } catch (_error) {
    // Ignore when tab no longer has a receiver.
  }
}

async function getActiveBookmarksTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs[0];
  if (!tab?.url) {
    return null;
  }

  if (!isBookmarksUrl(tab.url)) {
    return null;
  }

  return tab;
}

function isBookmarksUrl(url) {
  if (!url) {
    return false;
  }
  return (
    url.startsWith("https://x.com/i/bookmarks") ||
    url.startsWith("https://twitter.com/i/bookmarks")
  );
}

async function maybeRunAutoSyncForActiveTab() {
  const { appSettings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = normalizeSettings(appSettings || DEFAULT_SETTINGS);
  if (!settings.autoSyncEnabled) {
    return;
  }

  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const activeTab = tabs[0];
  if (!activeTab?.id) {
    return;
  }

  await handleAutoSyncForTab(activeTab);
}

async function handleActiveTabChange(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await handleAutoSyncForTab(tab);
  } catch (_error) {
    // Ignore temporary tab lookup failures.
  }
}

async function handleAutoSyncForTab(tab) {
  const { appSettings } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  const settings = normalizeSettings(appSettings || DEFAULT_SETTINGS);
  if (!settings.autoSyncEnabled) {
    return;
  }

  if (tab?.id && isBookmarksUrl(tab.url)) {
    await startSyncOnTab(tab.id, tab.url, { autoManaged: true });
    return;
  }

  await stopAutoManagedSyncIfNeeded();
}

async function stopAutoManagedSyncIfNeeded() {
  const { syncState } = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATE);
  const current = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
  if (!current.isSyncing || !current.autoManaged) {
    return;
  }

  await stopSyncOnTab(current.syncTabId);
  await patchSyncState({
    isSyncing: false,
    syncTabId: null,
    autoManaged: false,
    lastHeartbeatAt: null
  });
}

async function patchSyncState(partial) {
  const { syncState } = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATE);
  const current = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
  const nextState = {
    ...current,
    ...partial
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.SYNC_STATE]: nextState
  });
}

async function setSyncError(message) {
  await patchSyncState({
    isSyncing: false,
    syncTabId: null,
    autoManaged: false,
    lastHeartbeatAt: null,
    lastError: message
  });
}

async function handleSyncHeartbeat(sender) {
  const now = new Date().toISOString();
  await patchSyncState({
    isSyncing: true,
    syncTabId: sender?.tab?.id || null,
    lastHeartbeatAt: now,
    lastError: null
  });
  return { ok: true };
}

async function reconcileSyncStateOnWake() {
  const { syncState } = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATE);
  const current = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
  if (!current.isSyncing) {
    return;
  }

  await patchSyncState({
    isSyncing: false,
    syncTabId: null,
    autoManaged: false,
    lastError: "Recovered stale sync session after extension wake."
  });
}

async function reconcileSyncStateIfStale(syncState) {
  const current = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
  if (!current.isSyncing) {
    return current;
  }

  const referenceRaw = current.lastHeartbeatAt || current.lastIngestAt || current.lastSyncAt;
  const referenceTs = referenceRaw ? new Date(referenceRaw).getTime() : Number.NaN;
  const staleByTime =
    Number.isNaN(referenceTs) || Date.now() - referenceTs > STALE_SYNC_MS;

  if (!staleByTime) {
    return current;
  }

  const recovered = {
    ...current,
    isSyncing: false,
    syncTabId: null,
    autoManaged: false,
    lastError: current.lastError || "Recovered stale sync state."
  };

  await chrome.storage.local.set({
    [STORAGE_KEYS.SYNC_STATE]: recovered
  });

  return recovered;
}

async function getStorageInfo() {
  const bytesInUse = await chrome.storage.local.getBytesInUse(null);
  const unlimited = hasUnlimitedStoragePermission();
  const thresholdBytes = Math.floor(DEFAULT_STORAGE_LIMIT_BYTES * STORAGE_NEAR_QUOTA_THRESHOLD);

  return {
    bytesInUse,
    unlimited,
    thresholdBytes,
    nearQuota: !unlimited && bytesInUse >= thresholdBytes
  };
}

function hasUnlimitedStoragePermission() {
  const manifest = chrome.runtime.getManifest();
  const permissions = manifest?.permissions || [];
  return permissions.includes("unlimitedStorage");
}

async function ingestTweets(tweets = [], sender) {
  if (!Array.isArray(tweets) || tweets.length === 0) {
    return { ok: true, data: { added: 0, updated: 0, total: await getBookmarkCount() } };
  }

  const { bookmarksById, syncState, appSettings } = await chrome.storage.local.get([
    STORAGE_KEYS.BOOKMARKS,
    STORAGE_KEYS.SYNC_STATE,
    STORAGE_KEYS.SETTINGS
  ]);
  const nextMap = { ...(bookmarksById || {}) };
  const currentSyncState = normalizeSyncState(syncState || DEFAULT_SYNC_STATE);
  const settings = normalizeSettings(appSettings || DEFAULT_SETTINGS);
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  const changedTweets = [];

  for (const rawTweet of tweets) {
    const tweet = normalizeTweet(rawTweet, sender?.tab?.url);
    if (!tweet?.tweet_id) {
      continue;
    }

    const existing = nextMap[tweet.tweet_id];
    if (existing) {
      const mergedTweet = {
        ...existing,
        ...tweet,
        captured_at: existing.captured_at || tweet.captured_at,
        last_seen_at: now
      };
      nextMap[tweet.tweet_id] = mergedTweet;
      changedTweets.push(mergedTweet);
      updated += 1;
    } else {
      const newTweet = {
        ...tweet,
        last_seen_at: now
      };
      nextMap[tweet.tweet_id] = newTweet;
      changedTweets.push(newTweet);
      added += 1;
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.BOOKMARKS]: nextMap
  });

  await patchSyncState({
    isSyncing: true,
    syncTabId: sender?.tab?.id || currentSyncState.syncTabId || null,
    autoManaged: Boolean(currentSyncState.autoManaged),
    lastIngestAt: now,
    lastHeartbeatAt: now,
    totalCaptured: Object.keys(nextMap).length,
    lastError: null
  });

  if (settings.embeddingSearchEnabled && changedTweets.length > 0) {
    void enqueueEmbeddingJob(async () => {
      await upsertEmbeddingsForTweets(changedTweets, settings);
    });
  }

  return {
    ok: true,
    data: {
      added,
      updated,
      total: Object.keys(nextMap).length
    }
  };
}

function normalizeTweet(tweet, sourceUrl = "") {
  const tweetUrl = typeof tweet.tweet_url === "string" ? tweet.tweet_url : "";
  const tweetId = tweet.tweet_id || extractTweetId(tweetUrl);
  if (!tweetId) {
    return null;
  }

  const authorHandle = tweet.author_handle || extractAuthorFromTweetUrl(tweetUrl) || "";
  const text = String(tweet.tweet_text || "").trim();
  const capturedAt = tweet.captured_at || new Date().toISOString();

  return {
    tweet_id: tweetId,
    tweet_url: tweetUrl,
    author_handle: authorHandle,
    author_name: String(tweet.author_name || "").trim(),
    tweet_text: text,
    created_at: tweet.created_at || null,
    captured_at: capturedAt,
    source_url: sourceUrl
  };
}

function extractTweetId(tweetUrl) {
  const match = tweetUrl.match(/\/status\/(\d+)/);
  return match?.[1] || null;
}

function extractAuthorFromTweetUrl(tweetUrl) {
  const match = tweetUrl.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status\/\d+/);
  return match?.[1] || null;
}

async function getBookmarkCount() {
  const { bookmarksById } = await chrome.storage.local.get(STORAGE_KEYS.BOOKMARKS);
  return Object.keys(bookmarksById || {}).length;
}

async function runChatQuery(query, queryOptions = {}) {
  const cleanedQuery = String(query || "").trim();
  if (!cleanedQuery) {
    return { ok: false, error: "Query is required." };
  }

  const { bookmarksById, appSettings } = await chrome.storage.local.get([
    STORAGE_KEYS.BOOKMARKS,
    STORAGE_KEYS.SETTINGS
  ]);

  const bookmarks = Object.values(bookmarksById || {});
  if (!bookmarks.length) {
    return {
      ok: false,
      error: "No indexed bookmarks yet. Run sync first on the bookmarks page."
    };
  }

  const settings = normalizeSettings(appSettings || DEFAULT_SETTINGS);
  const answerStyle = normalizeAnswerStyle(queryOptions?.answerStyle || settings.answerStyle);
  const maxCitations = normalizeMaxCitations(queryOptions?.maxCitations ?? settings.maxCitations);
  const ranking = await rankBookmarksForQuery(cleanedQuery, bookmarks, settings, maxCitations);
  const ranked = ranking.items;
  const citations = ranked.map((item, index) => ({
    id: item.tweet_id,
    rank: index + 1,
    url: item.tweet_url,
    snippet: item.tweet_text.slice(0, 220)
  }));

  const provider = settings.provider || "openrouter";
  const apiKey = getProviderApiKey(settings, provider);
  const model = getProviderChatModel(settings, provider);

  if (!apiKey) {
    return {
      ok: false,
      error: `Missing API key for "${provider}". Open Settings and add your API key.`
    };
  }

  const messages = buildProviderMessages(cleanedQuery, ranked, {
    answerStyle,
    maxCitations
  });
  try {
    const answer = await runChatCompletion({
      provider,
      apiKey,
      model,
      messages
    });

    return {
      ok: true,
      data: {
        mode: provider,
        retrieval: ranking.mode,
        answer,
        citations
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: `LLM request failed: ${error?.message || "unknown error"}. Check provider/model/API key in Settings.`
    };
  }
}

async function rankBookmarksForQuery(query, bookmarks, settings, limit) {
  if (!settings.embeddingSearchEnabled) {
    return {
      mode: "keyword",
      items: rankBookmarks(query, bookmarks, limit)
    };
  }

  try {
    const semantic = await rankBookmarksByEmbeddings(query, bookmarks, settings, limit);
    if (semantic.length > 0) {
      return { mode: "embedding", items: semantic };
    }
  } catch (error) {
    console.warn("Embedding retrieval failed, falling back to keyword ranking.", error);
  }

  return {
    mode: "keyword-fallback",
    items: rankBookmarks(query, bookmarks, limit)
  };
}

function getProviderApiKey(settings, provider) {
  if (provider === "openrouter") {
    return settings.openrouterApiKey || "";
  }
  if (provider === "openai") {
    return settings.openaiApiKey || "";
  }
  return "";
}

function getProviderChatModel(settings, provider) {
  if (provider === "openrouter") {
    return settings.openrouterChatModel || DEFAULT_SETTINGS.openrouterChatModel;
  }
  if (provider === "openai") {
    return settings.openaiChatModel || DEFAULT_SETTINGS.openaiChatModel;
  }
  return DEFAULT_SETTINGS.openrouterChatModel;
}

function getProviderEmbeddingModel(settings, provider) {
  if (provider === "openrouter") {
    return settings.openrouterEmbeddingModel || DEFAULT_SETTINGS.openrouterEmbeddingModel;
  }
  if (provider === "openai") {
    return settings.openaiEmbeddingModel || DEFAULT_SETTINGS.openaiEmbeddingModel;
  }
  return DEFAULT_SETTINGS.openrouterEmbeddingModel;
}

function enqueueEmbeddingJob(task) {
  embeddingQueue = embeddingQueue
    .then(task)
    .catch((error) => {
      console.warn("Embedding job failed.", error);
    });
  return embeddingQueue;
}

async function backfillEmbeddingsForAllBookmarks(settings) {
  const { bookmarksById } = await chrome.storage.local.get(STORAGE_KEYS.BOOKMARKS);
  const bookmarks = Object.values(bookmarksById || {});
  if (bookmarks.length === 0) {
    return;
  }
  await upsertEmbeddingsForTweets(bookmarks, settings);
}

async function upsertEmbeddingsForTweets(tweets, settings) {
  if (!Array.isArray(tweets) || tweets.length === 0 || !settings.embeddingSearchEnabled) {
    return;
  }

  const provider = settings.provider || "openrouter";
  const apiKey = getProviderApiKey(settings, provider);
  if (!apiKey) {
    return;
  }

  const model = getProviderEmbeddingModel(settings, provider);
  const { embeddingsByTweetId } = await chrome.storage.local.get(STORAGE_KEYS.EMBEDDINGS);
  const existing = { ...(embeddingsByTweetId || {}) };

  const candidates = tweets
    .filter((tweet) => Boolean(tweet?.tweet_id))
    .map((tweet) => {
      const input = buildEmbeddingInput(tweet);
      return {
        tweet,
        input,
        hash: hashText(input)
      };
    })
    .filter((entry) => entry.input.length > 0);

  const pending = candidates.filter((entry) => {
    const current = existing[entry.tweet.tweet_id];
    if (!current) {
      return true;
    }
    if (current.provider !== provider || current.model !== model) {
      return true;
    }
    return current.textHash !== entry.hash;
  });

  if (pending.length === 0) {
    return;
  }

  for (let index = 0; index < pending.length; index += EMBEDDING_BATCH_SIZE) {
    const batch = pending.slice(index, index + EMBEDDING_BATCH_SIZE);
    const vectors = await runEmbeddings({
      provider,
      apiKey,
      model,
      texts: batch.map((entry) => entry.input)
    });

    const now = new Date().toISOString();
    for (let vectorIndex = 0; vectorIndex < batch.length; vectorIndex += 1) {
      const item = batch[vectorIndex];
      const vector = vectors[vectorIndex];
      if (!Array.isArray(vector) || vector.length === 0) {
        continue;
      }

      existing[item.tweet.tweet_id] = {
        vector,
        provider,
        model,
        textHash: item.hash,
        updatedAt: now
      };
    }
  }

  await chrome.storage.local.set({
    [STORAGE_KEYS.EMBEDDINGS]: existing
  });
}

async function rankBookmarksByEmbeddings(query, bookmarks, settings, limit) {
  const provider = settings.provider || "openrouter";
  const apiKey = getProviderApiKey(settings, provider);
  if (!apiKey) {
    return [];
  }

  const model = getProviderEmbeddingModel(settings, provider);
  const { embeddingsByTweetId } = await chrome.storage.local.get(STORAGE_KEYS.EMBEDDINGS);
  const embeddingMap = embeddingsByTweetId || {};

  const candidates = [];
  for (const bookmark of bookmarks) {
    const embedding = embeddingMap[bookmark.tweet_id];
    if (!embedding?.vector || embedding.provider !== provider || embedding.model !== model) {
      continue;
    }
    candidates.push({
      bookmark,
      vector: embedding.vector
    });
  }

  if (candidates.length === 0) {
    return [];
  }

  const [queryVector] = await runEmbeddings({
    provider,
    apiKey,
    model,
    texts: [query]
  });

  if (!Array.isArray(queryVector) || queryVector.length === 0) {
    return [];
  }

  const scored = candidates
    .map((candidate) => ({
      ...candidate.bookmark,
      score: cosineSimilarity(queryVector, candidate.vector)
    }))
    .filter((item) => Number.isFinite(item.score))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return new Date(b.captured_at || 0).getTime() - new Date(a.captured_at || 0).getTime();
    });

  return scored.slice(0, limit);
}

function buildEmbeddingInput(tweet) {
  const author = String(tweet.author_handle || "").trim();
  const text = String(tweet.tweet_text || "").trim();
  const joined = [author ? `@${author}` : "", text].filter(Boolean).join("\n");
  return joined.slice(0, EMBEDDING_INPUT_MAX_CHARS);
}

function hashText(input) {
  let hash = 0;
  const text = String(input || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return String(hash);
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return Number.NaN;
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const va = Number(a[index]);
    const vb = Number(b[index]);
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (!Number.isFinite(denominator) || denominator === 0) {
    return Number.NaN;
  }
  return dot / denominator;
}

function buildProviderMessages(query, ranked, options) {
  const context = ranked
    .map(
      (item, index) =>
        `[${index + 1}] ${item.tweet_url}\nAuthor: @${item.author_handle || "unknown"}\nText: ${
          item.tweet_text
        }`
    )
    .join("\n\n");

  return [
    {
      role: "system",
      content: buildSystemInstruction(options)
    },
    {
      role: "user",
      content: `Question: ${query}\n\nBookmark context:\n${context}`
    }
  ];
}

function buildSystemInstruction(options = {}) {
  const answerStyle = normalizeAnswerStyle(options.answerStyle);
  const maxCitations = normalizeMaxCitations(options.maxCitations);

  if (answerStyle === "brief") {
    return `You are BookmarkBrain. Answer only from provided bookmark context. Keep response short: 1 short summary paragraph + up to 3 bullets. Cite claims with [1], [2], etc and use at most ${maxCitations} citations.`;
  }

  if (answerStyle === "deep-dive") {
    return `You are BookmarkBrain. Answer only from provided bookmark context. Provide a thorough response with sections: Summary, Key Insights, Actionable Steps. Cite claims with [1], [2], etc and use at most ${maxCitations} citations.`;
  }

  return `You are BookmarkBrain. Answer only from provided bookmark context. Start with a short summary (2-4 sentences), then concise bullet takeaways. Cite claims with [1], [2], etc and use at most ${maxCitations} citations.`;
}

function rankBookmarks(query, bookmarks, limit = 5) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length > 2);

  const scored = bookmarks.map((bookmark) => {
    const haystack = `${bookmark.tweet_text || ""} ${bookmark.author_handle || ""}`.toLowerCase();
    const score = terms.reduce((total, term) => {
      if (!haystack.includes(term)) {
        return total;
      }

      const termMatches = haystack.split(term).length - 1;
      return total + Math.max(1, termMatches);
    }, 0);

    return { ...bookmark, score };
  });

  return scored
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return new Date(b.captured_at || 0).getTime() - new Date(a.captured_at || 0).getTime();
    })
    .slice(0, limit);
}
