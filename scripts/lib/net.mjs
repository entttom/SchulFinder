export const USER_AGENT = 'SchulFinder-Importer (+https://github.com/entttom/SchulFinder)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** fetch mit User-Agent, Timeout und Wiederholung bei Fehlern. */
export async function request(url, init = {}, { retries = 3, timeoutMs = 90000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': USER_AGENT, ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
      return res;
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`${url}: ${lastError?.message ?? lastError}`);
}

export const getJson = async (url, opts) => (await request(url, {}, opts)).json();

export const postJson = async (url, body, opts) =>
  (await request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, opts)).json();

/** Führt fn für alle Items aus: begrenzte Parallelität, Mindestabstand zwischen Starts. */
export async function throttled(items, fn, { concurrency = 4, gapMs = 40, shouldStop = () => false } = {}) {
  let next = 0;
  let lastStart = 0;
  const worker = async () => {
    while (next < items.length && !shouldStop()) {
      const i = next++;
      const wait = lastStart + gapMs - Date.now();
      lastStart = Math.max(Date.now(), lastStart + gapMs);
      if (wait > 0) await sleep(wait);
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}
