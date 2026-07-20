import { NextResponse } from "next/server";
import { getStore } from "@netlify/blobs";
import { memoryFallback } from "../../../lib/blobsFallback";

// Cette route parle à Netlify Blobs pour toutes les données partagées
// (candidats, avis, annonces). Elle reste volontairement ouverte pour la
// lecture/écriture d'UNE fiche précise (student:{matricule}) — c'est ce qui
// permet à un étudiant de s'inscrire ou de se connecter sans passer par un
// compte admin. En revanche, deux catégories d'opérations sont désormais
// protégées par le jeton admin (ADMIN_TOKEN), car elles n'ont aucune raison
// d'être accessibles à un visiteur ordinaire :
//   1. Le LISTING (prefix=...) des fiches étudiants et des avis — sans ce
//      verrou, n'importe qui pouvait auparavant dresser la liste complète de
//      tous les comptes (et donc tous les mots de passe) en un seul appel.
//   2. La SUPPRESSION (DELETE), qui n'a jamais de cas d'usage public légitime.
const STORE_NAME = "infas-hemato-candidates";
function getBlobStore() {
  return getStore(STORE_NAME);
}

function isAuthorized(request) {
  const token = request.headers.get("x-admin-token");
  return !!token && token === process.env.ADMIN_TOKEN;
}

// Préfixes dont le LISTING complet est sensible et doit rester réservé à l'admin.
// "announcement:" reste public en lecture : les étudiants doivent voir les annonces.
function isSensitiveListPrefix(prefix) {
  return prefix.startsWith("student:") || prefix.startsWith("app-rating:");
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const prefix = searchParams.get("prefix");
  try {
    if (prefix !== null) {
      if (isSensitiveListPrefix(prefix) && !isAuthorized(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
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
    if (prefix !== null) {
      if (isSensitiveListPrefix(prefix) && !isAuthorized(request)) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
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
  // Aucun visiteur ordinaire n'a de raison légitime de supprimer une entrée :
  // toute suppression exige désormais le jeton admin.
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
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
