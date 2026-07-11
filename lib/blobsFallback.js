// Fallback store used only when Netlify Blobs isn't reachable — e.g. running
// `next dev` directly instead of `netlify dev`, where there's no site
// context for Blobs to attach to. It lives in server memory, so it resets on
// every restart and does NOT persist correctly across multiple serverless
// instances. Once deployed on Netlify, Blobs works automatically with zero
// configuration and this fallback is bypassed entirely.

const store = globalThis.__infasMemoryStore || (globalThis.__infasMemoryStore = new Map());

export const memoryFallback = {
  async get(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async set(key, value) {
    store.set(key, value);
  },
  async delete(key) {
    store.delete(key);
  },
  async list(prefix) {
    return Array.from(store.keys()).filter((k) => k.startsWith(prefix));
  },
};
