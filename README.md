# INFAS · Hémato — Préparation aux examens

Application Next.js prête à déployer sur **Netlify**. Générée à partir du
cours PDF fourni ; aucune notion extérieure n'est inventée dans les
questions.

## Ce qui a changé par rapport à l'aperçu Claude

- Le stockage `window.storage` de l'aperçu Claude a été remplacé par :
  - **`localStorage`** pour les données personnelles (historique d'examens,
    rotation anti-répétition des questions) — chaque étudiant garde les
    siennes sur son propre appareil, pas de configuration nécessaire.
  - **Netlify Blobs** (magasin clé-valeur intégré à Netlify, zéro
    configuration, ce n'est pas Firebase) pour le registre partagé des
    candidats, utilisé par l'écran Administration pour compter les
    personnes qui utilisent la plateforme.
- Le contrôle caméra (anti-fraude) fonctionnera correctement une fois
  déployé en HTTPS — il était limité dans l'aperçu Claude par le bac à
  sable de l'artefact.

## Déployer sur Netlify (gratuit)

1. **Créer un dépôt GitHub** avec ce dossier (ou glissez-déposez le dossier
   directement sur app.netlify.com/drop si vous préférez éviter Git — dans
   ce cas, faites d'abord `npm run build` en local et déposez le dossier
   complet).
2. Sur app.netlify.com, cliquez **Add new site → Import an existing
   project**, connectez votre dépôt GitHub.
3. Netlify détecte automatiquement Next.js et installe le plugin
   `@netlify/plugin-nextjs` (déjà déclaré dans `netlify.toml` pour plus de
   sûreté). Laissez la commande de build par défaut (`npm run build`) et
   cliquez **Deploy site**.
4. C'est tout : **Netlify Blobs ne nécessite aucune étape supplémentaire**,
   contrairement à une base de données classique — il est provisionné
   automatiquement pour le site dès le déploiement.
5. Votre site est en ligne sur une adresse du type
   `https://infas-hemato.netlify.app` (personnalisable dans **Site
   configuration → Domain management**).

## Comptes

- Administrateur : `Shoro` / `merci`
- Étudiant : `licence` / `licence`

Ces identifiants sont actuellement écrits en dur dans le code
(`app/components/ExamApp.jsx`, constante `ACCOUNTS`). Pour un usage en
production avec plus de rigueur, il faudrait les déplacer côté serveur et
ajouter un vrai hachage de mot de passe -- dites-le-moi si vous voulez cette
étape.

## Limites du plan gratuit Netlify à connaître

- 100 Go de bande passante / mois, 300 minutes de build / mois, 125 000
  invocations de fonctions serverless / mois — largement suffisant pour un
  usage INFAS classique (quelques centaines d'étudiants).
- Netlify facture désormais en **crédits** (300 crédits/mois sur le plan
  gratuit) : au-delà, le site est mis en pause jusqu'au mois suivant plutôt
  que de continuer à fonctionner en dépassement. Surveillez l'onglet
  **Usage** de votre équipe si le nombre de candidats grandit beaucoup.
- Les routes API ont un délai d'exécution de 10 secondes sur le plan
  gratuit (26s sur les plans payants) : sans incidence ici, la route
  `/api/kv` répond en quelques millisecondes.

## Développement local

```bash
npm install
npm run dev
```

Ouvrez http://localhost:3000. En `next dev` classique (sans le CLI
Netlify), Netlify Blobs n'a pas de contexte de site auquel s'attacher : le
registre de candidats utilise alors un repli en mémoire (voir
`lib/blobsFallback.js`), suffisant pour tester en local mais réinitialisé à
chaque redémarrage. Pour tester avec de vrais Blobs en local, utilisez
`netlify dev` (nécessite le CLI Netlify et un site déjà lié).

## Structure

```
app/
  layout.js              mise en page racine + métadonnées
  page.js                page unique -> charge ExamApp
  components/ExamApp.jsx toute l'application (écrans, banque de questions, logique)
  api/kv/route.js        API pour le registre partagé des candidats (Netlify Blobs)
lib/
  storage.js             adaptateur client (localStorage / API Blobs)
  blobsFallback.js        repli mémoire si aucun contexte Netlify Blobs n'est disponible
netlify.toml              configuration de build + plugin Next.js
```
