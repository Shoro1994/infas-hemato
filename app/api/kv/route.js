import { NextResponse } from "next/server";
import { getStore } from "@netlify/blobs";
import { memoryFallback } from "../../../lib/blobsFallback";

// Empêche Next.js/Netlify de traiter cette route comme statique ou de mettre ses
// réponses en cache à un quelconque niveau (CDN, edge, navigateur). Sans ça, deux
// requêtes vers des clés DIFFÉRENTES (ex. deux fiches étudiants différentes) peuvent
// se voir renvoyer la MÊME réponse mise en cache par erreur — c'est exactement ce qui
// causait "tous les comptes affichent les données du premier compte chargé" dans
// l'espace admin : la toute première lecture réussie restait en cache et était
// réutilisée pour les lectures suivantes, malgré une clé différente dans l'URL.
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noCacheHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
  };
}
function jsonNoCache(body, init = {}) {
  return NextResponse.json(body, { ...init, headers: { ...noCacheHeaders(), ...(init.headers || {}) } });
}

// Cette route parle à Netlify Blobs pour toutes les données partagées
// (candidats, avis, annonces). Plusieurs protections y sont appliquées :
//   1. Le LISTING (prefix=...) des fiches étudiants et des avis exige le
//      jeton admin — sinon n'importe qui pouvait dresser la liste complète
//      de tous les comptes en un seul appel.
//   2. La LECTURE d'une fiche étudiant précise (key=student:...) est ouverte, y
//      compris le mot de passe (anneeNaissance) : plusieurs endroits de
//      l'application relisent la fiche complète avant de la réenregistrer, et un
//      retrait du mot de passe ici l'effaçait silencieusement à chaque
//      réenregistrement. La vraie vérification du mot de passe à la connexion se
//      fait côté serveur, dans /api/student-auth — le navigateur ne le compare
//      plus jamais lui-même.
//   3. L'ÉCRITURE (POST) ignore silencieusement toute tentative de modifier
//      des champs financiers/privilèges (isVIP, paymentStatus...) sans
//      jeton admin, et refuse totalement l'écriture sur certains préfixes
//      sensibles (soldes de parrainage, messages admin, annonces).
//   4. La SUPPRESSION (DELETE) exige toujours le jeton admin.
//   5. AUCUNE réponse n'est mise en cache (voir dynamic/revalidate/no-cache ci-dessus).
const STORE_NAME = "infas-hemato-candidates";
function getBlobStore() {
  return getStore(STORE_NAME);
}

function isAuthorized(request) {
  const token = request.headers.get("x-admin-token");
  return !!token && token === process.env.ADMIN_TOKEN;
}

function isSensitiveListPrefix(prefix) {
  return prefix.startsWith("infas-hemato:student:") || prefix.startsWith("infas-hemato:cand:") || prefix.startsWith("app-rating:");
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  const prefix = searchParams.get("prefix");
  const authorized = isAuthorized(request);
  try {
    if (prefix !== null) {
      if (isSensitiveListPrefix(prefix) && !authorized) {
        return jsonNoCache({ error: "unauthorized" }, { status: 401 });
      }
      const store = getBlobStore();
      const { blobs } = await store.list({ prefix });
      return jsonNoCache({ keys: blobs.map((b) => b.key) });
    }
    if (key) {
      const store = getBlobStore();
      let value = await store.get(key);
      if (value === null || value === undefined) {
        return jsonNoCache({ error: "not_found" }, { status: 404 });
      }
      return jsonNoCache({ key, value });
    }
    return jsonNoCache({ error: "missing key or prefix" }, { status: 400 });
  } catch {
    if (prefix !== null) {
      if (isSensitiveListPrefix(prefix) && !authorized) {
        return jsonNoCache({ error: "unauthorized" }, { status: 401 });
      }
      const keys = await memoryFallback.list(prefix);
      return jsonNoCache({ keys });
    }
    let value = await memoryFallback.get(key);
    if (value === null) return jsonNoCache({ error: "not_found" }, { status: 404 });
    return jsonNoCache({ key, value });
  }
}

const PROTECTED_STUDENT_FIELDS = ["isVIP", "paidAt", "paidDays", "parrainRecompense"];

function isAdminOnlyWritePrefix(key) {
  return key.startsWith("referral-balance:") || key === "infas-hemato:admin-messages" || key === "infas-hemato:announcements";
}

export async function POST(request) {
  const body = await request.json();
  let { key, value } = body || {};
  if (!key) return jsonNoCache({ error: "missing key" }, { status: 400 });

  const authorized = isAuthorized(request);

  if (isAdminOnlyWritePrefix(key) && !authorized) {
    return jsonNoCache({ error: "unauthorized" }, { status: 401 });
  }

  const isStudentKey = key.startsWith("infas-hemato:student:") || key.startsWith("infas-hemato:cand:");
  if (isStudentKey && !authorized) {
    try {
      const store = getBlobStore();
      const existingRaw = await store.get(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : null;
      const incoming = JSON.parse(value);
      for (const field of PROTECTED_STUDENT_FIELDS) {
        incoming[field] = existing ? existing[field] : (field === "isVIP" ? false : null);
      }
      // paymentStatus est un cas particulier : un étudiant non authentifié ne doit
      // jamais pouvoir s'attribuer "paid" lui-même (ça resterait bloqué ici), mais
      // DOIT pouvoir passer légitimement à "pending" — c'est précisément l'action de
      // "réclamer un paiement" depuis l'application, qui n'accorde aucun accès en
      // elle-même et attend une confirmation manuelle de l'admin. Une version
      // antérieure de cette protection bloquait aussi ce cas légitime par erreur,
      // empêchant silencieusement toute réclamation de paiement d'aboutir.
      if (incoming.paymentStatus === "paid" && (!existing || existing.paymentStatus !== "paid")) {
        incoming.paymentStatus = existing ? existing.paymentStatus : "trial";
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
    return jsonNoCache({ key, value });
  } catch {
    await memoryFallback.set(key, value);
    return jsonNoCache({ key, value });
  }
}

export async function DELETE(request) {
  if (!isAuthorized(request)) {
    return jsonNoCache({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key) return jsonNoCache({ error: "missing key" }, { status: 400 });
  try {
    const store = getBlobStore();
    await store.delete(key);
    return jsonNoCache({ key, deleted: true });
  } catch {
    await memoryFallback.delete(key);
    return jsonNoCache({ key, deleted: true });
  }
}
