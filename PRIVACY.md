# BookmarkBrain Privacy and Data Flow

This document explains what data BookmarkBrain stores, when data is sent to third parties, and how to delete it.

## Summary

- BookmarkBrain has no project-owned backend server.
- Your extension data is stored locally in Chrome (`chrome.storage.local`).
- If you enable AI features, relevant request data is sent directly to your selected provider (`OpenRouter` or `OpenAI`) using your API key.

## Data Stored Locally

BookmarkBrain stores the following in local extension storage:

- App settings:
  - provider selection
  - model IDs
  - feature toggles (auto-sync, semantic search, etc.)
  - saved prompts
  - API keys for OpenRouter/OpenAI (if provided)
- Synced bookmark records:
  - tweet ID and URL
  - author handle/name (if available)
  - tweet text
  - timestamps (`created_at`, `captured_at`, `last_seen_at`)
- Embeddings (when semantic search is enabled):
  - vector data per tweet
  - provider/model metadata
  - text hash and update timestamp
- Sync state metadata:
  - whether sync is active
  - last sync/ingest times
  - sync errors

## When Data Leaves Your Browser

Data is transmitted only when required for AI features.

### Chat requests

When you ask a question:

- your query
- selected bookmark context snippets (used for retrieval-augmented generation)
- selected model/provider information

are sent to the chosen provider endpoint:

- OpenRouter: `https://openrouter.ai/api/v1/chat/completions`
- OpenAI: `https://api.openai.com/v1/chat/completions`

### Embedding requests

When semantic search is enabled:

- bookmark text (for indexing/backfill)
- query text (for semantic retrieval)

are sent to the chosen provider endpoint:

- OpenRouter: `https://openrouter.ai/api/v1/embeddings`
- OpenAI: `https://api.openai.com/v1/embeddings`

### Model list lookup

The settings page fetches available models from:

- `https://openrouter.ai/api/v1/models`

This request does not send bookmark text.

## Third-Party Processing

If you use OpenRouter or OpenAI, request data sent to those services is processed under their terms and privacy policies. Review provider documentation for retention, logging, and training policies before use.

BookmarkBrain does not control provider-side retention or processing once data is sent to those APIs.

## Data Deletion

You can remove data from inside the extension:

- **Clear Data**: deletes synced bookmarks, embeddings, and sync state.
- **Clear OpenRouter Key / Clear OpenAI Key**: deletes stored provider keys.

You can also uninstall the extension to remove extension-managed local storage.

## Security Notes

- API keys are stored in `chrome.storage.local` so the extension can call provider APIs.
- BookmarkBrain does not add a separate encryption layer for keys at rest.

