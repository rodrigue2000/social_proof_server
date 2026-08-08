const { db, admin } = require('./firebase');

/**
 * Point d'entrée unique appelé quand une transaction FedaPay change de statut.
 * Le champ customMetadata.type détermine quelle action métier exécuter.
 * Pour ajouter un nouveau type de paiement plus tard (ex: un service de la
 * grille tarifaire), il suffit d'ajouter un nouveau "case" ici — aucune autre
 * partie du serveur n'a besoin d'être modifiée.
 */
async function traiterTransactionApprouvee(customMetadata) {
  const type = customMetadata?.type;

  switch (type) {
    case 'premium':
      await traiterPremiumApprouve(customMetadata);
      break;
    case 'demande':
      await traiterDemandeApprouvee(customMetadata);
      break;
    default:
      console.warn(`Type de paiement inconnu dans custom_metadata : ${type}`);
  }
}

async function traiterTransactionEchouee(customMetadata) {
  const type = customMetadata?.type;

  switch (type) {
    case 'demande':
      await traiterDemandeEchouee(customMetadata);
      break;
    case 'premium':
      // Rien à défaire côté Firestore : le compte n'a jamais été activé.
      break;
    default:
      console.warn(`Type de paiement inconnu (échec) dans custom_metadata : ${type}`);
  }
}

async function traiterPremiumApprouve(customMetadata) {
  const { createurId } = customMetadata;
  if (!createurId) {
    console.error('traiterPremiumApprouve : createurId manquant dans custom_metadata');
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

  console.log(`Premium activé pour le créateur ${createurId}`);
}

async function traiterDemandeApprouvee(customMetadata) {
  const { demandeId } = customMetadata;
  if (!demandeId) {
    console.error('traiterDemandeApprouvee : demandeId manquant dans custom_metadata');
    return;
  }

  await db.collection('demandes').doc(demandeId).update({
    statut: 'en_attente',
    datePaiementConfirme: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Demande ${demandeId} publiée après paiement confirmé`);
}

async function traiterDemandeEchouee(customMetadata) {
  const { demandeId } = customMetadata;
  if (!demandeId) return;

  await db.collection('demandes').doc(demandeId).update({
    statut: 'paiement_echoue',
    datePaiementEchoue: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`Demande ${demandeId} marquée comme paiement échoué`);
}

module.exports = { traiterTransactionApprouvee, traiterTransactionEchouee };
