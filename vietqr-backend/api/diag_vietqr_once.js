const { json, method, getVietQrToken, getEcommerceQrToken, redis } = require('./_lib/shared');
module.exports = async function handler(req,res) {
  if (!method(req,res,'GET')) return;
  if (String(req.query.key || '') !== 'vqr-once-20261122-5f9a2c') return json(res,404,{ok:false});
  const out = { redis:false, getToken:false, ecommerceSync:false, certificate:false };
  try { await redis().ping(); out.redis=true; } catch(e) { out.stage='redis'; out.message=String(e.message||'').slice(0,220); return json(res,200,out); }
  try { await getVietQrToken(); out.getToken=true; } catch(e) { out.stage='get-token'; out.message=String(e.message||'').slice(0,220); return json(res,200,out); }
  try { await getEcommerceQrToken(); out.ecommerceSync=true; } catch(e) {
    out.stage='ecommerce-sync'; out.message=String(e.message||'').slice(0,220);
    try { const v=await redis().get('tv:vietqr:ecommerce-setup'); out.certificate=!!(v&&v.certificate); if(v&&v.certificate) out.certificateValue=v.certificate; } catch(_) {}
  }
  return json(res,200,out);
};