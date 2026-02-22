# BookmarkBrain - Product + Technical Spec

Date: 2026-02-22  
Owner: You  
Status: Draft v1 (MVP-focused)
Product Name: BookmarkBrain

## 1. Goal

Build a browser extension that:

1. Reads the user's own bookmarks from X (Twitter) while the user is logged in.
2. Indexes bookmark content for search and retrieval.
3. Provides a chat interface where the user can ask questions about bookmarked tweets.
4. Answers with grounded responses using retrieved bookmarks (RAG), not pure hallucinated chat.
5. Supports both OpenRouter and direct OpenAI API provider modes.

## 2. Scope

### In Scope (MVP)

1. Chrome extension (Manifest V3), desktop only.
2. Read bookmarks from `https://x.com/i/bookmarks` using content scripts.
3. Capture tweet text + metadata from visible timeline items.
4. Incremental sync as user scrolls.
5. Local or server-backed indexing for semantic retrieval.
6. Chat UI in extension side panel or popup.
7. LLM answers with citation links back to tweet URLs.
8. Dual provider support: OpenRouter (default) and direct OpenAI.

### Out of Scope (MVP)

1. Multi-account management.
2. Mobile browser support.
3. Team/shared bookmark workspaces.
4. Publishing to Chrome Web Store.
5. Full media OCR/transcription pipeline.

## 3. Constraints and Assumptions

1. User is authenticated to X in the same browser profile as the extension.
2. No guaranteed official API for full bookmark export is assumed.
3. DOM structure may change; scraper must be resilient and monitored.
4. Product is for personal use and must respect platform terms and privacy law.

## 4. User Stories

1. As a user, I can open X bookmarks and click "Sync bookmarks" to index what I have scrolled through.
2. As a user, I can ask: "What were the threads I saved about AI agents?" and get cited answers.
3. As a user, I can open cited tweet links from chat results.
4. As a user, I can delete my indexed data from extension settings.

## 5. Functional Requirements

### 5.1 Bookmark Collection

1. Extension detects when tab URL matches `https://x.com/i/bookmarks*`.
2. Content script extracts tweet cards from timeline DOM.
3. For each tweet, collect:
   - `tweet_id`
   - `author_handle`
   - `author_name` (if available)
   - `tweet_text`
   - `tweet_url`
   - `created_at` (if present)
   - `captured_at`
4. Deduplicate by `tweet_id`.
5. Support incremental collection as new items appear during scroll.

### 5.2 Indexing and Retrieval

1. Chunk/normalize tweet text.
2. Generate embeddings for each tweet text (or chunk).
3. Store vectors + metadata in index.
4. On chat query, embed query and retrieve top-K relevant bookmarks.
5. Pass retrieved context to LLM prompt.

### 5.3 Chat Experience

1. User enters natural-language query.
2. System returns answer plus cited source list (tweet URLs + snippets).
3. Show loading, error, and empty-result states.
4. Keep short chat history per session.

### 5.4 Settings

1. Select provider: `openrouter` or `openai`.
2. Configure provider-specific API keys.
3. Configure chat model and embedding model per provider.
4. "Clear all indexed data" action.
5. Optional toggle: local-only mode vs backend sync mode.

### 5.5 AI Provider Layer

1. Implement a provider adapter contract:
   - `chat(messages, options) -> response`
   - `embed(texts, options) -> vectors`
2. `openrouter` adapter:
   - Uses OpenRouter endpoint.
   - Accepts model IDs in `provider/model` format.
3. `openai` adapter:
   - Uses direct OpenAI API endpoint.
   - Uses OpenAI-native model IDs.
4. Extension RAG pipeline must call only the adapter contract, not provider-specific code.

## 6. Non-Functional Requirements

1. Performance:
   - Extract visible tweets within 150ms per batch on typical hardware.
   - Chat response target under 8s with network.
2. Reliability:
   - No duplicate indexing for same tweet ID.
   - Graceful fallback when selectors fail.
3. Privacy:
   - Collect only bookmark content needed for feature.
   - Encrypt API key at rest where feasible.
4. Security:
   - No broad host permissions beyond required domains.
   - Sanitize rendered markdown/text in chat.

## 7. Proposed Architecture

1. `content script`:
   - Runs on X bookmarks page.
   - Extracts and streams tweet payloads.
2. `background service worker`:
   - Orchestrates sync lifecycle.
   - Writes to storage/index.
   - Handles provider API calls through provider adapters.
3. `UI layer (side panel/popup)`:
   - Sync controls, chat, settings.
4. `storage`:
   - MVP option A: `chrome.storage.local` + lightweight local index.
   - MVP option B: backend DB + vector index for better scale.
5. `provider adapter layer`:
   - `openrouter` adapter (default).
   - `openai` adapter (fallback/optional).
6. `RAG pipeline`:
   - Query embedding -> retrieval -> LLM answer generation with citations.

## 8. Data Model (MVP)

### 8.1 bookmarks

1. `tweet_id` (pk)
2. `tweet_url` (unique)
3. `author_handle`
4. `author_name`
5. `tweet_text`
6. `created_at` (nullable)
7. `captured_at`
8. `last_seen_at`

### 8.2 embeddings

1. `id` (pk)
2. `tweet_id` (fk bookmarks.tweet_id)
3. `vector`
4. `model`
5. `embedded_at`

### 8.3 chat_sessions

1. `session_id` (pk)
2. `created_at`
3. `updated_at`

### 8.4 chat_messages

1. `id` (pk)
2. `session_id` (fk)
3. `role` (`user` | `assistant`)
4. `content`
5. `citations` (json)
6. `created_at`

### 8.5 app_settings

1. `provider` (`openrouter` | `openai`)
2. `openrouter_chat_model`
3. `openrouter_embedding_model`
4. `openai_chat_model`
5. `openai_embedding_model`
6. `updated_at`

## 9. Extension Permissions (Initial)

1. `storage`
2. `activeTab`
3. Host permissions:
   - `https://x.com/*`
   - `https://twitter.com/*` (optional compatibility)

Note: Request minimum permissions first, then expand only if needed.

## 10. Error Handling

1. Not logged in to X:
   - Show clear CTA: "Open x.com and sign in."
2. Selector/parsing break:
   - Log parser version + failed selector metric.
   - Show partial-sync warning.
3. LLM/embedding API failure:
   - Retry with capped backoff.
   - Show actionable error (invalid key, model not found, rate limit, network).
4. Empty index:
   - Prompt user to run sync on bookmarks page first.

## 11. Testing Strategy

1. Unit tests:
   - DOM parsing utilities using fixture HTML.
   - Dedupe logic and normalization.
   - Prompt assembly and citation formatting.
   - Provider adapter contract tests for `openrouter` and `openai`.
2. Integration tests:
   - Message passing: content <-> background <-> UI.
   - Sync pipeline end-to-end with mocked X page fixture.
   - Provider switching without restart (`openrouter` <-> `openai`).
3. Manual QA checklist:
   - Fresh install -> login -> sync -> chat -> citations open.
   - Large bookmark set (1000+ seen tweets).
   - Broken selector simulation.

## 12. Milestones

1. M1: Extension scaffold + permissions + bookmarks DOM extractor.
2. M2: Deduplicated storage + sync progress UI.
3. M3: Provider adapter layer (`openrouter` default + `openai` support).
4. M4: Embeddings + retrieval endpoint/index.
5. M5: Chat UI + RAG responses with citations.
6. M6: Hardening (error handling, tests, privacy controls).

## 13. Risks and Mitigations

1. X DOM changes frequently.
   - Mitigation: adapter-based selectors + regression fixtures.
2. Large bookmark volume impacts latency/cost.
   - Mitigation: batch embedding, caching, lazy re-embed.
3. Policy/compliance uncertainty.
   - Mitigation: personal-use framing, minimum data retention, clear consent.

## 14. MVP Success Criteria

1. User can index at least 500 bookmarked tweets without crashes.
2. At least 80% of test queries return relevant cited bookmarks in top-5.
3. Median chat response under 8s.
4. User can fully delete local indexed data from settings.

## 15. Open Decisions

1. Side panel vs popup as primary chat surface.
2. Local-only embeddings/index vs backend vector DB.
3. Default model set for each provider (quality vs cost presets).
