  const { db, admin } = require('./firebase');

// --- Fonction utilitaire pour enregistrer les transactions ---
async function _enregistrerTransaction(customMetadata, statut) {
  const transactionId = customMetadata?.transactionId;
  if (!transactionId) {
    console.warn('⚠️ Pas de transactionId dans customMetadata');
    return;
  }

  try {
    const transactionRef = db.collection('transactions').doc(transactionId);
    await transactionRef.set({
      type: customMetadata.type || 'inconnu',
      commandeId: customMetadata.commandeId || null,
      demandeId: customMetadata.demandeId || null,
      createurId: customMetadata.createurId || null,
      montant: customMetadata.montant || 0,
      statut: statut,
      dateMiseAJour: admin.firestore.FieldValue.serverTimestamp(),
      metadata: customMetadata,
    }, { merge: true });
    
    console.log(`📝 Transaction ${transactionId} enregistrée avec statut: ${statut}`);
  } catch (error) {
    console.error(`❌ Erreur enregistrement transaction ${transactionId}:`, error);
  }
}

/**
 * Point d'entrée unique appelé quand une transaction FedaPay est approuvée.
 */
async function traiterTransactionApprouvee(customMetadata) {
  await _enregistrerTransaction(customMetadata, 'reussi');

  const type = customMetadata?.type;

  switch (type) {
    case 'premium':
      await traiterPremiumApprouve(customMetadata);
      break;
    case 'demande':
      await traiterDemandeApprouvee(customMetadata);
      break;
    case 'commande':
      await traiterCommandeApprouvee(customMetadata);
      break;
    default:
      console.warn(`Type de paiement inconnu dans custom_metadata : ${type}`);
  }
}

/**
 * Point d'entrée unique appelé quand une transaction FedaPay échoue.
 */
async function traiterTransactionEchouee(customMetadata) {
  await _enregistrerTransaction(customMetadata, 'echoue');

  const type = customMetadata?.type;

  switch (type) {
    case 'demande':
      await traiterDemandeEchouee(customMetadata);
      break;
    case 'commande':
      await traiterCommandeEchouee(customMetadata);
      break;
    case 'premium':
      break;
    default:
      console.warn(`Type de paiement inconnu (échec) dans custom_metadata : ${type}`);
  }
}

// --- Premium ---
async function traiterPremiumApprouve(customMetadata) {
  const { createurId } = customMetadata;
  if (!createurId) {
    console.error('traiterPremiumApprouve : createurId manquant');
    return;
  }

  const expiration = new Date();
  expiration.setDate(expiration.getDate() + 365);

  await db.collection('createurs').doc(createurId).update({
    estPremium: true,
    datePremium: admin.firestore.FieldValue.serverTimestamp(),
    premiumExpiration: admin.firestore.Timestamp.fromDate(expiration),
    quotaJournalier: 10,
  });

  console.log(`✅ Premium activé pour le créateur ${createurId}`);
}

// --- Demande simple ---
async function traiterDemandeApprouvee(customMetadata) {
  const { demandeId } = customMetadata;
  if (!demandeId) {
    console.error('traiterDemandeApprouvee : demandeId manquant');
    return;
  }

  await db.collection('demandes').doc(demandeId).update({
    statut: 'en_attente',
    datePaiementConfirme: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`✅ Demande ${demandeId} publiée après paiement confirmé`);
}

async function traiterDemandeEchouee(customMetadata) {
  const { demandeId } = customMetadata;
  if (!demandeId) return;

  await db.collection('demandes').doc(demandeId).update({
    statut: 'paiement_echoue',
    datePaiementEchoue: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`❌ Demande ${demandeId} marquée comme paiement échoué`);
}

// --- Commande multitâches avec commission ---
async function traiterCommandeApprouvee(customMetadata) {
  const { commandeId, demandeurId } = customMetadata;
  
  if (!commandeId) {
    console.error('traiterCommandeApprouvee : commandeId manquant');
    return;
  }

  console.log(`💰 Paiement confirmé pour la commande ${commandeId}`);

  try {
    const commandeRef = db.collection('commandes').doc(commandeId);
    const commandeDoc = await commandeRef.get();
    
    if (!commandeDoc.exists) {
      console.error(`❌ Commande ${commandeId} introuvable`);
      return;
    }

    const commande = commandeDoc.data();
    
    if (commande.statut === 'payee' || commande.statut === 'en_cours') {
      console.log(`✅ Commande ${commandeId} déjà traitée (statut: ${commande.statut})`);
      return;
    }

    const services = commande.services || [];
    const sensibilitesExclues = commande.sensibilitesExclues || [];
    const descriptionTache = commande.descriptionTache || '';
    const secteurActivite = commande.secteurActivite || '';
    const nombreTaches = commande.nombreTaches || 0;
    const serviceId = services[0]?.serviceId || null;
    
    if (nombreTaches === 0) {
      console.error(`❌ Commande ${commandeId} a 0 tâches à créer`);
      await commandeRef.update({
        statut: 'erreur_dispatching',
        erreur: 'Nombre de tâches = 0'
      });
      return;
    }

    console.log(`📦 Création de ${nombreTaches} tâches pour la commande ${commandeId}`);

    const batch = db.batch();
    const demandesRef = db.collection('demandes');
    const maintenant = admin.firestore.FieldValue.serverTimestamp();

    // Récupérer le prix unitaire
    const prixUnitaire = services[0]?.prixUnitaire || 0;
    // Calculer le gain du créateur (85%) et la commission (15%)
    const gainCreateur = Math.round(prixUnitaire * 0.85);
    const commission = Math.round(prixUnitaire * 0.15);

    for (let i = 0; i < nombreTaches; i++) {
      const demandeDoc = demandesRef.doc();
      batch.set(demandeDoc, {
        commandeId: commandeId,
        demandeurId: demandeurId,
        descriptionTache: descriptionTache,
        secteurActivite: secteurActivite,
        motsCles: services.map(s => s.nom || s.serviceId || ''),
        serviceId: serviceId,
        quantite: 1,
        statut: 'en_attente',
        dateCreation: maintenant,
        sensibilitesExclues: sensibilitesExclues,
        // Prix et commission
        prixUnitaire: prixUnitaire,
        gain: gainCreateur,        // 85% du prix unitaire
        commission: commission,    // 15% du prix unitaire
        numeroTache: i + 1,
        totalTaches: nombreTaches,
      });
    }

    // Mettre à jour le statut de la commande avec les infos financières
    batch.update(commandeRef, {
      statut: 'en_cours',
      datePaiement: maintenant,
      tachesCrees: nombreTaches,
      gainTotalCreateurs: gainCreateur * nombreTaches,
      commissionTotal: commission * nombreTaches,
    });

    await batch.commit();
    console.log(`✅ ${nombreTaches} tâches créées pour la commande ${commandeId}`);
    console.log(`   💰 Gain créateur: ${gainCreateur} F CFA/tâche (85%)`);
    console.log(`   💰 Commission plateforme: ${commission} F CFA/tâche (15%)`);

  } catch (error) {
    console.error(`❌ Erreur dispatching commande ${commandeId}:`, error);
    
    try {
      await db.collection('commandes').doc(commandeId).update({
        statut: 'erreur_dispatching',
        erreur: error.message || 'Erreur inconnue',
        dateErreur: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (updateError) {
      console.error('❌ Impossible de marquer l\'erreur:', updateError);
    }
  }
}

async function traiterCommandeEchouee(customMetadata) {
  const { commandeId } = customMetadata;
  if (!commandeId) return;

  console.log(`❌ Paiement échoué pour la commande ${commandeId}`);

  await db.collection('commandes').doc(commandeId).update({
    statut: 'paiement_echoue',
    datePaiementEchoue: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Commande ${commandeId} marquée comme paiement échoué`);
}

module.exports = { 
  traiterTransactionApprouvee, 
  traiterTransactionEchouee,
  traiterPremiumApprouve,
  traiterDemandeApprouvee,
  traiterCommandeApprouvee,
};