import { NextResponse } from "next/server";
import { getStore } from "@netlify/blobs";
import { memoryFallback } from "../../../lib/blobsFallback";

// This route only ever stores SHARED data (visible across every visitor):
// the candidate registry used by the admin statistics screen. Personal data
// (a student's own exam history, seen-questions rotation) stays in the
// browser's localStorage and never touches this endpoint — see lib/storage.js.
//
// On Netlify, Netlify Blobs works with zero configuration: no env vars, no
// separate account, nothing to attach — it's provisioned automatically for
// every site. Locally (plain `next dev`, no Netlify CLI/context) Blobs has
// nothing to attach to, so each call falls back to in-memory storage instead
// of failing the request.

const STORE_NAME = "infas-hemato-candidates";

function getBlobStore() {
  return getStore(STORE_NAME);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const prefix = searchParams.get("prefix");

  try {
    if (prefix !== null) {
      const store = getBlobStore();
      const { blobs } = await store.list({ prefix });
      return NextResponse.json({ keys: blobs.map((b) => b.key) });
    }
    if (key) {
      const store = getBlobStore();
      const value = await store.get(key);
      if (value === null || value === undefined) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      return NextResponse.json({ key, value });
    }
    return NextResponse.json({ error: "missing key or prefix" }, { status: 400 });
  } catch {
    // pas de contexte Netlify Blobs (dev local hors `netlify dev`) : repli mémoire
    if (prefix !== null) {
      const keys = await memoryFallback.list(prefix);
      return NextResponse.json({ keys });
    }
    const value = await memoryFallback.get(key);
    if (value === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ key, value });
  }
}

export async function POST(request) {
  const body = await request.json();
  const { key, value } = body || {};
  if (!key) return NextResponse.json({ error: "missing key" }, { status: 400 });

  try {
    const store = getBlobStore();
    await store.set(key, value);
    return NextResponse.json({ key, value });
  } catch {
    await memoryFallback.set(key, value);
    return NextResponse.json({ key, value });
  }
}

export async function DELETE(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return NextResponse.json({ error: "missing key" }, { status: 400 });

  try {
    const store = getBlobStore();
    await store.delete(key);
    return NextResponse.json({ key, deleted: true });
  } catch {
    await memoryFallback.delete(key);
    return NextResponse.json({ key, deleted: true });
  }
}
