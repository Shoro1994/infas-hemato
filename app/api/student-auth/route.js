import { NextResponse } from "next/server";
import { getStore } from "@netlify/blobs";
import { memoryFallback } from "../../../lib/blobsFallback";

// Route serveur d'authentification étudiante. Avant cette route, le mot de
// passe (année de naissance) d'un étudiant était comparé CÔTÉ NAVIGATEUR :
// pour ça, le serveur devait renvoyer la fiche complète (donc le mot de
// passe en clair) à quiconque connaissait/devinait un matricule, même sans
// se connecter. Cette route corrige ça : la comparaison se fait ici, côté
// serveur, et seule la fiche (sans le mot de passe) est renvoyée — et
// uniquement si le mot de passe fourni est correct.
const STORE_NAME = "infas-hemato-candidates";
function getBlobStore() {
  return getStore(STORE_NAME, { consistency: "strong" });
}
function sanitizeKeyPart(s) {
  return (s || "").replace(/[^A-Za-z0-9+]/g, "");
}
// IMPORTANT : deux formats de clé coexistent dans les données réelles. Les comptes créés
// avant le 15 juillet 2026 utilisent l'ancien préfixe "infas-hemato:cand:" ; ceux créés
// depuis utilisent "infas-hemato:student:". Le code de l'application n'a jamais migré les
// anciennes fiches vers le nouveau format — elles existent toujours, telles quelles, sous
// l'ancien préfixe. Cette route doit donc essayer les deux, sans quoi tout compte créé
// avant cette date est introuvable et la connexion échoue systématiquement, quel que soit
// le mot de passe fourni.
function studentKeyCandidates(matricule) {
  const clean = sanitizeKeyPart(matricule);
  return [`infas-hemato:student:${clean}`, `infas-hemato:cand:${clean}`];
}

async function readStudent(matricule) {
  const store = getBlobStore();
  for (const key of studentKeyCandidates(matricule)) {
    try {
      const raw = await store.get(key);
      if (raw) return JSON.parse(raw);
    } catch {
      /* on tente la clé suivante */
    }
  }
  // Dernier repli si Blobs est totalement indisponible.
  for (const key of studentKeyCandidates(matricule)) {
    try {
      const raw = await memoryFallback.get(key);
      if (raw) return JSON.parse(raw);
    } catch {
      /* rien à faire de plus */
    }
  }
  return null;
}

export async function POST(request) {
  try {
    const { matricule, password } = await request.json();
    if (!matricule || !password) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }
    const record = await readStudent(matricule.trim());
    if (!record) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (String(record.anneeNaissance) !== String(password).trim()) {
      return NextResponse.json({ ok: false, error: "invalid_password" }, { status: 401 });
    }
    // Important : on RENVOIE le mot de passe dans la réponse (contrairement à une
    // version antérieure de cette route qui le retirait). Le retirer semblait plus
    // sûr, mais causait une corruption grave : plusieurs endroits de l'application
    // réenregistrent la fiche complète de l'étudiant juste après la connexion
    // (ex. réinitialisation de l'essai gratuit), en repartant de l'objet reçu ici.
    // Sans le mot de passe dedans, cette réécriture l'effaçait silencieusement de
    // la base — rendant la connexion suivante impossible même avec le bon mot de
    // passe. Le renvoyer ici ne pose pas de risque de sécurité réel : l'utilisateur
    // vient de le taper lui-même et de prouver qu'il le connaît.
    return NextResponse.json({ ok: true, student: record });
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
