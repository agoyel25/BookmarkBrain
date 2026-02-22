const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";

export async function chatWithOpenAI({ apiKey, model, messages }) {
  const response = await fetch(OPENAI_CHAT_URL, {
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
    throw new Error(`OpenAI chat failed: ${detail}`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI chat failed: empty response content.");
  }

  return content;
}

export async function embedWithOpenAI({ apiKey, model, texts }) {
  const response = await fetch(OPENAI_EMBED_URL, {
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
    throw new Error(`OpenAI embeddings failed: ${detail}`);
  }

  const vectors = (payload?.data || []).map((entry) => entry.embedding).filter(Boolean);
  if (!vectors.length) {
    throw new Error("OpenAI embeddings failed: empty vector response.");
  }

  return vectors;
}
