require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { db, admin } = require('./firebase');
const { Transaction, Webhook } = require('./fedapay');
const { traiterTransactionApprouvee, traiterTransactionEchouee } = require('./traitement');

const app = express();

// --- Route de contrôle (Render l'utilise pour vérifier que le serveur est en vie) ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Webhook FedaPay ---
// IMPORTANT : cette route a besoin du corps brut (non parsé en JSON) pour
// vérifier la signature. Elle doit donc être déclarée AVANT app.use(express.json()).
app.post(
  '/webhooks/fedapay',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-fedapay-signature'];
    const secretWebhook = process.env.FEDAPAY_WEBHOOK_SECRET;

    if (!secretWebhook) {
      console.error('FEDAPAY_WEBHOOK_SECRET manquant côté serveur');
      return res.status(500).send('Configuration serveur incomplète');
    }

    let event;
    try {
      event = Webhook.constructEvent(req.body, signature, secretWebhook);
    } catch (err) {
      console.error('Signature webhook invalide :', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // On répond 200 tout de suite (recommandation FedaPay), puis on traite.
    res.status(200).json({ received: true });

    try {
      const transaction = event.entity;
      const customMetadata = transaction?.custom_metadata || {};

      switch (event.name) {
        case 'transaction.approved':
          await traiterTransactionApprouvee(customMetadata);
          break;
        case 'transaction.declined':
        case 'transaction.canceled':
          await traiterTransactionEchouee(customMetadata);
          break;
        default:
          // transaction.created, transaction.updated, etc. — rien à faire.
          break;
      }
    } catch (err) {
      // La réponse 200 est déjà partie vers FedaPay ; on logge pour investiguer.
      console.error('Erreur de traitement du webhook :', err);
    }
  }
);

// --- Middlewares pour le reste des routes ---
app.use(cors());
app.use(express.json());

// --- Créer une transaction de paiement ---
// body attendu :
//   { type: 'premium', createurId, email }
//   ou
//   { type: 'demande', demandeurId, email, descriptionTache, secteurActivite, motsCles, montant }
app.post('/transactions/creer', async (req, res) => {
  try {
    const { type, email } = req.body;

    if (!type || !email) {
      return res.status(400).json({ erreur: 'Champs "type" et "email" requis' });
    }

    let montant;
    let description;
    let customMetadata;

    if (type === 'premium') {
      const { createurId } = req.body;
      if (!createurId) {
        return res.status(400).json({ erreur: 'Champ "createurId" requis pour type=premium' });
      }
      montant = 5000;
      description = 'Abonnement Premium Social Proof (1 an)';
      customMetadata = { type: 'premium', createurId };
    } else if (type === 'demande') {
      const { demandeurId, descriptionTache, secteurActivite, motsCles, montant: montantDemande } = req.body;

      if (!demandeurId || !descriptionTache || !montantDemande) {
        return res.status(400).json({
          erreur: 'Champs "demandeurId", "descriptionTache" et "montant" requis pour type=demande',
        });
      }

      // On crée le document dès maintenant, en attente de paiement, pour ne
      // pas perdre l'information si le paiement échoue ou est abandonné.
      const refDemande = await db.collection('demandes').add({
        demandeurId,
        descriptionTache,
        secteurActivite: secteurActivite || '',
        motsCles: motsCles || [],
        statut: 'attente_paiement',
        montant: montantDemande,
        dateCreation: admin.firestore.FieldValue.serverTimestamp(),
      });

      montant = montantDemande;
      description = `Publication d'une demande Social Proof : ${descriptionTache}`;
      customMetadata = { type: 'demande', demandeId: refDemande.id, demandeurId };
    } else {
      return res.status(400).json({ erreur: `Type de paiement inconnu : ${type}` });
    }

    const transaction = await Transaction.create({
      description,
      amount: montant,
      currency: { iso: 'XOF' },
      callback_url: process.env.FEDAPAY_CALLBACK_URL || 'https://socialproof.app/paiement-termine',
      customer: { email },
      custom_metadata: customMetadata,
    });

    const { url } = await transaction.generateToken();

    res.json({ url, transactionId: transaction.id });
  } catch (err) {
    console.error('Erreur de création de transaction :', err);
    res.status(500).json({ erreur: 'Impossible de créer la transaction de paiement' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Serveur Social Proof démarré sur le port ${port}`);
});
