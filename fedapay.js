const { FedaPay, Transaction, Webhook } = require('fedapay');

if (!process.env.FEDAPAY_SECRET_KEY) {
  throw new Error('Variable d\'environnement FEDAPAY_SECRET_KEY manquante.');
}

FedaPay.setApiKey(process.env.FEDAPAY_SECRET_KEY);
FedaPay.setEnvironment(process.env.FEDAPAY_ENV || 'sandbox'); // 'sandbox' ou 'live'

module.exports = { FedaPay, Transaction, Webhook };
