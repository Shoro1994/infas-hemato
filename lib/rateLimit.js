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

export async function checkRateLimit(request, routeName, options = {}) {
  const windowMs = options.windowMs || WINDOW_MS;
  const maxRequests = options.maxRequests || MAX_REQUESTS;
  try {
    // Par défaut on limite par IP, mais certaines routes (ex. admin-auth) préfèrent
    // limiter par la valeur tentée (l'identifiant saisi) plutôt que par IP : cette
    // route est appelée à CHAQUE tentative de connexion, y compris celles des
    // étudiants (pour vérifier si ce n'est pas un admin) — limiter par IP risquerait
    // de bloquer tout un groupe d'étudiants partageant la même adresse (fréquent sur
    // les réseaux mobiles), à cause d'une poignée de vraies tentatives sur le compte
    // admin. Limiter par identifiant tenté cible uniquement le vrai risque.
    const identifier = options.customKey || clientIp(request);
    const store = getStore(STORE_NAME);
    const key = `${routeName}:${identifier}`;
    const now = Date.now();
    let timestamps = [];
    try {
      const raw = await store.get(key);
      if (raw) timestamps = JSON.parse(raw);
    } catch {
      timestamps = [];
    }
    timestamps = timestamps.filter((t) => now - t < windowMs);
    if (timestamps.length >= maxRequests) {
      return { allowed: false };
    }
    timestamps.push(now);
    await store.set(key, JSON.stringify(timestamps));
    return { allowed: true };
  } catch {
    // Si le stockage est indisponible, on n'empêche pas le service de
    // fonctionner : mieux vaut un risque d'abus temporaire qu'une panne
    // totale du service concerné pour tout le monde.
    return { allowed: true };
  }
}
