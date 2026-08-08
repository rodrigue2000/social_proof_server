# Serveur Social Proof — paiement FedaPay

Petit serveur Node/Express qui fait deux choses :
1. Crée une transaction de paiement FedaPay et renvoie l'URL de paiement à l'app Flutter.
2. Reçoit le webhook FedaPay qui confirme le paiement, et met à jour Firestore en conséquence (active le Premium, ou publie une demande).

## 1. Récupérer la clé de compte de service Firebase

1. Va sur https://console.firebase.google.com, ouvre le projet `sproof-a9d97`
2. Icône ⚙️ → **Paramètres du projet** → onglet **Comptes de service**
3. Clique **Générer une nouvelle clé privée** → un fichier `.json` se télécharge
4. Ouvre ce fichier, copie tout son contenu (il tient sur une seule ligne une fois copié depuis un éditeur de texte simple, sinon compresse-le en une ligne)
5. Ce contenu ira dans la variable d'environnement `FIREBASE_SERVICE_ACCOUNT_JSON` (étape 4 ci-dessous)

**Ne commite jamais ce fichier dans Git.**

## 2. Créer le compte FedaPay et récupérer les clés

1. Crée un compte sur https://fedapay.com si ce n'est pas déjà fait
2. Dans le dashboard, récupère ta **clé secrète sandbox** (pour tester) — section Développement → Clés API
3. Garde cette clé pour l'étape 4

## 3. Déployer sur Render

1. Mets ce dossier dans un dépôt Git (GitHub par exemple)
2. Va sur https://render.com, connecte-toi (aucune carte requise)
3. **New** → **Web Service** → connecte ton dépôt GitHub
4. Configuration :
   - **Runtime** : Node
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
5. Ne clique pas encore sur "Create Web Service" — configure d'abord les variables d'environnement (étape suivante)

## 4. Variables d'environnement sur Render

Dans l'écran de configuration du service (section **Environment**), ajoute :

| Variable | Valeur |
|---|---|
| `FEDAPAY_SECRET_KEY` | ta clé secrète sandbox FedaPay |
| `FEDAPAY_ENV` | `sandbox` |
| `FEDAPAY_WEBHOOK_SECRET` | voir étape 5, à remplir après |
| `FEDAPAY_CALLBACK_URL` | une URL quelconque pour l'instant, ex: `https://example.com/merci` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | le contenu JSON complet copié à l'étape 1 |

Clique **Create Web Service**. Render te donne une URL du type `https://social-proof-server.onrender.com`.

## 5. Configurer le webhook FedaPay

1. Retourne dans le dashboard FedaPay → **Développement** → **Webhooks**
2. **Créer un webhook**
3. URL de destination : `https://TON-SERVICE.onrender.com/webhooks/fedapay`
4. Événements : sélectionne au minimum `transaction.approved`, `transaction.declined`, `transaction.canceled`
5. Crée le webhook, puis clique **Click to reveal** pour voir le secret généré (commence par `wh_sandbox_...`)
6. Retourne sur Render → variables d'environnement → colle ce secret dans `FEDAPAY_WEBHOOK_SECRET`
7. Render redéploie automatiquement après une modification de variable

## 6. Tester

```
curl -X POST https://TON-SERVICE.onrender.com/transactions/creer \
  -H "Content-Type: application/json" \
  -d '{"type":"premium","createurId":"UID_DE_TEST","email":"test@example.com"}'
```

Tu dois recevoir `{ "url": "https://checkout.fedapay.com/...", "transactionId": ... }`. Ouvre cette URL dans un navigateur pour simuler un paiement (le mode sandbox propose des faux moyens de paiement). Une fois le paiement "approuvé", vérifie dans Firestore que le document `createurs/UID_DE_TEST` a bien `estPremium: true`.

## Ce que l'app Flutter devra appeler

- **Devenir Premium** : `POST /transactions/creer` avec `{ "type": "premium", "createurId": uid, "email": email }` → ouvrir l'`url` reçue dans une WebView ou le navigateur
- **Nouvelle demande** (une fois la grille tarifaire prête) : `POST /transactions/creer` avec `{ "type": "demande", "demandeurId": uid, "email": email, "descriptionTache": ..., "secteurActivite": ..., "motsCles": [...], "montant": prixCalcule }` → ouvrir l'`url` reçue

Dans les deux cas, l'app n'a pas besoin d'attendre la confirmation du serveur directement : elle peut écouter le document Firestore concerné (`createurs/{uid}` ou `demandes/{demandeId}`) en temps réel, qui se mettra à jour automatiquement une fois le webhook traité.

## Passage en production

Quand tu es prêt à accepter de vrais paiements :
1. Récupère tes clés **live** (pas sandbox) sur FedaPay
2. Remplace `FEDAPAY_SECRET_KEY` et `FEDAPAY_ENV=live` sur Render
3. Recrée un webhook en mode live (les webhooks sandbox et live sont séparés) et mets à jour `FEDAPAY_WEBHOOK_SECRET`
