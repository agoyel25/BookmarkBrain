const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";

export async function chatWithOpenRouter({ apiKey, model, messages }) {
  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || response.statusText;
    throw new Error(`OpenRouter chat failed: ${detail}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter chat failed: empty response content.");
  }

  return content;
}

export async function embedWithOpenRouter({ apiKey, model, texts }) {
  const response = await fetch(OPENROUTER_EMBED_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: texts
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || payload?.message || response.statusText;
    throw new Error(`OpenRouter embeddings failed: ${detail}`);
  }

  const vectors = (payload?.data || []).map((entry) => entry.embedding).filter(Boolean);
  if (!vectors.length) {
    throw new Error("OpenRouter embeddings failed: empty vector response.");
  }

  return vectors;
}
