# BookmarkBrain

**Chat with your X/Twitter bookmarks using AI.**

Your Twitter bookmarks are a graveyard — no search, no recall, no value. BookmarkBrain turns them into a second brain you can actually talk to. Sync your bookmarks, ask natural-language questions, and get cited answers grounded in what you actually saved.

> Free, open source, privacy-first. Your bookmarks never leave your browser. Bring your own API key.

---

## Features

- **Semantic search** — embeddings-powered retrieval finds conceptually relevant bookmarks even when exact words don't match
- **Cited answers** — every response includes numbered citations linked back to the original tweet
- **Auto-scroll sync** — automatically scrolls and indexes your entire bookmarks page hands-free
- **Dual AI provider** — works with [OpenRouter](https://openrouter.ai) (400+ models) or direct OpenAI
- **Export** — download any answer as Markdown or CSV
- **Saved prompts** — save your most-used queries as one-click chips
- **Privacy-first** — all data stored locally in your browser, no server, no account
- **BYOK** — bring your own API key, pay only for what you use

---

## Install (Developer Mode)

1. Download or clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select the `twitter-extension` folder

---

## Quick Start

1. Open [x.com/i/bookmarks](https://x.com/i/bookmarks) in Chrome
2. Click the **BookmarkBrain** extension icon — the side panel opens
3. Click **Start Sync** and scroll down your bookmarks page (or enable auto-scroll in Settings)
4. Once indexed, type any question and click **Ask BookmarkBrain**

---

## Settings

Open the side panel and click **Settings**, or right-click the extension icon → Options.

| Setting | Description |
|---|---|
| Provider | `openrouter` (default, 400+ models) or `openai` (direct) |
| Auto-sync | Automatically start syncing when you open the bookmarks tab |
| Auto-scroll | Scroll the bookmarks page automatically during sync |
| Semantic search | Use embedding-based retrieval (requires API key). Falls back to keyword search if disabled |
| Response style | Brief / Balanced / Deep-dive |
| Max citations | How many source tweets to include per answer (1–12) |

### API Key Setup

**OpenRouter (recommended)**
1. Create a free account at [openrouter.ai](https://openrouter.ai)
2. Generate an API key
3. Paste it in Settings → OpenRouter API Key
4. Default models: `openai/gpt-4o-mini` (chat) · `google/gemini-embedding-001` (embeddings)

**OpenAI (direct)**
1. Get an API key from [platform.openai.com](https://platform.openai.com)
2. Paste it in Settings → OpenAI API Key
3. Default models: `gpt-4o-mini` (chat) · `text-embedding-3-small` (embeddings)

---

## How It Works

```
X Bookmarks page
      │
      ▼
Content script scrapes tweet text + metadata as you scroll
      │
      ▼
Service worker stores bookmarks in chrome.storage.local
      │  (if semantic search enabled)
      ▼
Embedding API converts tweet text → vectors, stored locally
      │
      ▼
Query → embed query → cosine similarity → top-K bookmarks
      │
      ▼
LLM generates answer with [1][2][3] citations → side panel
```

All storage is local (`chrome.storage.local`). API calls go directly from your browser to OpenRouter or OpenAI using your own key.

---

## Pricing

BookmarkBrain itself is free. You pay only for your own API usage:

| Operation | Model | Approx cost |
|---|---|---|
| Embed 1000 tweets (one-time) | `google/gemini-embedding-001` | ~$0.00 (free tier) |
| Embed 1000 tweets (one-time) | `openai/text-embedding-3-small` | ~$0.02 |
| Chat query | `openai/gpt-4o-mini` via OpenRouter | ~$0.001 per query |

---

## Limitations

- Chrome desktop only (Manifest V3 side panel API)
- Requires you to be logged in to X in the same browser profile
- Scrapes visible DOM — if X changes their HTML structure, selectors may need updating
- `chrome.storage.local` stores all data locally; no cross-device sync

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss the approach.

1. Fork the repo
2. Load the extension in developer mode
3. Make your changes
4. Test against a real X bookmarks page
5. Open a PR with a clear description

### Project Structure

```
twitter-extension/
├── manifest.json                  # MV3 manifest
├── background/
│   ├── service-worker.js          # Sync orchestration, RAG pipeline, storage
│   └── providers/
│       ├── index.js               # Provider adapter router
│       ├── openrouter.js          # OpenRouter chat + embeddings
│       └── openai.js              # OpenAI chat + embeddings
├── content/
│   └── bookmarks-scraper.js       # DOM scraper injected on x.com/i/bookmarks
├── sidepanel/
│   ├── sidepanel.html
│   ├── sidepanel.css
│   └── sidepanel.js               # Chat UI, sync controls, export
├── options/
│   ├── options.html
│   ├── options.css
│   └── options.js                 # Settings page, OpenRouter model browser
└── shared/
    └── settings.js                # Shared normalization utilities
```

---

## License

[MIT](LICENSE)
