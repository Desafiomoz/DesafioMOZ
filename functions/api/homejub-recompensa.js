/**
 * Desafio MOZ – Homejub recompensa de nível (marcos)
 * URL: POST https://desafiomoz.pages.dev/api/homejub-recompensa
 * Body: { "email": "...", "nivel": 10 }
 * Secret: FIREBASE_SERVICE_ACCOUNT (mesmo da compra)
 *
 * Marcos: 10,20,30,50,100,150,250,300
 * Prémio em MT = diferença para o marco anterior; 1 MT = 10 pontos
 * Só credita UMA vez por marco (marcosPagos no jogoEstado).
 */

const MARCOS_NIVEL = [10, 20, 30, 50, 100, 150, 250, 300];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
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

function incrementoDoMarco(nivel) {
  const idx = MARCOS_NIVEL.indexOf(nivel);
  if (idx < 0) return 0;
  const anterior = idx > 0 ? MARCOS_NIVEL[idx - 1] : 0;
  return nivel - anterior;
}

function b64url(input) {
  let bytes;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = new Uint8Array(input);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseServiceAccount(raw) {
  let sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!sa || !sa.private_key || !sa.client_email || !sa.project_id) {
    throw new Error('Service account incompleta');
  }
  let pk = String(sa.private_key).replace(/\\n/g, '\n');
  if (!pk.includes('BEGIN PRIVATE KEY')) {
    throw new Error('private_key inválida');
  }
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
  if (!tok.access_token) {
    throw new Error('Falha token Google: ' + JSON.stringify(tok));
  }
  return tok.access_token;
}

function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function fsGet(token, projectId, path) {
  const r = await fetch(`${fsBase(projectId)}/${path}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('FS GET ' + path + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsPatch(token, projectId, path, fields, mask) {
  let url = `${fsBase(projectId)}/${path}`;
  if (mask && mask.length) {
    url += '?' + mask.map((f) => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  }
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('FS PATCH ' + path + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsCreate(token, projectId, collection, docId, fields) {
  const url =
    `${fsBase(projectId)}/${collection}?documentId=` + encodeURIComponent(docId);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (r.status === 409) return { already: true };
  if (!r.ok) throw new Error('FS CREATE ' + r.status + ' ' + (await r.text()));
  return r.json();
}

/** Pesquisa usuario por email (campo email) */
async function fsQueryUsuarioByEmail(token, projectId, email) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'usuarios' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'email' },
            op: 'EQUAL',
            value: { stringValue: email },
          },
        },
        limit: 1,
      },
    }),
  });
  if (!r.ok) throw new Error('FS QUERY ' + r.status + ' ' + (await r.text()));
  const rows = await r.json();
  if (!Array.isArray(rows) || !rows.length || !rows[0].document) return null;
  return rows[0].document;
}

function numField(n) {
  return { integerValue: String(Math.floor(Number(n) || 0)) };
}
function strField(s) {
  return { stringValue: String(s ?? '') };
}
function arrIntField(nums) {
  return {
    arrayValue: {
      values: (nums || []).map((n) => ({ integerValue: String(Math.floor(Number(n) || 0)) })),
    },
  };
}

function lerNum(doc, key, def = 0) {
  try {
    const f = doc.fields && doc.fields[key];
    if (!f) return def;
    if (f.integerValue != null) return parseInt(f.integerValue, 10) || def;
    if (f.doubleValue != null) return Number(f.doubleValue) || def;
    return def;
  } catch (e) {
    return def;
  }
}

function lerMarcosPagos(doc) {
  try {
    const f = doc.fields && doc.fields.marcosPagos;
    if (!f || !f.arrayValue || !f.arrayValue.values) return [];
    return f.arrayValue.values
      .map((v) => {
        if (v.integerValue != null) return parseInt(v.integerValue, 10);
        if (v.doubleValue != null) return Math.floor(Number(v.doubleValue));
        if (v.stringValue != null) return parseInt(v.stringValue, 10);
        return null;
      })
      .filter((n) => n != null && !isNaN(n));
  } catch (e) {
    return [];
  }
}

function docPathName(fullName) {
  // projects/.../documents/usuarios/xxx → usuarios/xxx
  const i = fullName.indexOf('/documents/');
  return i >= 0 ? fullName.slice(i + '/documents/'.length) : fullName;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, erro: 'Só POST' }, 405);
  }

  let sa;
  try {
    const raw = env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      return json({ ok: false, erro: 'Secret FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    }
    sa = parseServiceAccount(raw);
  } catch (e) {
    return json({ ok: false, erro: 'Secret inválido: ' + (e.message || e) }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, erro: 'JSON inválido' }, 400);
  }

  const email = emailValido(body.email);
  const nivel = Math.floor(Number(body.nivel) || 0);

  if (!email) return json({ ok: false, erro: 'Email inválido' }, 400);
  if (!MARCOS_NIVEL.includes(nivel)) {
    return json({ ok: false, erro: 'Nível não é um marco válido' }, 400);
  }

  const mt = incrementoDoMarco(nivel);
  const ptsAdd = mt * 10; // 10 pontos = 1 MT
  if (mt <= 0 || ptsAdd <= 0) {
    return json({ ok: false, erro: 'Prémio inválido' }, 400);
  }

  const projectId = sa.project_id;

  try {
    const token = await getAccessToken(sa);

    // 1) Estado do jogo — lista de marcos já pagos
    let estado = await fsGet(token, projectId, 'jogoEstado/' + email);
    let marcos = estado ? lerMarcosPagos(estado) : [];

    // Anti-fraude: o nível tem de estar realmente desbloqueado no servidor (as regras limitam o avanço a 1 nível / 20 s)
    const nivelServidor = estado ? lerNum(estado, 'nivelDesbloqueado', 1) : 1;
    if (nivelServidor <= nivel) {
      return json({ ok: false, erro: 'Nível ainda não concluído' }, 403);
    }

    // Banido para sempre? (chave igual à do painel admin)
    const banDoc = await fsGet(token, projectId, 'sistema/emailsBanidos');
    const banKey = email.replace(/[^a-z0-9@._+-]/g, '_');
    if (banDoc && banDoc.fields && banDoc.fields[banKey]) {
      return json({ ok: false, erro: 'Conta banida' }, 403);
    }

    if (marcos.includes(nivel)) {
      return json({
        ok: true,
        jaPago: true,
        nivel,
        mt: 0,
        pontos: 0,
        marcosPagos: marcos,
        mensagem: 'Marco já estava creditado.',
      });
    }

    // 2) Utilizador — por doc id = email ou query
    let userDoc = await fsGet(token, projectId, 'usuarios/' + email);
    if (!userDoc) {
      userDoc = await fsQueryUsuarioByEmail(token, projectId, email);
    }
    if (!userDoc || !userDoc.name) {
      return json({ ok: false, erro: 'Conta de utilizador não encontrada' }, 404);
    }

    if (userDoc.fields && userDoc.fields.jogosBloqueado && userDoc.fields.jogosBloqueado.booleanValue === true) {
      return json({ ok: false, erro: 'Jogos bloqueados' }, 403);
    }

    const pontosAtuais = lerNum(userDoc, 'pontos', 0);
    const novosPontos = pontosAtuais + ptsAdd;
    const userPath = docPathName(userDoc.name);

    await fsPatch(
      token,
      projectId,
      userPath,
      {
        pontos: numField(novosPontos),
        actualizadoEm: strField(new Date().toISOString()),
      },
      ['pontos', 'actualizadoEm']
    );

    // 3) Marcar marco pago no jogoEstado
    marcos = marcos.concat([nivel]).sort((a, b) => a - b);
    await fsPatch(
      token,
      projectId,
      'jogoEstado/' + email,
      {
        marcosPagos: arrIntField(marcos),
        actualizadoEm: strField(new Date().toISOString()),
      },
      ['marcosPagos', 'actualizadoEm']
    );

    // 4) Log histórico (opcional)
    const logId =
      'marco_' +
      email.replace(/[^a-z0-9]/gi, '_').slice(0, 40) +
      '_' +
      nivel +
      '_' +
      Date.now();
    try {
      await fsCreate(token, projectId, 'historicoPontos', logId, {
        email: strField(email),
        pontos: numField(ptsAdd),
        origem: strField('homejub'),
        detalhe: strField('Marco nível ' + nivel + ' (+' + mt + ' MT)'),
        createdAt: strField(new Date().toISOString()),
        via: strField('api-homejub-recompensa'),
      });
    } catch (eLog) {}

    return json({
      ok: true,
      jaPago: false,
      nivel,
      mt,
      pontos: ptsAdd,
      marcosPagos: marcos,
      mensagem: '+' + mt + ' MT (' + ptsAdd + ' pontos) creditados.',
    });
  } catch (e) {
    return json({
      ok: false,
      erro: 'Erro no servidor: ' + (e && e.message ? e.message : String(e)),
    }, 500);
  }
}
