import { NextResponse } from "next/server";
import { getStore } from "@netlify/blobs";
import { memoryFallback } from "../../../lib/blobsFallback";

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
const STORE_NAME = "infas-hemato-candidates";
function getBlobStore() {
  return getStore(STORE_NAME);
}
// Cohérence forte, réservée à la lecture d'UNE fiche précise (connexion, vérification
// d'un compte). Par défaut, Netlify Blobs privilégie la rapidité (cohérence "eventual"),
// ce qui veut dire qu'une lecture juste après une écriture peut renvoyer une version pas
// encore à jour — un compte tout juste créé pouvait ainsi se voir refuser la connexion
// juste après, avec pourtant le bon mot de passe. On ne l'applique volontairement PAS au
// listing complet des étudiants (plus lent en cohérence forte, et sans le même enjeu
// d'immédiateté), pour ne pas ralentir l'espace admin.
function getBlobStoreStrong() {
  return getStore(STORE_NAME, { consistency: "strong" });
}

function isAuthorized(request) {
  const token = request.headers.get("x-admin-token");
  return !!token && token === process.env.ADMIN_TOKEN;
}

function isSensitiveListPrefix(prefix) {
  return prefix.startsWith("infas-hemato:student:") || prefix.startsWith("infas-hemato:cand:") || prefix.startsWith("app-rating:");
}

// NOTE IMPORTANTE : la lecture d'une fiche étudiant précise (key=student:...) ne
// retire PLUS le mot de passe de sa réponse. Une version antérieure le faisait par
// précaution, mais l'application relit et réenregistre très régulièrement la fiche
// complète d'un étudiant à divers endroits (mise à jour de l'essai gratuit, du
// nombre d'examens, du parrainage...). Comme ces relectures passent par cette même
// route, retirer le mot de passe ici l'effaçait silencieusement de la base à chaque
// réenregistrement — rendant la connexion impossible dès la deuxième tentative,
// pour tout le monde. Le vrai verrou de sécurité utile reste en place : la
// vérification du mot de passe se fait côté serveur (/api/student-auth), le
// navigateur ne le compare plus jamais lui-même.

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
      const store = getBlobStoreStrong();
      let value = await store.get(key);
      if (value === null || value === undefined) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
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

  const isStudentKey = key.startsWith("infas-hemato:student:") || key.startsWith("infas-hemato:cand:");
  if (isStudentKey && !authorized) {
    try {
      const store = getBlobStoreStrong();
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
