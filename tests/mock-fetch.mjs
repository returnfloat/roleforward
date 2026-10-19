// Test-only preload: replaces fetch with the synthetic responses in feed-responses.mjs, so the scout runs offline and
// nothing reaches a real site. The feed tests start a tool with `node --import <this file>`; nothing in the plugin loads it.
//   ROLEFORWARD_TEST_SCENARIO   comma-separated scenario names for feed-responses.mjs (for example "workday-down")
//   ROLEFORWARD_TEST_LOG        a file that gets one JSON line per request ({ url, method, ua, body }) and per wait ({ wait })
// Waits (retry backoff, paging pauses) are logged and shortened to a few milliseconds, so retries stay fast.

import { appendFileSync } from 'node:fs';
import { respond } from './feed-responses.mjs';

const LOG = process.env.ROLEFORWARD_TEST_LOG;
const log = (entry) => { if (LOG) appendFileSync(LOG, JSON.stringify(entry) + '\n'); };
const scenarios = new Set((process.env.ROLEFORWARD_TEST_SCENARIO || '').split(',').filter(Boolean));

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  log({ url, method: init.method ?? 'GET', ua: headers['user-agent'] ?? '', body: init.body ?? '' });
  const r = respond(url, { ...init, headers }, scenarios) ?? { status: 404, text: 'not found' };
  const status = r.status ?? 200;
  const text = r.text ?? JSON.stringify(r.json);
  const head = Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return { ok: status >= 200 && status < 300, status, redirected: !!r.redirect, url: r.redirect ?? url, headers: { get: (k) => head[k.toLowerCase()] ?? null },
    text: async () => text, json: async () => JSON.parse(text) };
};

const realSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms = 0, ...args) => { if (ms) log({ wait: ms }); return realSetTimeout(fn, Math.min(ms, 5), ...args); };
