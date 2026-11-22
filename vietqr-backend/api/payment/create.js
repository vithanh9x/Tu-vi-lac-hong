const { redis, json, method, randomFromAlphabet, makeOrderProof, generateSePayQr } = require('../_lib/shared');
const ALLOWED = new Set(['menh','phumau','phucduc','dientrach','quanloc','noboc','thiendi','tatach','taibach','tutuc','phuthe','huynhde']);
module.exports = async function handler(req, res) {
  if (!method(req,res,'POST')) return;
  try {
    const body = req.body || {};
    const pkg = body.pkg;
    const targetInput = String(body.targetId || '').trim();
    const targetId = targetInput.toUpperCase() === 'FULL' ? 'FULL' : targetInput.toLowerCase();
    const deviceId = String(body.deviceId || '').toUpperCase();
    if (!['5k','10k'].includes(pkg)) return json(res,400,{error:true,message:'Gói thanh toán không hợp lệ.'});
    if (!/^[A-F0-9-]{20,40}$/.test(deviceId)) return json(res,400,{error:true,message:'Mã thiết bị không hợp lệ.'});
    if (pkg === '5k' && !ALLOWED.has(targetId)) return json(res,400,{error:true,message:'Cung cần mở khóa không hợp lệ.'});
    if (pkg === '10k' && targetId !== 'FULL') return json(res,400,{error:true,message:'Gói FULL phải có targetId=FULL.'});
    const amount = pkg === '5k' ? 5000 : 10000;
    const db = redis();
    const activeKey = 'tv:active:' + deviceId;
    const activeOrderId = await db.get(activeKey);
    if (activeOrderId) {
      const existing = await db.get('tv:order:' + String(activeOrderId));
      if (existing && (existing.status === 'paid' || (existing.paymentProvider === 'SEPAY' && Date.now() <= Number(existing.expiresAt)))) {
        const proof = makeOrderProof(existing.orderId, existing.deviceId, Math.floor(Number(existing.expiresAt)/1000) + 86400);
        return json(res,200,{
          ok:true, reused:true, orderId:existing.orderId, amount:existing.amount,
          content:existing.content, requestCode:existing.requestCode, deviceId:existing.deviceId,
          pkg:existing.pkg, targetId:existing.targetId, qrImage:existing.qrImage,
          qrLink:existing.qrLink || '', orderToken:proof, expiresAt:existing.expiresAt
        });
      }
      await db.del(activeKey);
    }
    const rateKey = 'tv:create-rate:' + deviceId;
    const rateCount = await db.incr(rateKey);
    if (rateCount === 1) await db.expire(rateKey, 600);
    if (rateCount > 8) return json(res,429,{error:true,message:'Bạn tạo quá nhiều đơn trong thời gian ngắn. Vui lòng thử lại sau 10 phút.'});
    const orderId = 'TV' + randomFromAlphabet(11);
    const content = 'TVLH' + orderId;
    const requestCode = 'REQ-' + randomFromAlphabet(16);
    const now = Date.now();
    const order = {
      orderId, pkg, targetId, deviceId, amount, content, requestCode,
      status:'pending', paymentProvider:'SEPAY', createdAt:now, expiresAt:now + 30*60*1000,
      transactionId:null, referenceNumber:null, paidAt:null
    };
    const qr = generateSePayQr(order);
    const saved = await db.set('tv:order:' + orderId, { ...order, qrImage:qr.qrImage, qrLink:qr.qrLink }, { ex: 86400, nx:true });
    if (!saved) throw new Error('Mã đơn hàng bị trùng, vui lòng tạo lại.');
    await db.set(activeKey, orderId, { ex: 86400 });
    const proof = makeOrderProof(orderId, deviceId, Math.floor(order.expiresAt/1000) + 86400);
    return json(res,200,{
      ok:true, orderId, amount, content, requestCode, deviceId, pkg, targetId,
      qrImage:qr.qrImage, qrLink:qr.qrLink, orderToken:proof, expiresAt:order.expiresAt
    });
  } catch (e) {
    console.error('[SePay create-order]', e && e.message ? e.message : 'unknown error');
    return json(res,500,{error:true,message:e?.message || 'Không thể tạo đơn thanh toán SePay.'});
  }
};