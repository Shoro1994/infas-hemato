import { NextResponse } from "next/server";

// Route serveur : corrige une réponse libre d'étudiant via Gemini (clé GEMINI_API_KEY
// en variable d'environnement Netlify). Appelée par gradeClinicalAnswer() côté client.
export async function POST(request) {
  try {
    const { stem, expected, studentAnswer } = await request.json();

    const prompt = `Tu es un correcteur pédagogique bienveillant pour des étudiants infirmiers et sages-femmes en formation (niveau Licence, Côte d'Ivoire).

Cas / question posée :
"""
${stem}
"""

Réponse de référence attendue :
"""
${expected}
"""

Réponse donnée par l'étudiant :
"""
${studentAnswer}
"""

Évalue la réponse de l'étudiant par rapport à la réponse de référence. Accepte les synonymes, abréviations et formulations différentes tant que le sens clinique est correct (par exemple « GEU », « grossesse extra-utérine » et « grossesse ectopique » sont équivalents).

Réponds UNIQUEMENT avec un objet JSON valide, sans aucun texte avant ou après, au format exact :
{"verdict": "correct" | "partiel" | "incorrect", "explication": "1 à 2 phrases bienveillantes et pédagogiques expliquant l'évaluation", "rappel": "rappel concis de la notion attendue"}`;

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

    return NextResponse.json({
      verdict: ["correct", "partiel", "incorrect"].includes(parsed.verdict) ? parsed.verdict : "partiel",
      explication: parsed.explication || "",
      rappel: parsed.rappel || expected,
    });
  } catch (e) {
    console.error("Erreur /api/grade", e);
    return NextResponse.json(
      { verdict: "partiel", explication: "", rappel: "", error: true },
      { status: 200 }
    );
  }
}
