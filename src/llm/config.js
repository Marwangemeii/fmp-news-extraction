/**
 * Every LLM setting in one place (D34). Changing a model or the prompt version here
 * changes the LLM cache key, so cached answers from another setting are never reused.
 */

/** Bump when a prompt or a schema changes in a way that should invalidate cached answers. */
export const PROMPT_VERSION = 'v2'; // v2: K11 opening rule, body-only evidence, source kind in the classify message

/**
 * Both stages on Haiku 5.5: Marwan's API credit is $10 and a full run on Sonnet would cost ~$80.
 * The env overrides exist so `npm run eval` can compare models on the fixtures.
 */
export const MODELS = {
  classify: process.env.LLM_CLASSIFY_MODEL || 'claude-haiku-5-5',
  extract: process.env.LLM_EXTRACT_MODEL || 'claude-haiku-5-5',
};

/** How much the model thinks. Classification is easy; extraction has GAAP/adjusted subtlety. */
export const EFFORT = { classify: 'low', extract: 'medium' };

/** Thinking counts toward max_tokens, so these leave room for it on top of the JSON. */
export const MAX_TOKENS = { classify: 4000, extract: 8000 }; // classify hit 2000 once (eval fixture 11)

/** Classify sees only the top of the body: the label rule is about the subject, which lives there. */
export const CLASSIFY_BODY_CHARS = 6000;

/**
 * Articles being labelled at once, across ALL publishers (D51): one shared limiter in the controller.
 * Each article's calls run one after another, so this is also the max number of LLM calls in flight.
 */
export const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY) || 4;

/** USD per million tokens (input / output), from the Claude API pricing table (2026-11). */
export const PRICES = {
  'claude-haiku-5-5': { input: 0.1, output: 0.5 }, // prompts ≤ 100K tokens; ours are far below
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-opus-5-5': { input: 4, output: 20 },
};

// A model without a price would report $0 and slip past the budget cap: fail at startup instead.
for (const model of Object.values(MODELS)) {
  if (!PRICES[model]) throw new Error(`No price for model "${model}" in src/llm/config.js PRICES`);
}

/** Optional spend cap for one run, in USD (unset = no cap). Checked before every LLM call. */
export const BUDGET_USD = process.env.LLM_BUDGET_USD ? Number(process.env.LLM_BUDGET_USD) : null;

/**
 * @param {string} model
 * @param {{ inputTokens: number, outputTokens: number }} usage
 */
export function costUsd(model, { inputTokens, outputTokens }) {
  const p = PRICES[model];
  return (inputTokens * p.input + outputTokens * p.output) / 1e6;
}
