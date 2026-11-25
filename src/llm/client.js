/**
 * One LLM call with a strict JSON reply (D35), an optional disk cache (D36) and a spend cap.
 * It never throws for an LLM problem: it returns `{ error: { kind, message } }`, so the labeller
 * can trace it and count it (D38). Kinds: 'error' (API/network after the SDK's retries),
 * 'refusal' (the model declined), 'truncated' (hit max_tokens), 'budget' (LLM_BUDGET_USD reached).
 */
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PROMPT_VERSION, BUDGET_USD, costUsd } from './config.js';

const CACHE_DIR = join('.cache', 'llm');
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

let client = null;

/** Fails fast with a clear message; never prints the key itself. */
export function assertApiKey() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key (the npm scripts load .env).');
  }
}

function getClient() {
  if (!client) {
    assertApiKey();
    // The SDK retries 408/409/429/5xx and network errors itself, with backoff.
    client = new Anthropic({ maxRetries: 4, timeout: 120_000 });
  }
  return client;
}

/**
 * @typedef {{ inputTokens: number, outputTokens: number }} Usage
 * @typedef {{ json?: object, usage: Usage, stopReason?: string, fromCache: boolean, contentHash: string,
 *             error?: { kind: 'error'|'refusal'|'truncated'|'budget', message: string } }} CallResult
 */

/**
 * @param {{ model: string, effort: string, maxTokens: number, system: string, user: string,
 *           schema: object, url: string, cache?: boolean, spend?: { usd: number } }} req
 *   `spend` is shared by every call of the run; it is what the budget cap checks.
 * @returns {Promise<CallResult>}
 */
export async function callJson({ model, effort, maxTokens, system, user, schema, url, cache = false, spend = { usd: 0 } }) {
  // Everything that shapes the answer goes into the hash, so any prompt/schema/setting change misses the cache.
  const contentHash = sha256([system, user, JSON.stringify(schema), effort, maxTokens].join('\n'));
  const key = sha256([model, PROMPT_VERSION, url, contentHash].join('|'));
  const file = join(CACHE_DIR, `${key}.json`);
  const noUsage = { inputTokens: 0, outputTokens: 0 };

  if (cache) {
    try {
      const hit = JSON.parse(await readFile(file, 'utf8'));
      return { json: hit.json, usage: noUsage, stopReason: hit.stopReason, fromCache: true, contentHash, cachedUsage: hit.usage };
    } catch {
      // not cached yet
    }
  }

  if (BUDGET_USD !== null && spend.usd >= BUDGET_USD) {
    return { usage: noUsage, fromCache: false, contentHash, error: { kind: 'budget', message: `LLM_BUDGET_USD ${BUDGET_USD} reached ($${spend.usd.toFixed(4)} spent)` } };
  }

  let res;
  try {
    res = await getClient().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort, format: { type: 'json_schema', schema } },
    });
  } catch (err) {
    // Already retried by the SDK. err.message carries the API's reason (e.g. credit balance too low).
    const status = err instanceof Anthropic.APIError && err.status ? `HTTP ${err.status}: ` : '';
    return { usage: noUsage, fromCache: false, contentHash, error: { kind: 'error', message: `${status}${err.message}` } };
  }

  const usage = { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  spend.usd += costUsd(model, usage);
  const base = { usage, stopReason: res.stop_reason, fromCache: false, contentHash };

  if (res.stop_reason === 'refusal') {
    return { ...base, error: { kind: 'refusal', message: `model declined (${res.stop_details?.category ?? 'no category'})` } };
  }
  if (res.stop_reason === 'max_tokens') {
    return { ...base, error: { kind: 'truncated', message: `hit max_tokens ${maxTokens} before finishing the JSON` } };
  }

  // Thinking blocks can come first: read the text block by type, never by position.
  const text = res.content.find((b) => b.type === 'text')?.text;
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return { ...base, error: { kind: 'error', message: `reply is not JSON: ${err.message}` } };
  }

  if (cache) {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(file, JSON.stringify({ model, promptVersion: PROMPT_VERSION, url, json, usage, stopReason: res.stop_reason }), 'utf8');
  }
  return { ...base, json };
}
