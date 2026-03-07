# BookmarkBrain Privacy and Data Flow

This document explains what data BookmarkBrain stores, when data is sent to third parties, and how to delete it.

## Summary

- BookmarkBrain has no project-owned backend server.
- Your extension data is stored locally in Chrome (`chrome.storage.local`).
- If you enable AI features, relevant request data is sent directly to your selected provider (OpenRouter, OpenAI, or Google Gemini) using your API key.
- BookmarkBrain does not collect, transmit, or sell any user data to third parties beyond the AI provider you explicitly configure.

## Permissions and Why They Are Used

| Permission | Reason |
|---|---|
| `activeTab` | Detect when the user is on a supported page (X/Twitter bookmarks or Reddit saved posts) to activate the side panel and initiate syncing on the correct tab. |
| Host permissions (`x.com`, `reddit.com`, API endpoints) | Scrape the user's own saved posts on X/Twitter and Reddit, and send AI requests directly to the user's chosen provider using their own API key. |
| `scripting` | Inject a content script into supported pages to scrape the user's own saved post text and metadata for local indexing. |
| `sidePanel` | Render the extension's chat and settings UI in Chrome's built-in side panel. |
| `storage` | Store indexed bookmarks, embeddings, settings, and saved prompts locally in `chrome.storage.local`. |
| `unlimitedStorage` | Users may accumulate thousands of bookmarks and embedding vectors. This prevents hitting Chrome's default quota as the local index grows. |

> **Remote code:** BookmarkBrain does not execute remote code. All extension logic runs locally. Network requests are made only to AI provider APIs configured by the user.

## Data Stored Locally

BookmarkBrain stores the following in `chrome.storage.local`:

- App settings:
  - provider selection
  - model IDs
  - feature toggles (auto-sync, auto-scroll, semantic search, etc.)
  - saved prompts
  - API keys for OpenRouter, OpenAI, and/or Google Gemini (if provided)
- Synced bookmark/saved-post records:
  - post ID and URL
  - author handle/name (if available)
  - post text
  - timestamps (`created_at`, `captured_at`, `last_seen_at`)
  - source platform (X/Twitter or Reddit)
- Embeddings (when semantic search is enabled):
  - vector data per post
  - provider/model metadata
  - text hash and update timestamp
- Sync state metadata:
  - whether sync is active
  - last sync/ingest times
  - sync errors

## When Data Leaves Your Browser

Data is transmitted only when required for AI features. All requests go directly from your browser to your configured provider — there is no BookmarkBrain-owned server in the middle.

### Chat requests

When you ask a question, the following are sent to your chosen provider:

- your query
- selected bookmark context snippets (used for retrieval-augmented generation)
- selected model/provider information

Provider endpoints:

- OpenRouter: `https://openrouter.ai/api/v1/chat/completions`
- OpenAI: `https://api.openai.com/v1/chat/completions`
- Google Gemini: `https://generativelanguage.googleapis.com/`

### Embedding requests

When semantic search is enabled, the following are sent for indexing and retrieval:

- bookmark/saved-post text (for indexing)
- query text (for semantic retrieval)

Provider endpoints:

- OpenRouter: `https://openrouter.ai/api/v1/embeddings`
- OpenAI: `https://api.openai.com/v1/embeddings`
- Google Gemini: `https://generativelanguage.googleapis.com/`

### Model list lookup

The settings page fetches available models from:

- `https://openrouter.ai/api/v1/models`

This request does not include bookmark text or personal data.

## Third-Party Processing

If you use OpenRouter, OpenAI, or Google Gemini, request data sent to those services is processed under their respective terms and privacy policies. Review each provider's documentation for their retention, logging, and training policies before use.

BookmarkBrain does not control provider-side retention or processing once data is sent to those APIs.

## Data Deletion

You can remove data from inside the extension:

- **Clear Data**: deletes synced bookmarks, embeddings, and sync state.
- **Clear API Keys**: deletes stored provider keys for OpenRouter, OpenAI, and/or Google Gemini.

Uninstalling the extension will also remove all locally stored extension data.

## Security Notes

- API keys are stored in `chrome.storage.local` so the extension can call provider APIs on your behalf.
- BookmarkBrain does not add a separate encryption layer for keys at rest; they are protected by Chrome's extension storage sandbox.
- No bookmark data, API keys, or personal information is ever sent to any BookmarkBrain-owned server.
