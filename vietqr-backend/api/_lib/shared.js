const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

let redisClient;
function redis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('Thiếu Upstash Redis. Cần KV_REST_API_URL và KV_REST_API_TOKEN (hoặc UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).');
  }
  if (!redisClient) redisClient = new Redis({ url, token });
  return redisClient;
}
function json(res, status, data) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', process.env.APP_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  return res.json(data);
}
function method(req, res, expected) {
  if (req.method === 'OPTIONS') { json(res, 200, {}); return false; }
  if (req.method !== expected) { json(res, 405, { error: true, message: 'Method not allowed.' }); return false; }
  return true;
}
function b64url(value) { return Buffer.from(value).toString('base64url'); }
function timingSafeEqualString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function signJwt(payload, secret, algorithm = 'HS256') {
  const header = b64url(JSON.stringify({ alg: algorithm, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const data = header + '.' + body;
  const digest = algorithm === 'HS512' ? 'sha512' : 'sha256';
  const sig = crypto.createHmac(digest, secret).update(data).digest('base64url');
  return data + '.' + sig;
}
function verifyJwt(token, secret, allowedAlgorithms = ['HS256']) {
  if (!secret || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const data = parts[0] + '.' + parts[1];
  let header;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (_) { return null; }
  if (!allowedAlgorithms.includes(header.alg)) return null;
  const digest = header.alg === 'HS512' ? 'sha512' : 'sha256';
  const expected = crypto.createHmac(digest, secret).update(data).digest();
  let actual;
  try { actual = Buffer.from(parts[2], 'base64url'); } catch (_) { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || !Number.isFinite(payload.exp) || payload.exp < Math.floor(Date.now()/1000)) return null;
    return payload;
  } catch (_) { return null; }
}
function basicCredentials(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return null;
  try {
    const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const i = decoded.indexOf(':');
    if (i < 0) return null;
    return { username: decoded.slice(0, i), password: decoded.slice(i + 1) };
  } catch (_) { return null; }
}
function getCallbackCredentials() {
  return {
    username: process.env.VIETQR_CALLBACK_USERNAME || '',
    password: process.env.VIETQR_CALLBACK_PASSWORD || ''
  };
}
function callbackSecret() {
  const secret = process.env.VIETQR_CALLBACK_JWT_SECRET || '';
  if (secret && Buffer.byteLength(secret, 'utf8') < 32) throw new Error('VIETQR_CALLBACK_JWT_SECRET phải có ít nhất 32 bytes.');
  return secret;
}
function createCallbackBearer() {
  const now = Math.floor(Date.now()/1000);
  return signJwt({ iat: now, exp: now + 300, sub: 'vietqr-callback' }, callbackSecret(), 'HS512');
}
function validateCallbackBearer(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return false;
  const p = verifyJwt(h.slice(7).trim(), callbackSecret(), ['HS512']);
  return !!(p && p.sub === 'vietqr-callback');
}
function orderTokenSecret() {
  const secret = process.env.ORDER_TOKEN_SECRET || '';
  if (secret && Buffer.byteLength(secret, 'utf8') < 32) throw new Error('ORDER_TOKEN_SECRET phải có ít nhất 32 bytes.');
  return secret;
}
function makeOrderProof(orderId, deviceId, exp) {
  if (!orderTokenSecret()) throw new Error('Thiếu ORDER_TOKEN_SECRET trên Vercel.');
  const now = Math.floor(Date.now()/1000);
  return signJwt({ sub:'payment-order', orderId, deviceId, iat:now, exp }, orderTokenSecret());
}
function verifyOrderProof(token, orderId) {
  const p = verifyJwt(token, orderTokenSecret());
  return p && p.sub === 'payment-order' && p.orderId === orderId ? p : null;
}
function randomFromAlphabet(n) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
function normalizeContent(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
}
function envRequired(name) {
  const v = process.env[name];
  if (!v) throw new Error('Thiếu cấu hình máy chủ: ' + name);
  return v;
}
function envFirst(names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error('Thiếu cấu hình máy chủ: ' + names.join(' hoặc '));
}
function generateSePayQr(order) {
  const account = envFirst(['SEPAY_BANK_ACCOUNT', 'VIETQR_BANK_ACCOUNT']);
  const bank = envFirst(['SEPAY_BANK_CODE', 'VIETQR_BANK_CODE']);
  if (!/^\d{6,19}$/.test(account)) throw new Error('Số tài khoản MB Bank cấu hình không hợp lệ.');
  if (!/^[A-Z0-9]{2,20}$/i.test(bank)) throw new Error('Mã ngân hàng cấu hình không hợp lệ.');
  if (!Number.isSafeInteger(Number(order.amount)) || Number(order.amount) <= 0) {
    throw new Error('Số tiền tạo QR không hợp lệ.');
  }
  const memo = String(order.content || '').trim();
  if (!/^TVLHTV[A-HJ-NP-Z2-9]{11}$/.test(memo)) {
    throw new Error('Nội dung chuyển khoản không hợp lệ.');
  }
  const base = process.env.SEPAY_QR_IMAGE_BASE || 'https://vietqr.app/img';
  const url = new URL(base);
  url.searchParams.set('acc', account);
  url.searchParams.set('bank', bank);
  url.searchParams.set('amount', String(Math.round(Number(order.amount))));
  url.searchParams.set('des', memo);
  return { qrImage: url.toString(), qrLink: '', provider: 'SEPAY' };
}

function privateKeyPem() {
  if (process.env.LICENSE_RSA_PRIVATE_KEY_B64) return Buffer.from(process.env.LICENSE_RSA_PRIVATE_KEY_B64, 'base64').toString('utf8');
  if (process.env.LICENSE_RSA_PRIVATE_KEY) return process.env.LICENSE_RSA_PRIVATE_KEY.replace(/\\n/g,'\n');
  throw new Error('Thiếu LICENSE_RSA_PRIVATE_KEY_B64 trên Vercel.');
}
function signLicenseToken(order) {
  const payload = {
    v:1, req:order.requestCode, deviceId:order.deviceId, pkg:order.pkg, target:order.targetId,
    issuedAt:Date.now(), jti:'VQR' + order.orderId + order.transactionId.slice(-8)
  };
  const bytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = crypto.sign('RSA-SHA256', bytes, privateKeyPem());
  return 'TV27.' + bytes.toString('base64url') + '.' + signature.toString('base64url');
}
function responseOk(res, refId) {
  return json(res, 200, { error:false, errorReason:null, toastMessage:'Transaction processed successfully', object:{ reftransactionid:String(refId || 'VietQR') } });
}
function responseError(res, status, reason, message) {
  return json(res, status, { error:true, errorReason:reason, toastMessage:message, object:null });
}
module.exports = {
  redis, json, method, timingSafeEqualString, basicCredentials, getCallbackCredentials,
  callbackSecret, createCallbackBearer, validateCallbackBearer, orderTokenSecret,
  makeOrderProof, verifyOrderProof, randomFromAlphabet, normalizeContent, envRequired,
  generateSePayQr, signLicenseToken, responseOk, responseError
};