import { NextResponse } from "next/server";

// Crée une demande de paiement Jèko côté serveur, et renvoie au client l'URL hébergée
// (redirectUrl) vers laquelle le rediriger. Les clés API Jèko (JEKO_API_KEY, JEKO_API_KEY_ID)
// et l'identifiant du magasin (JEKO_STORE_ID) restent des variables d'environnement côté
// serveur : elles ne transitent jamais vers le navigateur de l'étudiant, contrairement à ce
// qui se passerait si cet appel était fait directement depuis ExamApp.jsx.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Copie serveur des forfaits (prix en FCFA). Doit rester synchronisée avec SUBSCRIPTION_PLANS
// dans ExamApp.jsx si les forfaits changent — dupliquée ici volontairement, car cette route
// ne peut pas importer un composant client.
const PLANS = {
  "1mois": { price: 500 },
  "2mois": { price: 800 },
  "6mois": { price: 2000 },
};

const PAYMENT_METHODS = ["wave", "orange", "mtn", "moov", "djamo"];

const APP_URL = "https://shoro-prepa-agentsante.netlify.app";

function jsonNoCache(body, init = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0", Pragma: "no-cache", ...(init.headers || {}) },
  });
}

// Le matricule et l'identifiant du plan sont encodés dans la référence Jèko elle-même,
// séparés par "__" (un caractère absent des matricules et des identifiants de plan connus).
// C'est ce qui permet au webhook, une fois le paiement confirmé, de retrouver QUEL étudiant
// et QUEL forfait sans avoir à interroger une base de correspondance séparée.
function buildReference(matricule, planId) {
  const safeMatricule = String(matricule).replace(/[^a-zA-Z0-9-]/g, "");
  return `infas__${safeMatricule}__${planId}__${Date.now()}`;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonNoCache({ error: "invalid_json" }, { status: 400 });
  }

  const { matricule, planId, paymentMethod } = body || {};

  if (!matricule || typeof matricule !== "string") {
    return jsonNoCache({ error: "missing_matricule" }, { status: 400 });
  }
  const plan = PLANS[planId];
  if (!plan) {
    return jsonNoCache({ error: "invalid_plan" }, { status: 400 });
  }
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return jsonNoCache({ error: "invalid_payment_method" }, { status: 400 });
  }

  const apiKey = process.env.JEKO_API_KEY;
  const apiKeyId = process.env.JEKO_API_KEY_ID;
  const storeId = process.env.JEKO_STORE_ID;
  if (!apiKey || !apiKeyId || !storeId) {
    console.error("Jèko: variables d'environnement manquantes (JEKO_API_KEY / JEKO_API_KEY_ID / JEKO_STORE_ID)");
    return jsonNoCache({ error: "server_misconfigured" }, { status: 500 });
  }

  const reference = buildReference(matricule, planId);
  const amountCents = plan.price * 100; // Jèko attend le montant en centimes.

  try {
    const jekoRes = await fetch("https://api.jeko.africa/partner_api/payment_requests", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "X-API-KEY-ID": apiKeyId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        storeId,
        amountCents,
        currency: "XOF",
        reference,
        paymentDetails: {
          type: "redirect",
          data: {
            paymentMethod,
            successUrl: `${APP_URL}/?jeko_payment=success&reference=${encodeURIComponent(reference)}`,
            errorUrl: `${APP_URL}/?jeko_payment=error&reference=${encodeURIComponent(reference)}`,
          },
        },
      }),
    });

    const data = await jekoRes.json();

    if (!jekoRes.ok || !data.redirectUrl) {
      console.error("Jèko: échec de création de la demande de paiement", jekoRes.status, data);
      return jsonNoCache({ error: "jeko_request_failed", detail: data.errorReason || null }, { status: 502 });
    }

    return jsonNoCache({ redirectUrl: data.redirectUrl, reference });
  } catch (e) {
    console.error("Jèko: erreur réseau lors de la création du paiement", e);
    return jsonNoCache({ error: "network_error" }, { status: 502 });
  }
}
