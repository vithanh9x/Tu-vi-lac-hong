const crypto = require('crypto');
const { Redis } = require('@upstash/redis');
const QRCode = require('qrcode');

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
async function getVietQrToken() {
  const base = (process.env.VIETQR_API_BASE || 'https://api.vietqr.org').replace(/[/]+$/,'');
  const username = envRequired('VIETQR_API_USERNAME');
  const password = envRequired('VIETQR_API_PASSWORD');
  const auth = Buffer.from(username + ':' + password, 'utf8').toString('base64');
  const response = await fetch(base + '/vqr/api/peripheral/ecommerce/token_generate', {
    method:'POST',
    headers:{ 'Authorization':'Basic ' + auth, 'Content-Type':'application/json; charset=UTF-8', 'Accept':'application/json' }
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok || data.status === 'FAILED' || data.error === true) {
    throw new Error('VietQR Get Token HTTP ' + response.status + ': ' + String(data.message || data.desc || 'Không có thông báo chi tiết').slice(0,300));
  }
  const token = data.access_token || data.data?.access_token;
  if (!token) throw new Error('VietQR Get Token không trả về access_token.');
  return { token, password };
}
async function getEcommerceQrToken() {
  const db = redis();
  const cacheKey = 'tv:vietqr:ecommerce-access-token';
  const cached = await db.get(cacheKey);
  if (cached && cached.accessToken && Number(cached.expiresAt) > Date.now() + 15000) return cached.accessToken;

  const { token: initialToken, password } = await getVietQrToken();
  const base = (process.env.VIETQR_API_BASE || 'https://api.vietqr.org').replace(/[/]+$/,'');
  const ecommerceSite = envRequired('VIETQR_PUBLIC_ORIGIN').replace(/[/]+$/,'');
  const basePath = (process.env.VIETQR_BASE_PATH || '/vqr').replace(/[/]+$/,'');
  const webhook = ecommerceSite + basePath + '/bank/api/transaction-sync';
  const checkSum = crypto.createHash('md5')
    .update(password + ':' + ecommerceSite + 'VietQRAccesskey', 'utf8')
    .digest('hex');
  const payload = { ecommerceSite, checkSum, webhook };
  if (process.env.VIETQR_ECOMMERCE_CODE) payload.code = process.env.VIETQR_ECOMMERCE_CODE;

  async function requestEcommerce(headers) {
    const response = await fetch(base + '/vqr/api/ecommerce', {
      method:'POST',
      headers:{ ...headers, 'Content-Type':'application/json; charset=UTF-8', 'Accept':'application/json' },
      body:JSON.stringify(payload)
    });
    const data = await response.json().catch(()=>({}));
    return { response, data };
  }
  // VietQR API's detailed Ecommerce Sync endpoint specifies Basic Authentication.
  // The overview Host-to-Client page also shows Bearer; use Basic first, with Bearer fallback.
  async function requestEcommerce(headers) {
    const response = await fetch(base + '/vqr/api/ecommerce', {
      method:'POST',
      headers:{ ...headers, 'Content-Type':'application/json; charset=UTF-8', 'Accept':'application/json' },
      body:JSON.stringify(payload)
    });
    const data = await response.json().catch(()=>({}));
    return { response, data };
  }
  let result = await requestEcommerce({
    'Authorization':'Basic ' + Buffer.from(envRequired('VIETQR_API_USERNAME') + ':' + password, 'utf8').toString('base64')
  });
  if ((result.response.status === 401 || result.response.status === 403 ||
       (result.response.status === 400 && result.data.message === 'E05')) &&
      !result.data.token?.access_token) {
    result = await requestEcommerce({ 'Authorization':'Bearer ' + initialToken });
  }
  const { response, data } = result;
  if (!response.ok || data.status === 'FAILED' || data.error === true) {
    throw new Error('VietQR Ecommerce Sync HTTP ' + response.status + ': ' + String(data.message || data.desc || 'Không có thông báo chi tiết').slice(0,300));
  }
  const accessToken = data.token?.access_token || data.data?.token?.access_token || data.access_token;
  if (!accessToken) {
    if (data.certificate || data.clientId) {
      await db.set('tv:vietqr:ecommerce-setup', {
        certificate: data.certificate || null, clientId: data.clientId || null,
        ecommerceSite, webhook, updatedAt: Date.now()
      }, { ex: 90*24*60*60 });
    }
    throw new Error('VietQR Ecommerce Sync chưa trả token tạo QR. ' +
      (data.certificate ? 'VietQR đã cấp certificate; cần hoàn tất đồng bộ tài khoản ngân hàng trong ứng dụng VietQR.' : 'Cần kiểm tra trạng thái Merchant/Ecommerce với VietQR.'));
  }
  const expiresIn = Number(data.token?.expires_in || data.data?.token?.expires_in || 300);
  const cacheTtl = Math.max(30, Math.min(240, (expiresIn > 0 ? expiresIn : 300) - 30));
  await db.set(cacheKey, { accessToken, expiresAt: Date.now() + cacheTtl * 1000 }, { ex: cacheTtl });
  if (data.certificate || data.clientId) {
    await db.set('tv:vietqr:ecommerce-setup', {
      certificate: data.certificate || null, clientId: data.clientId || null,
      ecommerceSite, webhook, updatedAt: Date.now()
    }, { ex: 90*24*60*60 });
  }
  return accessToken;
}
async function generateVietQr(order) {
  const base = (process.env.VIETQR_API_BASE || 'https://api.vietqr.org').replace(/[/]+$/,'');
  const payload = {
    bankCode: envRequired('VIETQR_BANK_CODE'),
    bankAccount: envRequired('VIETQR_BANK_ACCOUNT'),
    userBankName: envRequired('VIETQR_ACCOUNT_NAME'),
    content: order.content,
    qrType: 0,
    amount: order.amount,
    orderId: order.orderId,
    transType: 'C',
    reconciliation: true
  };
  const token = await getEcommerceQrToken();
  const response = await fetch(base + '/vqr/api/qr/generate-customer', {
    method:'POST',
    headers:{ 'Authorization':'Bearer ' + token, 'Content-Type':'application/json; charset=UTF-8', 'Accept':'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok || data.status === 'FAILED' || data.error === true) {
    throw new Error('VietQR Generate QR HTTP ' + response.status + ': ' + String(data.message || data.desc || 'Không có thông báo chi tiết').slice(0,300));
  }
  const rawQr = typeof data.qrCode === 'string' ? data.qrCode : (typeof data.qrPayload === 'string' ? data.qrPayload : '');
  let qrImage = '';
  if (rawQr && rawQr.length > 12 && !rawQr.startsWith('https://') && !rawQr.startsWith('http://') && !rawQr.startsWith('data:image/')) {
    qrImage = await QRCode.toDataURL(rawQr, { errorCorrectionLevel:'M', margin:1, width:512 });
  } else if (rawQr.startsWith('data:image/')) {
    qrImage = rawQr;
  } else if (typeof data.qrLink === 'string' && data.qrLink.startsWith('https://')) {
    qrImage = data.qrLink;
  }
  if (!qrImage) throw new Error('VietQR Generate QR thành công nhưng response không có qrCode/qrLink hợp lệ.');
  return { qrImage, qrLink: typeof data.qrLink === 'string' ? data.qrLink : '', raw: data };
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
  getVietQrToken, getEcommerceQrToken, generateVietQr, signLicenseToken, responseOk, responseError
};