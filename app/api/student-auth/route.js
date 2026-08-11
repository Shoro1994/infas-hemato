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
  return getStore(STORE_NAME);
}
function studentKey(matricule) {
  return `student:${matricule}`;
}

async function readStudent(key) {
  try {
    const store = getBlobStore();
    const raw = await store.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    const raw = await memoryFallback.get(key);
    return raw ? JSON.parse(raw) : null;
  }
}

export async function POST(request) {
  try {
    const { matricule, password } = await request.json();
    if (!matricule || !password) {
      return NextResponse.json({ ok: false, error: "missing_fields" }, { status: 400 });
    }
    const record = await readStudent(studentKey(matricule.trim()));
    if (!record) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }
    if (String(record.anneeNaissance) !== String(password).trim()) {
      return NextResponse.json({ ok: false, error: "invalid_password" }, { status: 401 });
    }
    // On ne renvoie jamais le mot de passe, même en cas de succès : le
    // navigateur n'en a plus besoin une fois la vérification faite ici.
    const { anneeNaissance, ...safeRecord } = record;
    return NextResponse.json({ ok: true, student: safeRecord });
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
