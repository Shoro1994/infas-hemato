"use client";

// Drop-in replacement for the `window.storage` API the app was originally
// written against (Claude artifact persistent storage). Same method shapes:
//   get(key, shared?)    -> { key, value, shared } | null
//   set(key, value, shared?) -> { key, value, shared } | null
//   delete(key, shared?) -> { key, deleted, shared } | null
//   list(prefix?, shared?) -> { keys, prefix?, shared } | null
//
// shared=false (default): stored in the browser's own localStorage — each
// student's device keeps its own exam history and question rotation.
// shared=true: stored server-side via /api/kv (Vercel KV in production),
// visible to every visitor — used only for the admin candidate registry.

function lsGet(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : { key, value: raw, shared: false };
  } catch {
    return null;
  }
}
function lsSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
    return { key, value, shared: false };
  } catch {
    return null;
  }
}
function lsDelete(key) {
  try {
    window.localStorage.removeItem(key);
    return { key, deleted: true, shared: false };
  } catch {
    return null;
  }
}
function lsList(prefix = "") {
  try {
    const keys = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(prefix)) keys.push(k);
    }
    return { keys, prefix, shared: false };
  } catch {
    return { keys: [], prefix, shared: false };
  }
}

async function remoteGet(key) {
  try {
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return { key, value: data.value, shared: true };
  } catch {
    return null;
  }
}
async function remoteSet(key, value) {
  try {
    const res = await fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) return null;
    return { key, value, shared: true };
  } catch {
    return null;
  }
}
async function remoteDelete(key) {
  try {
    const res = await fetch(`/api/kv?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!res.ok) return null;
    return { key, deleted: true, shared: true };
  } catch {
    return null;
  }
}
async function remoteList(prefix = "") {
  try {
    const res = await fetch(`/api/kv?prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) return { keys: [], prefix, shared: true };
    const data = await res.json();
    return { keys: data.keys || [], prefix, shared: true };
  } catch {
    return { keys: [], prefix, shared: true };
  }
}

export const storage = {
  async get(key, shared = false) {
    return shared ? remoteGet(key) : lsGet(key);
  },
  async set(key, value, shared = false) {
    return shared ? remoteSet(key, value) : lsSet(key, value);
  },
  async delete(key, shared = false) {
    return shared ? remoteDelete(key) : lsDelete(key);
  },
  async list(prefix = "", shared = false) {
    return shared ? remoteList(prefix) : lsList(prefix);
  },
};
