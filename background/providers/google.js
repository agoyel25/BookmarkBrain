const GOOGLE_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GOOGLE_SUPPORTED_TEXT_MODELS = new Set([
  "gemini-3-flash-preview",
  "gemini-3.1-flash-lite-preview",
  "gemini-3.1-pro-preview"
]);
const GOOGLE_EMBEDDING_MODEL = "gemini-embedding-001";

export async function chatWithGoogle({ apiKey, model, messages }) {
  const normalizedModel = normalizeGoogleTextModel(model);
  const payload = toGeminiGenerateContentPayload(messages);
  const response = await fetch(`${GOOGLE_API_BASE}/${normalizedModel}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || response.statusText;
    throw new Error(`Google chat failed: ${detail}`);
  }

  const parts = body?.candidates?.[0]?.content?.parts || [];
  const text = parts
    .map((part) => part?.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Google chat failed: empty response content.");
  }

  return text;
}

export async function embedWithGoogle({ apiKey, model, texts, taskType = "RETRIEVAL_DOCUMENT" }) {
  const normalizedModel = normalizeGoogleEmbeddingModel(model);
  const cleanTexts = Array.isArray(texts)
    ? texts.map((text) => String(text || "").trim()).filter(Boolean)
    : [];

  if (cleanTexts.length === 0) {
    return [];
  }

  if (cleanTexts.length === 1) {
    return [await embedSingleText({ apiKey, model: normalizedModel, text: cleanTexts[0], taskType })];
  }

  const response = await fetch(`${GOOGLE_API_BASE}/${normalizedModel}:batchEmbedContents`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      requests: cleanTexts.map((text) => ({
        model: normalizedModel,
        content: {
          parts: [{ text }]
        },
        taskType
      }))
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || response.statusText;
    throw new Error(`Google embeddings failed: ${detail}`);
  }

  const vectors = (body?.embeddings || []).map((entry) => entry?.values).filter(isValidVector);
  if (!vectors.length) {
    throw new Error("Google embeddings failed: empty vector response.");
  }

  return vectors;
}

async function embedSingleText({ apiKey, model, text, taskType }) {
  const response = await fetch(`${GOOGLE_API_BASE}/${model}:embedContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      content: {
        parts: [{ text }]
      },
      taskType
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = body?.error?.message || response.statusText;
    throw new Error(`Google embeddings failed: ${detail}`);
  }

  const vector = body?.embedding?.values;
  if (!isValidVector(vector)) {
    throw new Error("Google embeddings failed: empty vector response.");
  }

  return vector;
}

function toGeminiGenerateContentPayload(messages) {
  const contents = [];
  const systemChunks = [];

  for (const message of messages || []) {
    const content = String(message?.content || "").trim();
    if (!content) {
      continue;
    }

    if (message.role === "system") {
      systemChunks.push(content);
      continue;
    }

    contents.push({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: content }]
    });
  }

  return {
    ...(systemChunks.length > 0
      ? {
          systemInstruction: {
            parts: [{ text: systemChunks.join("\n\n") }]
          }
        }
      : {}),
    contents
  };
}

function normalizeGoogleTextModel(model) {
  const clean = stripModelPrefix(model);
  if (!GOOGLE_SUPPORTED_TEXT_MODELS.has(clean)) {
    throw new Error(`Unsupported Google text model "${model}".`);
  }
  return `models/${clean}`;
}

function normalizeGoogleEmbeddingModel(model) {
  const clean = stripModelPrefix(model);
  if (clean !== GOOGLE_EMBEDDING_MODEL) {
    throw new Error(`Unsupported Google embedding model "${model}".`);
  }
  return `models/${clean}`;
}

function stripModelPrefix(model) {
  return String(model || "").trim().replace(/^models\//, "");
}

function isValidVector(vector) {
  return Array.isArray(vector) && vector.length > 0;
}
