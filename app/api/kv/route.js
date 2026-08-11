import { NextResponse } from "next/server";
import { getStore } from "@netlify/blobs";
import { memoryFallback } from "../../../lib/blobsFallback";

// Cette route parle à Netlify Blobs pour toutes les données partagées
// (candidats, avis, annonces). Plusieurs protections y sont appliquées :
//   1. Le LISTING (prefix=...) des fiches étudiants et des avis exige le
//      jeton admin — sinon n'importe qui pouvait dresser la liste complète
//      de tous les comptes en un seul appel.
//   2. La LECTURE d'une fiche étudiant précise (key=student:...) ne renvoie
//      JAMAIS le mot de passe (anneeNaissance) sans jeton admin. La vraie
//      vérification du mot de passe se fait désormais côté serveur, dans
//      /api/student-auth — cette route ne sert plus qu'à vérifier qu'un
//      matricule existe (utile à l'inscription), jamais à en lire le secret.
//   3. L'ÉCRITURE (POST) ignore silencieusement toute tentative de modifier
//      des champs financiers/privilèges (isVIP, paymentStatus...) sans
//      jeton admin, et refuse totalement l'écriture sur certains préfixes
//      sensibles (soldes de parrainage, messages admin, annonces).
//   4. La SUPPRESSION (DELETE) exige toujours le jeton admin.
const STORE_NAME = "infas-hemato-candidates";
function getBlobStore() {
  return getStore(STORE_NAME);
}

function isAuthorized(request) {
  const token = request.headers.get("x-admin-token");
  return !!token && token === process.env.ADMIN_TOKEN;
}

function isSensitiveListPrefix(prefix) {
  return prefix.startsWith("student:") || prefix.startsWith("app-rating:");
}

// Le mot de passe d'une fiche étudiant ne doit jamais transiter par une
// lecture non authentifiée : on le retire avant de renvoyer la réponse.
function stripSecretFields(jsonString) {
  try {
    const obj = JSON.parse(jsonString);
    if (obj && typeof obj === "object" && "anneeNaissance" in obj) {
      const { anneeNaissance, ...rest } = obj;
      return JSON.stringify(rest);
    }
    return jsonString;
  } catch {
    return jsonString;
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const prefix = searchParams.get("prefix");
  const authorized = isAuthorized(request);
  try {
    if (prefix !== null) {
      if (isSensitiveListPrefix(prefix) && !authorized) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const store = getBlobStore();
      const { blobs } = await store.list({ prefix });
      return NextResponse.json({ keys: blobs.map((b) => b.key) });
    }
    if (key) {
      const store = getBlobStore();
      let value = await store.get(key);
      if (value === null || value === undefined) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (key.startsWith("student:") && !authorized) {
        value = stripSecretFields(value);
      }
      return NextResponse.json({ key, value });
    }
    return NextResponse.json({ error: "missing key or prefix" }, { status: 400 });
  } catch {
    if (prefix !== null) {
      if (isSensitiveListPrefix(prefix) && !authorized) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }
      const keys = await memoryFallback.list(prefix);
      return NextResponse.json({ keys });
    }
    let value = await memoryFallback.get(key);
    if (value === null) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (key && key.startsWith("student:") && !authorized) {
      value = stripSecretFields(value);
    }
    return NextResponse.json({ key, value });
  }
}

const PROTECTED_STUDENT_FIELDS = ["isVIP", "paymentStatus", "paidAt", "paidDays", "parrainRecompense"];

function isAdminOnlyWritePrefix(key) {
  return key.startsWith("referral-balance:") || key === "infas-hemato:admin-messages" || key === "infas-hemato:announcements";
}

export async function POST(request) {
  const body = await request.json();
  let { key, value } = body || {};
  if (!key) return NextResponse.json({ error: "missing key" }, { status: 400 });

  const authorized = isAuthorized(request);

  if (isAdminOnlyWritePrefix(key) && !authorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (key.startsWith("student:") && !authorized) {
    try {
      const store = getBlobStore();
      const existingRaw = await store.get(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : null;
      const incoming = JSON.parse(value);
      for (const field of PROTECTED_STUDENT_FIELDS) {
        incoming[field] = existing ? existing[field] : (field === "isVIP" ? false : field === "paymentStatus" ? "trial" : null);
      }
      value = JSON.stringify(incoming);
    } catch {
      // Fiche pas exploitable en JSON : on laisse passer tel quel, le pire
      // cas est un refus plus tard par la logique métier, jamais un octroi
      // de privilège.
    }
  }

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
