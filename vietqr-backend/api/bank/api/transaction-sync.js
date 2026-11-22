const { redis, method, validateCallbackBearer, responseOk, responseError, normalizeContent, envRequired } = require('../../_lib/shared');
module.exports = async function handler(req, res) {
  if (!method(req,res,'POST')) return;
  try {
    if (!validateCallbackBearer(req)) return responseError(res,401,'INVALID_TOKEN','Invalid or expired token');
    const body = req.body || {};
    const bankaccount = String(body.bankaccount || body.bankAccount || '').replace(/\s/g,'');
    const amount = Math.round(Number(body.amount));
    const transType = String(body.transType || '').toUpperCase();
    const orderId = String(body.orderId || '').toUpperCase();
    const transactionId = String(body.transactionid || body.transactionId || '').trim();
    const referenceNumber = String(body.referencenumber || body.referenceNumber || '').trim();
    const transactionTime = Number(body.transactiontime || body.transactionTime);
    const content = String(body.content || '');
    if (!bankaccount || !Number.isSafeInteger(amount) || amount <= 0 || !orderId || !transactionId ||
        !referenceNumber || !Number.isFinite(transactionTime) || transactionTime <= 0 || !content ||
        !['C','CREDIT'].includes(transType)) {
      return responseError(res,400,'INVALID_TRANSACTION_DATA','Missing or invalid required transaction fields');
    }
    const expectedAccount = envRequired('VIETQR_BANK_ACCOUNT').replace(/\s/g,'');
    if (bankaccount !== expectedAccount) return responseError(res,400,'BANK_ACCOUNT_MISMATCH','Bank account does not match configured receiving account');
    const db = redis();
    const key = 'tv:order:' + orderId;
    const order = await db.get(key);
    if (!order) return responseError(res,400,'ORDER_NOT_FOUND','Order ID was not created by this application');
    if (amount !== Number(order.amount)) return responseError(res,400,'AMOUNT_MISMATCH','Paid amount does not match this order');
    if (order.status === 'paid') {
      if (String(order.transactionId) === transactionId) return responseOk(res, transactionId);
      return responseError(res,400,'ORDER_ALREADY_PAID','Order has already been paid with a different transaction');
    }
    const claimed = await db.set('tv:txn:' + transactionId, orderId, { ex: 90*24*60*60, nx:true });
    if (!claimed) {
      const existing = await db.get('tv:txn:' + transactionId);
      if (String(existing) !== orderId) {
        return responseError(res,400,'TRANSACTION_ALREADY_USED','This bank transaction was already processed');
      }
    }
    if (content && !normalizeContent(content).includes(orderId)) {
      await db.del('tv:txn:' + transactionId);
      return responseError(res,400,'CONTENT_MISMATCH','Transfer content does not contain the order reference');
    }
    const paidOrder = {
      ...order, status:'paid', transactionId, referenceNumber,
      paidAt:transactionTime, bankaccount,
      transType, receivedContent:content
    };
    await db.set(key, paidOrder, { ex: 90*24*60*60 });
    return responseOk(res, transactionId);
  } catch (e) {
    console.error('[VietQR transaction-sync]', e && e.message ? e.message : 'unknown error');
    return responseError(res,500,'TRANSACTION_PROCESSING_FAILED','Unable to process transaction callback');
  }
};