# BookmarkBrain

**Chat with your X/Twitter bookmarks and Reddit saved posts using AI.**

Your saved content is a graveyard — no search, no recall, no value. BookmarkBrain turns it into a second brain you can actually talk to. Sync your saved items, ask natural-language questions, and get cited answers grounded in what you actually saved.

> Free, open source, privacy-first. Data is stored locally, and AI requests are sent directly to your selected provider using your API key.

---

## Features

- **Semantic search** — embeddings-powered retrieval finds conceptually relevant bookmarks even when exact words don't match
- **Cited answers** — every response includes numbered citations linked back to the original source
- **Auto-scroll sync** — automatically scrolls and indexes your saved-items pages hands-free
- **Triple AI provider** — works with [OpenRouter](https://openrouter.ai), direct OpenAI, or direct Google Gemini text models
- **Insight mode toggle** — optionally force every answer to include **Top 3 Opportunities** and **Top 3 Risks**
- **Export** — download any answer as Markdown or CSV
- **Saved prompts** — save your most-used queries as one-click chips
- **Privacy-first** — data is stored locally; AI requests go directly to your selected provider with your API key
- **BYOK** — bring your own API key, pay only for what you use

---

## Install

Install BookmarkBrain from the Chrome Web Store:

[BookmarkBrain on the Chrome Web Store](https://chromewebstore.google.com/detail/bookmarkbrain/akdanakbhljjkieodocegjhabdijmdjd)

### Developer Mode

1. Download or clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked**
5. Select this project folder (the one containing `manifest.json`)

---

## Quick Start

1. Open [x.com/i/bookmarks](https://x.com/i/bookmarks) or `https://www.reddit.com/user/<you>/saved` in Chrome
2. Click the **BookmarkBrain** extension icon — the side panel opens
3. Click **Start Sync** and scroll down your saved page (or enable auto-scroll in Settings)
4. Once indexed, type any question and click **Ask BookmarkBrain**

---

## Settings

Open the side panel and click **Settings**, or right-click the extension icon → Options.

| Setting | Description |
|---|---|
| Provider | `openrouter` (default, 400+ models), `openai` (direct), or `google` (Gemini text-only) |
| Auto-sync | Automatically start syncing when you open a supported saved-items tab |
| Auto-scroll | Scroll the active saved-items page automatically during sync |
| Semantic search | Use embedding-based retrieval (requires API key). Falls back to keyword search if disabled |
| Response style | Brief / Balanced / Deep-dive |
| Max citations | How many sources to include per answer (1–12, default: `12`) |
| Opportunities/Risks toggle | Optionally include **Top 3 Opportunities** and **Top 3 Risks** in every answer |

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

**Google Gemini (text only)**
1. Create an API key in Google AI Studio
2. Paste it in Settings → Google API Key
3. Default models: `gemini-3.1-flash-lite-preview` (chat) · `gemini-embedding-001` (embeddings)

---

## How It Works

```
Saved content page (X bookmarks or Reddit saved)
      │
      ▼
Content script scrapes saved post text + metadata as you scroll
      │
      ▼
Service worker stores saved items in chrome.storage.local
      │  (if semantic search enabled)
      ▼
Embedding API converts saved text → vectors, stored locally
      │
      ▼
Query → embed query → cosine similarity → top-K saved items
      │
      ▼
LLM generates answer with [1][2][3] citations → side panel
```

Bookmark data is stored locally in `chrome.storage.local`. When you use chat or semantic search, request data is sent directly from your browser to OpenRouter, OpenAI, or Google using your own key. BookmarkBrain does not run its own backend service.

See [PRIVACY.md](PRIVACY.md) for exact data flow and third-party processing details.

---

## Pricing

BookmarkBrain itself is free. You pay only for your own API usage:

| Operation | Model | Approx cost |
|---|---|---|
| Embed 1000 saved items (one-time) | `google/gemini-embedding-001` | ~$0.00 (free tier) |
| Embed 1000 saved items (one-time) | `openai/text-embedding-3-small` | ~$0.02 |
| Chat query | `openai/gpt-4o-mini` via OpenRouter | ~$0.001 per query |

---

## Limitations

- Chrome desktop only (Manifest V3 side panel API)
- Requires you to be logged in to X and/or Reddit in the same browser profile
- Scrapes visible DOM — if X or Reddit change their HTML structure, selectors may need updating
- `chrome.storage.local` stores all data locally; no cross-device sync

---

## Contributing

Pull requests are welcome. For significant changes, open an issue first to discuss the approach.

1. Fork the repo
2. Load the extension in developer mode
3. Make your changes
4. Test against a real X bookmarks page or Reddit saved page
5. Open a PR with a clear description

---

## Support

If BookmarkBrain is useful to you, you can support development here:

- [Buy Me a Coffee](https://buymeacoffee.com/amandev)

### Project Structure

```
BookmarkBrain/
├── manifest.json                  # MV3 manifest
├── background/
│   ├── service-worker.js          # Sync orchestration, RAG pipeline, storage
│   └── providers/
│       ├── index.js               # Provider adapter router
│       ├── openrouter.js          # OpenRouter chat + embeddings
│       └── openai.js              # OpenAI chat + embeddings
├── content/
│   └── bookmarks-scraper.js       # DOM scraper injected on supported saved pages
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
