import { NextResponse } from "next/server";
import crypto from "crypto";
import { getStore } from "@netlify/blobs";
import { memoryFallback } from "../../../lib/blobsFallback";

// Reçoit la confirmation de paiement de Jèko (TRANSACTION_COMPLETED) et, si elle est
// authentique et réussie, crédite automatiquement le compte étudiant correspondant —
// remplaçant le geste manuel "l'étudiant clique j'ai payé, puis l'admin confirme à la main"
// par une confirmation immédiate et fiable, directement depuis l'opérateur mobile money.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const STORE_NAME = "infas-hemato-candidates";
function getBlobStore() {
  return getStore(STORE_NAME);
}

// --- Mêmes constantes que côté client (ExamApp.jsx), dupliquées ici car cette route ne
// peut pas importer un composant client. Toute modification des forfaits doit être répercutée
// aux DEUX endroits : ici et dans SUBSCRIPTION_PLANS / jeko-create-payment/route.js. ---
const PLAN_DAYS = { "1mois": 30, "2mois": 60, "3mois": 90 };
const PLAN_PRICE = { "1mois": 600, "2mois": 1000, "3mois": 1500 };
const PAID_DAYS_FALLBACK = 365;
const TRIAL_DAYS = 15;
const TRIAL_DAYS_NEW = 7;
const TRIAL_LENGTH_CHANGE_AT = new Date("2026-08-18T00:00:00Z").getTime();
const REFERRAL_REWARD_FCFA = 100;

function sanitizeKeyPart(s) {
  return String(s || "").replace(/[^a-zA-Z0-9_-]/g, "_");
}
function studentKey(matricule) {
  return `infas-hemato:student:${sanitizeKeyPart(matricule)}`;
}
function legacyStudentKey(matricule) {
  return `infas-hemato:cand:${sanitizeKeyPart(matricule)}`;
}

async function blobGet(store, key) {
  try {
    const v = await store.get(key);
    return v === null || v === undefined ? null : v;
  } catch {
    return memoryFallback.get(key);
  }
}
async function blobSet(store, key, value) {
  try {
    await store.set(key, value);
  } catch {
    await memoryFallback.set(key, value);
  }
}

// Réplique côté serveur la partie de computeAccess() nécessaire pour calculer les jours
// restants d'un compte au moment du paiement (voir ExamApp.jsx, computeAccess). Doit rester
// synchronisée avec cette fonction si sa logique évolue côté client.
function daysLeftFor(rec) {
  const now = Date.now();
  const isPaid = rec.paymentStatus === "paid" && rec.paidAt;
  const trialStart = rec.trialResetAt || rec.createdAt || rec.firstSeen;
  const startMs = trialStart ? new Date(trialStart).getTime() : NaN;
  const isPaidStartMs = isPaid ? new Date(rec.paidAt).getTime() : NaN;
  const start = isPaid ? isPaidStartMs : startMs;
  const registeredAt = rec.createdAt ? new Date(rec.createdAt).getTime() : null;
  const isNewRegistration = Number.isFinite(registeredAt) && registeredAt >= TRIAL_LENGTH_CHANGE_AT;
  const totalDays = isPaid ? (rec.paidDays || PAID_DAYS_FALLBACK) : (isNewRegistration ? TRIAL_DAYS_NEW : TRIAL_DAYS);
  const safeStart = Number.isFinite(start) ? start : now;
  const elapsedDays = (now - safeStart) / 86400000;
  return Math.max(0, Math.ceil(totalDays - elapsedDays));
}

// Reconstitue matricule/planId à partir de la référence forgée par jeko-create-payment
// (format : infas__{matricule}__{planId}__{timestamp}).
function parseReference(reference) {
  if (typeof reference !== "string") return null;
  const parts = reference.split("__");
  if (parts.length !== 4 || parts[0] !== "infas") return null;
  const [, matricule, planId] = parts;
  if (!PLAN_DAYS[planId]) return null;
  return { matricule, planId };
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export async function POST(request) {
  const secret = process.env.JEKO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("Jèko webhook: JEKO_WEBHOOK_SECRET manquant côté serveur");
    return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
  }

  // La signature porte sur le corps BRUT — jamais le JSON re-sérialisé, qui peut différer
  // par le moindre espace ou l'ordre des champs et ferait échouer la vérification.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("jeko-signature") || request.headers.get("Jeko-Signature") || "";
  const expectedSignature = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  if (!timingSafeEqualHex(signatureHeader, expectedSignature)) {
    console.error("Jèko webhook: signature invalide, requête rejetée");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Les payloads "TRANSACTION_COMPLETED" sont plats (pas d'enveloppe event/payload) : on les
  // reconnaît à la présence d'un champ "status" directement à la racine. Toute autre forme
  // (Service Provider link request, escrow...) est accusée mais ignorée : elle ne concerne pas
  // les abonnements de paiement étudiant.
  if (payload.event || typeof payload.status !== "string") {
    return NextResponse.json({ received: true, ignored: "not_a_flat_transaction" }, { status: 200 });
  }

  const transactionId = payload.id;
  const status = payload.status;
  const reference = payload.transactionDetails?.reference;

  const store = getBlobStore();

  // Idempotence : Jèko réessaie jusqu'à trois fois si notre réponse n'arrive pas assez vite.
  // Sans ce verrou, un même paiement pourrait créditer deux fois les jours d'abonnement de
  // l'étudiant, ou déclencher deux fois la récompense de parrainage.
  const processedKey = `infas-hemato:jeko-processed:${transactionId}`;
  const alreadyProcessed = await blobGet(store, processedKey);
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, alreadyProcessed: true }, { status: 200 });
  }

  if (status !== "success") {
    // Paiement en attente ou en échec : rien à créditer, mais on marque comme traité pour
    // ne pas retraiter inutilement les retries de ce même événement.
    await blobSet(store, processedKey, JSON.stringify({ status, at: new Date().toISOString() }));
    return NextResponse.json({ received: true, status }, { status: 200 });
  }

  const parsed = parseReference(reference);
  if (!parsed) {
    console.error("Jèko webhook: référence non reconnue", reference);
    await blobSet(store, processedKey, JSON.stringify({ status, error: "unrecognized_reference", at: new Date().toISOString() }));
    return NextResponse.json({ received: true, error: "unrecognized_reference" }, { status: 200 });
  }

  const { matricule, planId } = parsed;

  let key = studentKey(matricule);
  let raw = await blobGet(store, key);
  if (!raw) {
    key = legacyStudentKey(matricule);
    raw = await blobGet(store, key);
  }
  if (!raw) {
    console.error("Jèko webhook: étudiant introuvable pour le matricule", matricule);
    await blobSet(store, processedKey, JSON.stringify({ status, error: "student_not_found", matricule, at: new Date().toISOString() }));
    return NextResponse.json({ received: true, error: "student_not_found" }, { status: 200 });
  }

  // --- À partir d'ici, réplique exactement la logique de confirmPayment() côté client
  // (ExamApp.jsx) : jours cumulés (pas remplacés), historique des paiements, récompense de
  // parrainage au tout premier paiement uniquement. Toute évolution de confirmPayment doit
  // être répercutée ici. ---
  const rec = JSON.parse(raw);
  const isFirstPayment = !rec.paidAt;
  const remainingDays = rec.paymentStatus === "paid" ? daysLeftFor(rec) : 0;
  const newPlanDays = PLAN_DAYS[planId] || PAID_DAYS_FALLBACK;

  rec.paymentStatus = "paid";
  rec.paidAt = new Date().toISOString();
  rec.paidDays = newPlanDays + remainingDays;
  rec.pendingSince = null;
  rec.pendingPlan = null;
  rec.paymentHistory = Array.isArray(rec.paymentHistory) ? rec.paymentHistory : [];
  rec.paymentHistory.push({
    date: rec.paidAt,
    planId,
    amount: PLAN_PRICE[planId] || 0,
    via: "jeko",
    jekoTransactionId: transactionId,
    paymentMethod: payload.paymentMethod || null,
  });

  await blobSet(store, key, JSON.stringify(rec));

  // Récompense du parrain, uniquement au tout premier paiement confirmé du filleul.
  if (isFirstPayment && rec.parrainMatricule && !rec.parrainRecompense) {
    try {
      const balKey = `referral-balance:${rec.parrainMatricule}`;
      const balRaw = await blobGet(store, balKey);
      const bal = balRaw ? JSON.parse(balRaw) : { entries: [] };
      bal.entries.push({
        filleulMatricule: rec.matricule, filleulNom: rec.nom, filleulPrenom: rec.prenom,
        amount: REFERRAL_REWARD_FCFA, date: new Date().toISOString(), paidOut: false,
      });
      await blobSet(store, balKey, JSON.stringify(bal));
      rec.parrainRecompense = true;
      await blobSet(store, key, JSON.stringify(rec));
    } catch (e) {
      console.error("Jèko webhook: erreur crédit parrainage (paiement lui-même déjà confirmé)", e);
    }
  }

  await blobSet(store, processedKey, JSON.stringify({ status, matricule, planId, at: new Date().toISOString() }));

  return NextResponse.json({ received: true, credited: true }, { status: 200 });
}
