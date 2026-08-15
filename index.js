 require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { db, admin } = require('./firebase');
const { Transaction, Webhook } = require('./fedapay');
const { traiterTransactionApprouvee, traiterTransactionEchouee } = require('./traitement');

const app = express();

// --- Route de contrôle ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// --- Webhook FedaPay ---
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

    res.status(200).json({ received: true });

    try {
      const transaction = event.entity;
      const customMetadata = transaction?.custom_metadata || {};
      
      customMetadata.transactionId = transaction.id;

      switch (event.name) {
        case 'transaction.approved':
          await traiterTransactionApprouvee(customMetadata);
          break;
        case 'transaction.declined':
        case 'transaction.canceled':
          await traiterTransactionEchouee(customMetadata);
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('Erreur de traitement du webhook :', err);
    }
  }
);

// --- Middlewares ---
app.use(cors());
app.use(express.json());
// --- Vérifier le statut d'une transaction ---
app.get('/transactions/statut/:transactionId', async (req, res) => {
  try {
    const { transactionId } = req.params;
    
    if (!transactionId) {
      return res.status(400).json({ erreur: 'transactionId requis' });
    }

    const doc = await db.collection('transactions').doc(transactionId).get();

    if (!doc.exists) {
      return res.status(404).json({ erreur: 'Transaction introuvable' });
    }

    res.json({ 
      exists: true, 
      data: doc.data() 
    });
  } catch (err) {
    console.error('Erreur vérification transaction:', err);
    res.status(500).json({ erreur: err.message });
  }
});

// --- Créer une transaction de paiement ---
app.post('/transactions/creer', async (req, res) => {
  console.log('📥 Requête reçue:', req.body); // 👈 AJOUT POUR DEBUG

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
      
    } else if (type === 'commande') {
      const { demandeurId, commandeId, montant: montantCommande, description: descriptionCommande } = req.body;

      if (!demandeurId || !commandeId || !montantCommande) {
        return res.status(400).json({
          erreur: 'Champs "demandeurId", "commandeId" et "montant" requis pour type=commande',
        });
      }

      montant = montantCommande;
      description = descriptionCommande || `Commande ${commandeId}`;
      customMetadata = { 
        type: 'commande', 
        commandeId, 
        demandeurId,
        montant: montantCommande
      };
      
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

    // ✅ CONVERSION EN STRING
    res.json({ url, transactionId: transaction.id.toString() });
  } catch (err) {
    console.error('❌ Erreur de création de transaction :', err);
    res.status(500).json({ erreur: err.message || 'Impossible de créer la transaction' });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 Serveur Social Proof démarré sur le port ${port}`);
});