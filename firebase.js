const admin = require('firebase-admin');

// La clé de compte de service Firebase est fournie en variable d'environnement
// (contenu JSON complet, sur une seule ligne) — jamais commitée dans le dépôt.
// Voir README.md pour savoir comment l'obtenir et la configurer sur Render.
if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  throw new Error(
    'Variable d\'environnement FIREBASE_SERVICE_ACCOUNT_JSON manquante. ' +
    'Voir README.md pour savoir comment la générer.'
  );
}

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

module.exports = { admin, db };
