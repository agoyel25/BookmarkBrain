import { chatWithOpenAI, embedWithOpenAI } from "./openai.js";
import { chatWithGoogle, embedWithGoogle } from "./google.js";
import { chatWithOpenRouter, embedWithOpenRouter } from "./openrouter.js";

export async function runChatCompletion({ provider, apiKey, model, messages }) {
  if (!apiKey) {
    throw new Error(`Missing API key for provider "${provider}".`);
  }

  if (provider === "openrouter") {
    return chatWithOpenRouter({ apiKey, model, messages });
  }

  if (provider === "openai") {
    return chatWithOpenAI({ apiKey, model, messages });
  }

  if (provider === "google") {
    return chatWithGoogle({ apiKey, model, messages });
  }

  throw new Error(`Unsupported provider "${provider}".`);
}

export async function runEmbeddings({ provider, apiKey, model, texts, taskType }) {
  if (!apiKey) {
    throw new Error(`Missing API key for provider "${provider}".`);
  }

  if (provider === "openrouter") {
    return embedWithOpenRouter({ apiKey, model, texts });
  }

  if (provider === "openai") {
    return embedWithOpenAI({ apiKey, model, texts });
  }

  if (provider === "google") {
    return embedWithGoogle({ apiKey, model, texts, taskType });
  }

  throw new Error(`Unsupported provider "${provider}".`);
}
