export const DEFAULT_PROMPTS = [
  "Summarize actionable ideas from my bookmarks.",
  "Find monetization tactics from my bookmarks.",
  "What did I bookmark about AI agents?"
];

export const DEFAULT_ANSWER_STYLE = "balanced";
export const DEFAULT_MAX_CITATIONS = 5;
export const MAX_CITATIONS = 12;
export const MIN_CITATIONS = 1;
export const MAX_SAVED_PROMPTS = 12;

export function normalizeAnswerStyle(value, fallback = DEFAULT_ANSWER_STYLE) {
  if (value === "brief" || value === "balanced" || value === "deep-dive") {
    return value;
  }
  return fallback;
}

export function normalizeMaxCitations(
  value,
  {
    fallback = DEFAULT_MAX_CITATIONS,
    min = MIN_CITATIONS,
    max = MAX_CITATIONS
  } = {}
) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeSavedPrompts(
  value,
  {
    fallback = DEFAULT_PROMPTS,
    maxItems = MAX_SAVED_PROMPTS,
    allowEmpty = true
  } = {}
) {
  if (!Array.isArray(value)) {
    return [...fallback];
  }

  const cleaned = value
    .map((entry) => String(entry || "").trim())
    .filter(Boolean)
    .slice(0, maxItems);

  if (!allowEmpty && cleaned.length === 0) {
    return [...fallback];
  }

  return cleaned;
}
