if (window.__bookmarkBrainContentLoaded) {
  // Prevent duplicate listeners if script is injected again.
} else {
  window.__bookmarkBrainContentLoaded = true;

  (function bookmarkBrainContentScript() {
    const SCROLL_SPEEDS = {
      slow:   { interval: 2400, amount: 380 },
      normal: { interval: 1700, amount: 560 },
      fast:   { interval:  900, amount: 920 }
    };

    const state = {
      isSyncing: false,
      autoScrollEnabled: false,
      scrollSpeed: "normal",
      observer: null,
      scanInterval: null,
      routeInterval: null,
      heartbeatInterval: null,
      autoScrollInterval: null,
      lastScrollHeight: 0,
      stagnantTicks: 0,
      lastUrl: location.href,
      pendingTweets: [],
      seenTweetIds: new Set(),
      flushTimer: null
    };

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === "BOOKMARKBRAIN_SYNC_START") {
        startSync(message.options || {});
        sendResponse({ ok: true });
        return true;
      }

      if (message?.type === "BOOKMARKBRAIN_SYNC_STOP") {
        stopSync();
        sendResponse({ ok: true });
        return true;
      }

      sendResponse({ ok: false, error: "Unknown message type in content script." });
      return true;
    });

    window.addEventListener("beforeunload", () => {
      stopSync();
    });

    function isBookmarksPage() {
      return (
        location.pathname.startsWith("/i/bookmarks") &&
        (location.hostname === "x.com" || location.hostname === "twitter.com")
      );
    }

    function startSync(options = {}) {
      if (!isBookmarksPage()) {
        return;
      }

      const shouldAutoScroll = Boolean(options.autoScrollEnabled);
      state.autoScrollEnabled = shouldAutoScroll;
      state.scrollSpeed = options.scrollSpeed || "normal";

      if (state.isSyncing) {
        applyAutoScrollMode();
        return;
      }

      state.isSyncing = true;
      state.seenTweetIds.clear();
      collectFromPage();
      beginObserver();
      beginPeriodicScan();
      beginRouteWatcher();
      beginHeartbeat();
      applyAutoScrollMode();
    }

    function stopSync() {
      state.isSyncing = false;

      if (state.observer) {
        state.observer.disconnect();
        state.observer = null;
      }

      if (state.scanInterval) {
        clearInterval(state.scanInterval);
        state.scanInterval = null;
      }

      if (state.routeInterval) {
        clearInterval(state.routeInterval);
        state.routeInterval = null;
      }

      if (state.heartbeatInterval) {
        clearInterval(state.heartbeatInterval);
        state.heartbeatInterval = null;
      }

      stopAutoScroll();
      flushPendingTweets();
    }

    function applyAutoScrollMode() {
      if (state.autoScrollEnabled) {
        stopAutoScroll(); // restart so speed changes take effect immediately
        beginAutoScroll();
      } else {
        stopAutoScroll();
      }
    }

    function beginObserver() {
      if (state.observer) {
        return;
      }

      state.observer = new MutationObserver(() => {
        if (state.isSyncing && isBookmarksPage()) {
          collectFromPage();
        }
      });

      state.observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    }

    function beginPeriodicScan() {
      if (state.scanInterval) {
        return;
      }

      state.scanInterval = setInterval(() => {
        if (!state.isSyncing || !isBookmarksPage()) {
          return;
        }
        collectFromPage();
      }, 2000);
    }

    function beginRouteWatcher() {
      if (state.routeInterval) {
        return;
      }

      state.routeInterval = setInterval(() => {
        if (state.lastUrl === location.href) {
          return;
        }

        state.lastUrl = location.href;
        if (!state.isSyncing) {
          return;
        }

        if (!isBookmarksPage()) {
          stopSync();
          return;
        }

        collectFromPage();
      }, 600);
    }

    function beginHeartbeat() {
      if (state.heartbeatInterval) {
        return;
      }

      state.heartbeatInterval = setInterval(() => {
        if (!state.isSyncing || !isBookmarksPage()) {
          return;
        }

        void sendMessage({
          type: "BOOKMARKBRAIN_SYNC_HEARTBEAT"
        }).catch(() => {
          // Ignore transient heartbeat failures.
        });
      }, 12_000);
    }

    function beginAutoScroll() {
      if (state.autoScrollInterval) {
        return;
      }

      const preset = SCROLL_SPEEDS[state.scrollSpeed] || SCROLL_SPEEDS.normal;
      state.lastScrollHeight = getScrollElement().scrollHeight;
      state.stagnantTicks = 0;

      state.autoScrollInterval = setInterval(() => {
        if (!state.isSyncing || !isBookmarksPage()) {
          return;
        }

        const scroller = getScrollElement();
        const viewportHeight = scroller.clientHeight || window.innerHeight;
        const nearBottom = scroller.scrollTop + viewportHeight >= scroller.scrollHeight - 140;

        if (nearBottom) {
          if (scroller.scrollHeight === state.lastScrollHeight) {
            state.stagnantTicks += 1;
          } else {
            state.lastScrollHeight = scroller.scrollHeight;
            state.stagnantTicks = 0;
          }

          if (state.stagnantTicks >= 12) {
            stopAutoScroll();
            return;
          }
        } else {
          state.stagnantTicks = 0;
          state.lastScrollHeight = scroller.scrollHeight;
        }

        window.scrollBy({ top: preset.amount, left: 0, behavior: "smooth" });
      }, preset.interval);
    }

    function stopAutoScroll() {
      if (!state.autoScrollInterval) {
        return;
      }
      clearInterval(state.autoScrollInterval);
      state.autoScrollInterval = null;
      state.stagnantTicks = 0;
    }

    function getScrollElement() {
      return document.scrollingElement || document.documentElement;
    }

    function getCandidateArticles() {
      const primary = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
      if (primary.length > 0) {
        return primary;
      }

      const fallback = new Set();
      const anchors = document.querySelectorAll('a[href*="/status/"]');
      for (const anchor of anchors) {
        const article = anchor.closest("article");
        if (article) {
          fallback.add(article);
        }
      }

      return Array.from(fallback);
    }

    function collectFromPage() {
      const articles = getCandidateArticles();
      for (const article of articles) {
        const tweet = extractTweet(article);
        if (!tweet?.tweet_id || state.seenTweetIds.has(tweet.tweet_id)) {
          continue;
        }

        state.seenTweetIds.add(tweet.tweet_id);
        state.pendingTweets.push(tweet);
      }

      if (state.pendingTweets.length >= 20) {
        flushPendingTweets();
        return;
      }

      scheduleFlush();
    }

    function extractTweet(article) {
      const tweetUrl = findPrimaryStatusUrl(article);
      if (!tweetUrl) {
        return null;
      }

      const idMatch = tweetUrl.match(/\/status\/(\d+)/);
      if (!idMatch?.[1]) {
        return null;
      }

      const authorMatch = tweetUrl.match(/(?:x\.com|twitter\.com)\/([^/]+)\/status\/\d+/);
      const timeElement = article.querySelector("time");

      return {
        tweet_id: idMatch[1],
        tweet_url: tweetUrl,
        author_handle: authorMatch?.[1] || "",
        author_name: extractAuthorName(article),
        tweet_text: extractTweetText(article),
        created_at: timeElement?.getAttribute("datetime") || null,
        captured_at: new Date().toISOString()
      };
    }

    function findPrimaryStatusUrl(article) {
      const timeLink = article.querySelector("time")?.closest('a[href*="/status/"]');
      const byTime = normalizeStatusUrl(timeLink?.getAttribute("href") || "");
      if (byTime) {
        return byTime;
      }

      const anchors = Array.from(article.querySelectorAll('a[href*="/status/"]'));
      if (!anchors.length) {
        return null;
      }

      const ranked = anchors
        .map((anchor) => normalizeStatusUrl(anchor.getAttribute("href") || ""))
        .filter(Boolean)
        .map((url) => {
          const parsed = new URL(url);
          const isCanonical = /^\/[^/]+\/status\/\d+$/.test(parsed.pathname);
          return {
            url,
            score: isCanonical ? 2 : 1
          };
        })
        .sort((a, b) => b.score - a.score);

      return ranked[0]?.url || null;
    }

    function normalizeStatusUrl(rawUrl) {
      if (!rawUrl) {
        return null;
      }

      try {
        const absolute = new URL(rawUrl, location.origin);
        const statusMatch = absolute.pathname.match(/^\/[^/]+\/status\/\d+/);
        if (!statusMatch) {
          return null;
        }
        return `${absolute.origin}${statusMatch[0]}`;
      } catch (_error) {
        return null;
      }
    }

    function extractTweetText(article) {
      const explicit = article.querySelector('[data-testid="tweetText"]');
      if (explicit?.textContent?.trim()) {
        return explicit.textContent.trim();
      }

      const nodes = Array.from(article.querySelectorAll("div[lang]"));
      const unique = [];
      for (const node of nodes) {
        const text = node.textContent?.trim();
        if (!text || unique.includes(text)) {
          continue;
        }
        unique.push(text);
      }

      return unique.join("\n");
    }

    function extractAuthorName(article) {
      const userNameBlock = article.querySelector('div[data-testid="User-Name"]');
      if (!userNameBlock) {
        return "";
      }

      const candidates = Array.from(userNameBlock.querySelectorAll("span"))
        .map((node) => node.textContent?.trim() || "")
        .filter(Boolean);

      return candidates.find((entry) => !entry.startsWith("@") && entry !== "·") || "";
    }

    function scheduleFlush() {
      if (state.flushTimer) {
        return;
      }

      state.flushTimer = setTimeout(() => {
        state.flushTimer = null;
        flushPendingTweets();
      }, 900);
    }

    async function flushPendingTweets() {
      if (!state.pendingTweets.length) {
        return;
      }

      const batch = state.pendingTweets.splice(0, state.pendingTweets.length);
      try {
        const response = await sendMessage({
          type: "BOOKMARKBRAIN_INGEST_TWEETS",
          tweets: batch
        });

        if (!response?.ok) {
          throw new Error(response?.error || "Ingestion failed");
        }
      } catch (_error) {
        state.pendingTweets = [...batch, ...state.pendingTweets].slice(0, 1000);
        scheduleFlush();
      }
    }

    function sendMessage(message) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });
    }
  })();
}
