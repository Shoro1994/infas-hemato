import { NextResponse } from "next/server";

// Route serveur d'authentification admin. Les identifiants réels (ADMIN_ID,
// ADMIN_PASSWORD) et le jeton de session (ADMIN_TOKEN) vivent uniquement dans
// les variables d'environnement Netlify — jamais dans le code envoyé au
// navigateur. C'est la correction du problème où le mot de passe admin était
// visible en clair dans ExamApp.jsx (donc lisible par n'importe quel visiteur
// via les outils de développement du navigateur).
export async function POST(request) {
  try {
    const { id, password } = await request.json();
    const validId = process.env.ADMIN_ID;
    const validPassword = process.env.ADMIN_PASSWORD;
    const token = process.env.ADMIN_TOKEN;

    if (!validId || !validPassword || !token) {
      // Variables d'environnement pas encore configurées sur Netlify
      return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
    }
    if (id === validId && password === validPassword) {
      return NextResponse.json({ ok: true, token });
    }
    return NextResponse.json({ ok: false, error: "invalid_credentials" }, { status: 401 });
  } catch {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
