const { redis, json, method, verifyOrderProof, signLicenseToken } = require('../_lib/shared');
module.exports = async function handler(req, res) {
  if (!method(req,res,'GET')) return;
  try {
    const orderId = String(req.query.orderId || '').toUpperCase();
    const auth = String(req.headers.authorization || '');
    if (!/^TV[A-HJ-NP-Z2-9]{11}$/.test(orderId) || !auth.startsWith('Bearer ')) return json(res,400,{error:true,message:'Thiếu mã đơn hoặc quyền kiểm tra đơn.'});
    const proof = verifyOrderProof(auth.slice(7).trim(), orderId);
    if (!proof) return json(res,401,{error:true,message:'Mã kiểm tra đơn không hợp lệ hoặc đã hết hạn.'});
    const db = redis();
    const order = await db.get('tv:order:' + orderId);
    if (!order || order.deviceId !== proof.deviceId) return json(res,404,{error:true,message:'Không tìm thấy đơn hàng cho thiết bị này.'});
    if (order.status !== 'paid' && Date.now() > Number(order.expiresAt)) return json(res,200,{status:'expired'});
    if (order.status !== 'paid') return json(res,200,{status:'pending'});
    let licenseToken = order.licenseToken;
    if (!licenseToken) {
      licenseToken = signLicenseToken(order);
      order.licenseToken = licenseToken;
      await db.set('tv:order:' + orderId, order, { ex: 90*24*60*60 });
      const activeOrderId = await db.get('tv:active:' + order.deviceId);
      if (String(activeOrderId || '') === orderId) await db.del('tv:active:' + order.deviceId);
    }
    return json(res,200,{
      status:'paid', licenseToken,
      order:{orderId:order.orderId,pkg:order.pkg,targetId:order.targetId,deviceId:order.deviceId,amount:order.amount,requestCode:order.requestCode}
    });
  } catch (e) {
    console.error('[VietQR payment status]', e && e.message ? e.message : 'unknown error');
    return json(res,500,{error:true,message:e?.message || 'Không kiểm tra được trạng thái đơn hàng.'});
  }
};