const crypto = require('crypto');
const { json, method, redis } = require('./_lib/shared');

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

  let redisConnected = false;
  try {
    const pong = await redis().ping();
    redisConnected = String(pong).toUpperCase() === 'PONG';
  } catch (e) {
    console.error('[health redis]', e && e.message ? e.message : 'unknown error');
  }

  const bankAccount = process.env.SEPAY_BANK_ACCOUNT || process.env.VIETQR_BANK_ACCOUNT || '';
  const bankCode = process.env.SEPAY_BANK_CODE || process.env.VIETQR_BANK_CODE || '';
  const accountName = process.env.SEPAY_ACCOUNT_NAME || process.env.VIETQR_ACCOUNT_NAME || '';
  return json(res,200,{
    service:'TuVi Lac Hong SePay bank-transfer payment',
    paymentProvider:'SePay QR image + SePay webhook',
    webhookEndpoint:'/api/sepay/webhook',
    configured:{
      sepayQr:!!(bankAccount && bankCode && accountName),
      bankAccount:!!bankAccount,
      sepayWebhookSecret:!!process.env.SEPAY_WEBHOOK_SECRET,
      redis:redisConnected,
      licenseSigner:licenseSignerMatchesApp(),
      orderProof:!!process.env.ORDER_TOKEN_SECRET
    }
  });
};
