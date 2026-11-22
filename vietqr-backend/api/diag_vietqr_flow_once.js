const { json, method, getVietQrToken, getEcommerceQrToken, redis } = require('./_lib/shared');

module.exports = async function handler(req,res) {
  if (!method(req,res,'GET')) return;
  const token = String(req.query.key || '');
  if (token !== 'vqrdiag-2026-11-22-79f2bc8a4d72') {
    return json(res,404,{ok:false});
  }
  const out = { getToken:false, ecommerceSync:false, redis:false, requiresBankSync:false };
  try {
    const db = redis();
    await db.ping();
    out.redis = true;
  } catch (e) {
    out.errorStage = 'Redis';
    out.message = String(e.message || 'Redis unavailable').slice(0,220);
    return json(res,200,out);
  }
  try {
    await getVietQrToken();
    out.getToken = true;
  } catch (e) {
    out.errorStage = 'Get Token';
    out.message = String(e.message || 'Get Token failed').slice(0,220);
    return json(res,200,out);
  }
  try {
    await getEcommerceQrToken();
    out.ecommerceSync = true;
  } catch (e) {
    out.errorStage = 'Ecommerce Sync';
    out.message = String(e.message || 'Ecommerce Sync failed').slice(0,220);
    try {
      const setup = await redis().get('tv:vietqr:ecommerce-setup');
      out.requiresBankSync = !!(setup && setup.certificate);
    } catch (_) {}
  }
  return json(res,200,out);
};