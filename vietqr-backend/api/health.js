const crypto = require('crypto');
const { json, method } = require('./_lib/shared');

const APP_LICENSE_PUBLIC_KEY_SPKI = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAl+jaaSoK1QfHeuAcEocJTB8/fXPnZEmRnqBiwlSwmuonYYb6rkXENEESB8+4KmU5g4kcAykphqda94oYIydIpajrc9KQ6mEgr3uBUm7td3xfY8LX5ga3CmbV72A3A2kE9Kx8Xv4puBW46jtJRCky7lHkbGY8A3tuk5TxMgOS/oZWza/MrtuVQqLXs7UySPNiABN3D8aVK8jrY8Q5Hot5YpDhtV30A+Pw0258dTpwu7MQDm02YjBSqSKOKS8wje5wjCPZt85eJGCrFL3KtUyaiiXjgzo+c3/784vEl3YiyQJRMD0QmgexdG57DfEl8BpkLR3ZWxjmN1Bs8cdH5EUJUwIDAQAB';

function licenseSignerMatchesApp() {
  try {
    let privateKey;
    if (process.env.LICENSE_RSA_PRIVATE_KEY_B64) {
      privateKey = crypto.createPrivateKey(
        Buffer.from(process.env.LICENSE_RSA_PRIVATE_KEY_B64, 'base64').toString('utf8')
      );
    } else if (process.env.LICENSE_RSA_PRIVATE_KEY) {
      privateKey = crypto.createPrivateKey(process.env.LICENSE_RSA_PRIVATE_KEY.replace(/\\n/g, '\n'));
    } else {
      return false;
    }
    const actualPublicKey = crypto.createPublicKey(privateKey)
      .export({ format: 'der', type: 'spki' })
      .toString('base64');
    return actualPublicKey === APP_LICENSE_PUBLIC_KEY_SPKI;
  } catch (_) {
    return false;
  }
}

module.exports = async function handler(req,res) {
  if (!method(req,res,'GET')) return;
  return json(res,200,{
    service:'TuVi Lac Hong bank payment',
    merchantName:process.env.VIETQR_MERCHANT_NAME || 'TUVILACHVN',
    basePath:process.env.VIETQR_BASE_PATH || '/vqr',
    callbackPaths:{
      getToken:'/vqr/api/token_generate',
      transactionSync:'/vqr/bank/api/transaction-sync',
      sepayWebhook:'/api/sepay/webhook'
    },
    configured:{
      vietqrCredentials:!!(process.env.VIETQR_API_USERNAME && process.env.VIETQR_API_PASSWORD) || !!process.env.VIETQR_API_KEY || !!process.env.VIETQR_STATIC_ACCESS_TOKEN,
      bankAccount:!!process.env.VIETQR_BANK_ACCOUNT,
      sepayWebhookSecret:!!process.env.SEPAY_WEBHOOK_SECRET,
      redis:!!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)),
      licenseSigner:licenseSignerMatchesApp(),
      orderProof:!!process.env.ORDER_TOKEN_SECRET
    }
  });
};
