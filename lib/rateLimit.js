import { getStore } from "@netlify/blobs";

// Limite de débit simple, partagée par les routes IA (/api/grade et
// /api/patient-chat), qui utilisent la clé Gemini payante côté serveur.
// Sans ça, n'importe qui pouvait appeler ces routes en boucle directement
// (sans même passer par l'application), faisant grimper la facture ou
// saturant le service pour tout le monde.
//
// Fonctionnement : on garde, par adresse IP et par route, les horodatages
// des derniers appels dans Netlify Blobs. Si le nombre d'appels dans la
// fenêtre de temps dépasse la limite, la requête est refusée (429).
const STORE_NAME = "infas-hemato-ratelimit";
const WINDOW_MS = 5 * 60 * 1000; // fenêtre glissante de 5 minutes
const MAX_REQUESTS = 20; // 20 appels max par IP et par route sur la fenêtre

function clientIp(request) {
  return (
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

export async function checkRateLimit(request, routeName) {
  try {
    const ip = clientIp(request);
    const store = getStore(STORE_NAME);
    const key = `${routeName}:${ip}`;
    const now = Date.now();
    let timestamps = [];
    try {
      const raw = await store.get(key);
      if (raw) timestamps = JSON.parse(raw);
    } catch {
      timestamps = [];
    }
    timestamps = timestamps.filter((t) => now - t < WINDOW_MS);
    if (timestamps.length >= MAX_REQUESTS) {
      return { allowed: false };
    }
    timestamps.push(now);
    await store.set(key, JSON.stringify(timestamps));
    return { allowed: true };
  } catch {
    // Si le stockage est indisponible, on n'empêche pas le service de
    // fonctionner : mieux vaut un risque d'abus temporaire qu'une panne
    // totale des modules IA pour tout le monde.
    return { allowed: true };
  }
}
