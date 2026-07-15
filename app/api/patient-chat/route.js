import { NextResponse } from "next/server";

// Route serveur : fait "parler" le patient virtuel via Gemini, strictement contraint à la
// fiche de faits du cas (clé GEMINI_API_KEY en variable d'environnement Netlify).
export async function POST(request) {
  try {
    const { profil, motif, faits, studentQuestion } = await request.json();
    const factsList = (faits || []).map((f) => `- ${f.q} → ${f.r}`).join("\n");

    const prompt = `Tu incarnes UNIQUEMENT le patient suivant dans une simulation clinique pour étudiants infirmiers/sages-femmes. Ne sors jamais de ce personnage et n'invente AUCUN fait médical qui ne figure pas dans la fiche ci-dessous.

Profil : ${profil}
Motif de consultation : ${motif}

Fiche de faits connus (utilise UNIQUEMENT ces informations) :
${factsList}

Règles strictes :
- Si la question de l'étudiant correspond à un fait de la fiche, réponds avec ce fait, reformulé naturellement à la première personne.
- Si la question ne correspond à AUCUN fait de la fiche, réponds de façon réaliste mais vague, SANS inventer de fait médical précis (ex : "je ne sais pas trop", "je n'ai pas vérifié", "je n'y avais pas pensé").
- Ne révèle jamais explicitement un diagnostic médical.
- Réponds en 1 à 2 phrases maximum, à la première personne, ton naturel d'un patient.

Question de l'étudiant : "${studentQuestion}"

Réponds UNIQUEMENT avec un objet JSON valide, sans texte avant ou après : {"reponse": "..."}`;

    const apiKey = process.env.GEMINI_API_KEY;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );
    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    return NextResponse.json({ reponse: parsed.reponse || "Je ne sais pas trop quoi répondre à ça." });
  } catch (e) {
    console.error("Erreur /api/patient-chat", e);
    return NextResponse.json({ reponse: null, error: true }, { status: 200 });
  }
}
