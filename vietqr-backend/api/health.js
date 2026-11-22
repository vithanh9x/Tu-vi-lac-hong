const { json, method } = require('./_lib/shared');
module.exports = async function handler(req,res) {
  if (!method(req,res,'GET')) return;
  return json(res,200,{
    service:'TuVi Lac Hong VietQR payment',
    merchantName:process.env.VIETQR_MERCHANT_NAME || 'TUVILACHVN',
    basePath:process.env.VIETQR_BASE_PATH || '/vqr',
    callbackPaths:{getToken:'/vqr/api/token_generate',transactionSync:'/vqr/bank/api/transaction-sync'},
    configured:{
      vietqrCredentials:!!(process.env.VIETQR_API_USERNAME && process.env.VIETQR_API_PASSWORD) || !!process.env.VIETQR_API_KEY || !!process.env.VIETQR_STATIC_ACCESS_TOKEN,
      bankAccount:!!process.env.VIETQR_BANK_ACCOUNT,
      callbackAuth:!!(process.env.VIETQR_CALLBACK_USERNAME && process.env.VIETQR_CALLBACK_PASSWORD && process.env.VIETQR_CALLBACK_JWT_SECRET),
      redis:!!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
      licenseSigner:!!(process.env.LICENSE_RSA_PRIVATE_KEY_B64 || process.env.LICENSE_RSA_PRIVATE_KEY),
      orderProof:!!process.env.ORDER_TOKEN_SECRET
    }
  });
};