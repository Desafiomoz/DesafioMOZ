/**
 * AURAVIA – compra e-Mola (Cloudflare Pages Function)
 * POST /api/auravia-compra
 * Body: { email, item, txId, valor?, nome? }
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

const PRECOS = {
  fu: 10,
  sh: 5,
  mg: 10,   /* Ímã — só MT */
  tu: 4,
  lt: 15,
  nt: 30,
  pk: 30,
  x2: 20,
  inf: 50,
  open10: 20,
  c200: 10,
  world: 150,
  inf7: 200,
  skin0: 2, skin1: 2, skin2: 2, skin3: 2, skin4: 2, skin5: 2,
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function emailValido(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email || email.length > 120) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
function normalizarTxId(s) {
  return String(s || '').trim().replace(/\s+/g, '').toUpperCase();
}
function txIdValido(txId) {
  if (!txId || txId.length < 12 || txId.length > 64) return false;
  if (!txId.startsWith('PP')) return false;
  return /^PP[A-Z0-9.\-_]+$/i.test(txId);
}
function b64url(input) {
  let bytes;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = new Uint8Array(input);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function parseServiceAccount(raw) {
  let sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!sa || !sa.private_key || !sa.client_email || !sa.project_id)
    throw new Error('Service account incompleta');
  let pk = String(sa.private_key).replace(/\\n/g, '\n');
  if (!pk.includes('BEGIN PRIVATE KEY')) throw new Error('private_key inválida');
  sa.private_key = pk;
  return sa;
}
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email, sub: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const unsigned = header + '.' + claim;
  const pemBody = sa.private_key.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', binary.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = unsigned + '.' + b64url(signature);
  const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + encodeURIComponent(jwt);
  const tokRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error('Token Google falhou');
  return tok.access_token;
}
function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}
async function fsGet(token, projectId, path) {
  const r = await fetch(`${fsBase(projectId)}/${path}`, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('FS GET ' + r.status);
  return r.json();
}
async function fsPatch(token, projectId, path, fields, mask) {
  let url = `${fsBase(projectId)}/${path}`;
  if (mask && mask.length) {
    url += '?' + mask.map((f) => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  }
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('FS PATCH ' + path + ' ' + r.status);
  return r.json();
}
async function fsCreate(token, projectId, collection, docId, fields) {
  const url = `${fsBase(projectId)}/${collection}?documentId=` + encodeURIComponent(docId);
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (r.status === 409) throw new Error('TX_JA_USADO');
  if (!r.ok) throw new Error('FS CREATE ' + r.status + ' ' + (await r.text()));
  return r.json();
}
function strField(s) { return { stringValue: String(s ?? '') }; }
function numField(n) { return { integerValue: String(Math.floor(Number(n) || 0)) }; }

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, erro: 'Método inválido' }, 405);
  try {
    const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawSa) return json({ ok: false, erro: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    const sa = parseServiceAccount(rawSa);
    const token = await getAccessToken(sa);
    const projectId = sa.project_id;
    let body;
    try { body = await request.json(); } catch (e) { return json({ ok: false, erro: 'JSON inválido' }, 400); }
    const email = emailValido(body.email);
    if (!email) return json({ ok: false, erro: 'E-mail inválido' }, 400);
    const item = String(body.item || '').trim();
    if (!item) return json({ ok: false, erro: 'Item em falta' }, 400);
    const txId = normalizarTxId(body.txId);
    if (!txIdValido(txId)) return json({ ok: false, erro: 'ID de transacção inválido (deve começar por PP)' }, 400);
    let mt = PRECOS[item];
    if (mt == null) mt = Math.floor(Number(body.valor) || 0);
    if (!mt || mt < 1) return json({ ok: false, erro: 'Item ou valor inválido' }, 400);

    // Idempotência: cada TX só uma vez
    try {
      await fsCreate(token, projectId, 'emolaTransacoes', txId, {
        email: strField(email),
        item: strField(item),
        jogo: strField('auravia'),
        mt: numField(mt),
        createdAt: strField(new Date().toISOString()),
        via: strField('api-auravia-compra'),
      });
    } catch (e) {
      if (e.message === 'TX_JA_USADO')
        return json({ ok: false, erro: 'Este ID de transacção já foi usado.' }, 409);
      throw e;
    }

    const logId = 'av_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    try {
      await fsCreate(token, projectId, 'pagamentosManuais', logId, {
        jogo: strField('auravia'),
        origem: strField('AURAVIA'),
        email: strField(email),
        item: strField(item),
        label: strField('[AURAVIA] ' + (body.nome || item)),
        mt: numField(mt),
        txId: strField(txId),
        status: strField('entregue'),
        createdAt: strField(new Date().toISOString()),
        via: strField('api-auravia-compra'),
      });
    } catch (eLog) {}


    // Aplica o item no progresso da conta (auraviaEstado)
    try {
      const stPath = 'auraviaEstado/' + encodeURIComponent(email);
      const stDoc = await fsGet(token, projectId, stPath);
      let st = {
        lv: 1, maxLv: 1, orbs: 0, coins: 0, sh: 0, mg: 0, tu: 0, lt: 0, nt: 0,
        x2: 0, mo: 0, ag: 0, te: 0, fuel: 4, lock: 0, inf: 0, skin: 0, own: [0],
        vol: 0.6, ctl: 0, glow: 1, dn: '', progV: 2,
      };
      if (stDoc && stDoc.fields && stDoc.fields.stateJson && stDoc.fields.stateJson.stringValue) {
        try { st = Object.assign(st, JSON.parse(stDoc.fields.stateJson.stringValue)); } catch (e) {}
      }
      if (item === 'pk') st.orbs = (st.orbs || 0) + 100;
      else if (item === 'c200') st.coins = (st.coins || 0) + 200;
      else if (item === 'x2') st.x2 = 1;
      else if (item === 'fu') { st.fuel = 4; st.lock = 0; }
      else if (item === 'inf') st.inf = Math.max(Date.now(), st.inf || 0) + 24 * 3600 * 1000;
      else if (item === 'inf7') st.inf = Math.max(Date.now(), st.inf || 0) + 7 * 24 * 3600 * 1000;
      else if (item === 'open10') st.maxLv = Math.min(1100, (st.maxLv || 1) + 10);
      else if (item === 'world') {
        const lv = st.lv || 1;
        const wi = Math.floor((lv - 1) / 92) % 12;
        st.maxLv = Math.min(1100, (wi + 1) * 92);
      } else if (String(item).indexOf('skin') === 0) {
        const si = parseInt(String(item).replace('skin', ''), 10);
        if (!isNaN(si)) {
          if (!Array.isArray(st.own)) st.own = [0];
          if (st.own.indexOf(si) < 0) st.own.push(si);
          st.skin = si;
        }
      } else if (['sh', 'mg', 'tu', 'lt', 'nt'].indexOf(item) >= 0) {
        st[item] = (st[item] || 0) + 1;
      }
      const fields = {
        stateJson: strField(JSON.stringify(st)),
        email: strField(email),
        maxLv: numField(st.maxLv),
        lv: numField(st.lv),
        orbs: numField(st.orbs),
        coins: numField(st.coins),
        updatedAt: numField(Date.now()),
      };
      if (stDoc) {
        await fsPatch(token, projectId, stPath, fields, Object.keys(fields));
      } else {
        await fsCreate(token, projectId, 'auraviaEstado', email, fields);
      }
    } catch (eSt) {
      console.log('auraviaEstado grant', eSt && eSt.message);
    }

    return json({ ok: true, item, mt, email, mensagem: 'Pagamento registado. Item entregue na conta.' });
  } catch (e) {
    return json({ ok: false, erro: e && e.message ? e.message : String(e) }, 500);
  }
}
