const { json, method, basicCredentials, getCallbackCredentials, timingSafeEqualString, callbackSecret, createCallbackBearer } = require('./_lib/shared');
module.exports = async function handler(req, res) {
  if (!method(req,res,'POST')) return;
  try {
    const received = basicCredentials(req);
    const expected = getCallbackCredentials();
    if (!received || !expected.username || !expected.password ||
        !timingSafeEqualString(received.username,expected.username) || !timingSafeEqualString(received.password,expected.password)) {
      return json(res,401,{status:'FAILED',message:'UNAUTHORIZED'});
    }
    if (!callbackSecret()) return json(res,500,{status:'FAILED',message:'CALLBACK_SECRET_NOT_CONFIGURED'});
    return json(res,200,{access_token:createCallbackBearer(),token_type:'Bearer',expires_in:300});
  } catch (e) {
    console.error('[VietQR get-token]', e && e.message ? e.message : 'unknown error');
    return json(res,500,{status:'FAILED',message:'TOKEN_GENERATION_FAILED'});
  }
};