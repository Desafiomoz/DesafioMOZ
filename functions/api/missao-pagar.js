/**
 * Desafio MOZ – Missão semanal: pagamento e-Mola +150 pts
 * POST /api/missao-pagar
 * Body: { email, txId, telefone, semanaId? }
 * Secret: FIREBASE_SERVICE_ACCOUNT
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};
const PTS = 150;
const MT = 2;
const TEL_DESTINO = '878037104';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}
function b64url(input) {
  let bytes;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = new Uint8Array(input);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function parseServiceAccount(raw) {
  let sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let pk = String(sa.private_key).replace(/\\n/g, '\n');
  sa.private_key = pk;
  return sa;
}
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      scope:
        'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = header + '.' + claim;
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + '.' + b64url(signature);
  const body =
    'grant_type=' +
    encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
    '&assertion=' +
    encodeURIComponent(jwt);
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error('Falha token');
  return tok.access_token;
}
function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}
function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toFsValue(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function fromFsValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('mapValue' in v) {
    const f = (v.mapValue && v.mapValue.fields) || {};
    const o = {};
    for (const k of Object.keys(f)) o[k] = fromFsValue(f[k]);
    return o;
  }
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromFsValue);
  return null;
}
function docToData(doc) {
  if (!doc || !doc.fields) return {};
  const o = {};
  for (const k of Object.keys(doc.fields)) o[k] = fromFsValue(doc.fields[k]);
  return o;
}
function docIdFromName(name) {
  return (name || '').split('/').pop();
}
async function fsGet(token, projectId, path) {
  const r = await fetch(`${fsBase(projectId)}/${path}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GET ' + r.status);
  return r.json();
}
async function fsPatch(token, projectId, path, fields, mask) {
  let url = `${fsBase(projectId)}/${path}`;
  if (mask && mask.length)
    url += '?' + mask.map((f) => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  const r = await fetch(url, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('PATCH ' + r.status + ' ' + (await r.text()));
  return r.json();
}
async function fsCreateDoc(token, projectId, path, fields) {
  // create with specific ID: PATCH without mask creates if missing in some cases;
  // use documents:commit or POST with documentId
  const parts = path.split('/');
  const collection = parts[0];
  const docId = parts[1];
  const url =
    `${fsBase(projectId)}/${collection}?documentId=` + encodeURIComponent(docId);
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) {
    const txt = await r.text();
    if (r.status === 409 || txt.indexOf('ALREADY_EXISTS') !== -1)
      throw new Error('Este ID já foi usado. Cada ID só funciona uma vez.');
    throw new Error('CREATE ' + r.status + ' ' + txt);
  }
  return r.json();
}
async function fsCreate(token, projectId, collection, fields) {
  const r = await fetch(`${fsBase(projectId)}/${collection}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('CREATE ' + r.status + ' ' + (await r.text()));
  return r.json();
}
async function fsQuery(token, projectId, collection, field, value) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          fieldFilter: {
            field: { fieldPath: field },
            op: 'EQUAL',
            value: toFsValue(value),
          },
        },
        limit: 1,
      },
    }),
  });
  if (!r.ok) throw new Error('QUERY ' + r.status);
  const rows = await r.json();
  const out = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row.document)
        out.push({
          id: docIdFromName(row.document.name),
          path: row.document.name.replace(/^.*\/documents\//, ''),
          data: docToData(row.document),
        });
    }
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS')
    return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET')
    return json({ ok: true, msg: 'missao-pagar API. Usa POST.' });
  if (request.method !== 'POST') return json({ ok: false, erro: 'Só POST' }, 405);

  let sa;
  try {
    if (!env.FIREBASE_SERVICE_ACCOUNT)
      return json({ ok: false, erro: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    sa = parseServiceAccount(env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    return json({ ok: false, erro: 'Secret inválido' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, erro: 'JSON inválido' }, 400);
  }

  const email = String(body.email || '')
    .trim()
    .toLowerCase();
  let txId = String(body.txId || body.txid || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
  let tel = String(body.telefone || body.tel || '').replace(/\D/g, '');
  if (tel.length === 12 && tel.indexOf('258') === 0) tel = tel.slice(3);
  const semanaId = String(body.semanaId || '').trim();

  if (!email || email.indexOf('@') === -1)
    return json({ ok: false, erro: 'E-mail inválido' }, 400);
  if (!/^PP[A-Z0-9.\-]{5,40}$/i.test(txId))
    return json({ ok: false, erro: 'ID inválido (deve começar por PP)' }, 400);
  if (!/^8\d{8}$/.test(tel))
    return json({ ok: false, erro: 'Número inválido (ex: 841234567)' }, 400);

  try {
    const token = await getAccessToken(sa);
    const projectId = sa.project_id;

    const users = await fsQuery(token, projectId, 'usuarios', 'email', email);
    if (!users.length) return json({ ok: false, erro: 'Utilizador não encontrado' }, 404);
    const user = users[0];
    const d = user.data || {};

    if (d.missaoSemanalCompleta === true && d.missaoSemanaId === semanaId)
      return json({ ok: true, jaFeito: true, pontos: d.pontos || 0, msg: 'Missão já concluída' });

    if (!d.missaoInfOk || !d.missaoWhatsappOk)
      return json(
        { ok: false, erro: 'Completa primeiro influencer e WhatsApp' },
        400
      );

    // Reserva txId (falha se já existir)
    await fsCreateDoc(token, projectId, 'emolaTransacoes/' + txId, {
      email: toFsValue(email),
      telefone: toFsValue(tel),
      item: toFsValue('missao_2_pts150'),
      jogo: toFsValue('missao_semanal'),
      mt: toFsValue(MT),
      descricao: toFsValue('Missão semanal +150 pts'),
      createdAt: toFsValue(new Date().toISOString()),
    });

    const ptsAntes = Number(d.pontos || 0);
    const novos = ptsAntes + PTS;
    let encontradas = Number(d.missoesSemanaisEncontradas || 0);
    if (d.missaoSemanaId !== semanaId) encontradas += 1;

    const update = {
      pontos: novos,
      missaoSemanaId: semanaId || d.missaoSemanaId || '',
      missaoSemanalCompleta: true,
      missaoLiberada: false,
      missaoBloqueadaApos: true,
      missaoConcluida: true,
      missaoPagamentoTxid: txId,
      missaoPagamentoTel: tel,
      missaoPagamentoMt: MT,
      missaoPontosCreditados: PTS,
      missoesSemanaisEncontradas: encontradas,
      ultimaAtualizacao: new Date().toISOString(),
    };
    const fields = {};
    const mask = [];
    for (const k of Object.keys(update)) {
      fields[k] = toFsValue(update[k]);
      mask.push(k);
    }
    await fsPatch(token, projectId, user.path, fields, mask);

    // logs admin
    try {
      await fsCreate(token, projectId, 'emolaUpgrades', {
        email: toFsValue(email),
        nome: toFsValue(d.nome || ''),
        txid: toFsValue(txId),
        telefone: toFsValue(tel),
        telefoneDestino: toFsValue(TEL_DESTINO),
        pacote: toFsValue('missao_2_pts150'),
        valorMt: toFsValue(MT),
        detalhe: toFsValue('Missão semanal +150 pts'),
        pontosCreditados: toFsValue(PTS),
        girosCreditados: toFsValue(0),
        status: toFsValue('entregue'),
        createdAt: toFsValue(new Date().toISOString()),
      });
    } catch (e) {}
    try {
      await fsCreate(token, projectId, 'pagamentosManuais', {
        jogo: toFsValue('missao_semanal'),
        email: toFsValue(email),
        item: toFsValue('missao_2_pts150'),
        label: toFsValue('Missão semanal +150 pts'),
        mt: toFsValue(MT),
        txId: toFsValue(txId),
        telefone: toFsValue(tel),
        status: toFsValue('entregue'),
        createdAt: toFsValue(new Date().toISOString()),
      });
    } catch (e) {}
    try {
      await fsCreate(token, projectId, 'historicoPontos', {
        email: toFsValue(email),
        pontos: toFsValue(PTS),
        origem: toFsValue('missao_semanal'),
        detalhe: toFsValue('Missão semanal completa +150 pts'),
        dia: toFsValue(new Date().toISOString().slice(0, 10)),
        createdAt: toFsValue(new Date().toISOString()),
      });
    } catch (e) {}

    return json({ ok: true, pontos: novos, ganho: PTS, jaFeito: false });
  } catch (e) {
    return json(
      { ok: false, erro: e && e.message ? e.message : String(e) },
      500
    );
  }
}
