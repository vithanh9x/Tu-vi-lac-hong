const crypto = require('crypto');
const { redis, normalizeContent } = require('../_lib/shared');

const DAY = 24 * 60 * 60;
const MAX_BODY_BYTES = 256 * 1024;
const TIMESTAMP_TOLERANCE_SECONDS = 300;

// SePay HMAC must be calculated from the exact raw request bytes.
module.exports.config = { api: { bodyParser: false } };

function reply(res, status, payload) {
  res.status(status);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(payload));
}

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += part.length;
    if (size > MAX_BODY_BYTES) throw new Error('Webhook body too large');
    chunks.push(part);
  }
  return Buffer.concat(chunks);
}

function verifySePaySignature(req, rawBody) {
  const secret = process.env.SEPAY_WEBHOOK_SECRET || '';
  if (!secret) throw new Error('SEPAY_WEBHOOK_SECRET is not configured');

  const signature = String(req.headers['x-sepay-signature'] || '').trim();
  const timestampText = String(req.headers['x-sepay-timestamp'] || '').trim();
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature) || !/^\d{10}$/.test(timestampText)) {
    return false;
  }

  const timestamp = Number(timestampText);
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > TIMESTAMP_TOLERANCE_SECONDS) {
    return false;
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(timestampText + '.')
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function findOrderId(content) {
  const normalized = normalizeContent(content);
  const match = normalized.match(/TVLH(TV[A-HJ-NP-Z2-9]{11})/);
  return match ? match[1] : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return reply(res, 405, { success: false, message: 'Method not allowed' });
  }

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    return reply(res, 413, { success: false, message: 'Payload too large' });
  }

  try {
    if (!verifySePaySignature(req, rawBody)) {
      return reply(res, 401, { success: false, message: 'Invalid SePay signature or timestamp' });
    }

    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch (_) {
      return reply(res, 400, { success: false, message: 'Invalid JSON payload' });
    }

    const eventId = String(event.id ?? '').trim();
    if (!eventId) {
      return reply(res, 400, { success: false, message: 'Missing SePay transaction id' });
    }

    // This webhook is configured for incoming transfers only.
    if (String(event.transferType || '').toLowerCase() !== 'in') {
      return reply(res, 200, { success: true });
    }

    const db = redis();
    const transactionKey = 'tv:sepay:txn:' + eventId;
    const previouslyProcessed = await db.get(transactionKey);
    if (previouslyProcessed) {
      return reply(res, 200, { success: true });
    }

    const orderId = findOrderId(event.content || '');
    const bankAccount = String(event.accountNumber || '').replace(/\s/g, '');
    const expectedAccount = String(process.env.VIETQR_BANK_ACCOUNT || '').replace(/\s/g, '');
    const amount = Number(event.transferAmount);

    // A real transfer without an application order is recorded but never unlocks content.
    if (!orderId || !Number.isSafeInteger(amount) || amount <= 0 ||
        !expectedAccount || bankAccount !== expectedAccount) {
      await db.set('tv:sepay:event:' + eventId, {
        eventId,
        orderId,
        transferType: event.transferType || '',
        transferAmount: Number.isFinite(amount) ? amount : null,
        accountNumber: bankAccount,
        content: String(event.content || '').slice(0, 500),
        receivedAt: Date.now(),
        result: !orderId ? 'no_order_code' : 'account_or_amount_invalid'
      }, { ex: 30 * DAY });
      return reply(res, 200, { success: true });
    }

    const orderKey = 'tv:order:' + orderId;
    const order = await db.get(orderKey);
    if (!order) {
      await db.set('tv:sepay:event:' + eventId, {
        eventId, orderId, transferAmount: amount, accountNumber: bankAccount,
        content: String(event.content || '').slice(0, 500),
        receivedAt: Date.now(), result: 'order_not_found'
      }, { ex: 30 * DAY });
      return reply(res, 200, { success: true });
    }

    if (amount !== Number(order.amount)) {
      await db.set('tv:sepay:event:' + eventId, {
        eventId, orderId, transferAmount: amount, expectedAmount: Number(order.amount),
        accountNumber: bankAccount, content: String(event.content || '').slice(0, 500),
        receivedAt: Date.now(), result: 'amount_mismatch'
      }, { ex: 30 * DAY });
      return reply(res, 200, { success: true });
    }

    if (order.status === 'paid') {
      return reply(res, 200, { success: true });
    }

    // Claim transaction ID atomically so retries/replays cannot unlock twice.
    const claimed = await db.set(transactionKey, orderId, { ex: 90 * DAY, nx: true });
    if (!claimed) {
      return reply(res, 200, { success: true });
    }

    try {
      const transactionId = 'SEPAY-' + eventId;
      const paidOrder = {
        ...order,
        status: 'paid',
        transactionId,
        referenceNumber: String(event.referenceCode || ''),
        paidAt: Date.now(),
        bankaccount: bankAccount,
        transType: 'C',
        receivedContent: String(event.content || ''),
        paymentProvider: 'SEPAY',
        sepayTransactionId: eventId,
        sepayGateway: String(event.gateway || ''),
        sepayTransactionDate: String(event.transactionDate || '')
      };
      await db.set(orderKey, paidOrder, { ex: 90 * DAY });
      return reply(res, 200, { success: true });
    } catch (error) {
      await db.del(transactionKey);
      throw error;
    }
  } catch (error) {
    console.error('[SePay webhook]', error && error.message ? error.message : 'unknown error');
    return reply(res, 500, { success: false, message: 'Webhook processing failed' });
  }
};
