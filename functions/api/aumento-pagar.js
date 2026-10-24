/**
 * Desafio MOZ – Aumento ganhos e-Mola
 * Secret: FIREBASE_SERVICE_ACCOUNT
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
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
  if (!pk.includes('BEGIN PRIVATE KEY')) throw new Error('private_key inválida');
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
  if (!tok.access_token) throw new Error('Falha token Google');
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
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromFsValue);
  if ('mapValue' in v) {
    const f = (v.mapValue && v.mapValue.fields) || {};
    const o = {};
    for (const k of Object.keys(f)) o[k] = fromFsValue(f[k]);
    return o;
  }
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
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status);
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
  if (!r.ok) throw new Error('PATCH ' + path + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsCreate(token, projectId, collection, fields) {
  const url = `${fsBase(projectId)}/${collection}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('CREATE ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsQuery(token, projectId, collection, field, op, value, limit = 1) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const structuredQuery = {
    from: [{ collectionId: collection }],
    where: {
      fieldFilter: {
        field: { fieldPath: field },
        op: op === '==' ? 'EQUAL' : op,
        value: toFsValue(value),
      },
    },
    limit: limit,
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!r.ok) throw new Error('QUERY ' + r.status + ' ' + (await r.text()));
  const rows = await r.json();
  const out = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row.document) {
        out.push({
          id: docIdFromName(row.document.name),
          path: row.document.name.replace(/^.*\/documents\//, ''),
          data: docToData(row.document),
        });
      }
    }
  }
  return out;
}

async function findUserByEmail(token, projectId, email) {
  const e = String(email || '')
    .trim()
    .toLowerCase();
  if (!e || e.indexOf('@') === -1) return null;
  let docs = await fsQuery(token, projectId, 'usuarios', 'email', '==', e, 1);
  if (!docs.length && e !== email) {
    docs = await fsQuery(token, projectId, 'usuarios', 'email', '==', String(email).trim(), 1);
  }
  return docs[0] || null;
}

async function creditarBonusIndicacao(token, projectId, codigo, ptsAntes, ptsDepois) {
  if (!codigo) return;
  const marcosAntes = Math.floor((ptsAntes || 0) / 50);
  const marcosDepois = Math.floor((ptsDepois || 0) / 50);
  const novos = marcosDepois - marcosAntes;
  if (novos <= 0) return;
  const bonus = novos * 10;
  const inds = await fsQuery(
    token,
    projectId,
    'usuarios',
    'codigoIndicacao',
    '==',
    String(codigo),
    1
  );
  if (!inds.length) return;
  const ind = inds[0];
  const d = ind.data || {};
  const fields = {
    pontos: toFsValue((d.pontos || 0) + bonus),
    pontosIndicacao: toFsValue((d.pontosIndicacao || 0) + bonus),
    ultimaAtualizacao: toFsValue(new Date().toISOString()),
  };
  await fsPatch(token, projectId, ind.path, fields, [
    'pontos',
    'pontosIndicacao',
    'ultimaAtualizacao',
  ]);
}

/**
 * Se o convidado chegou a ≥30 pts e tem indicadoPorInfluencer / codigoInfluencer do host,
 * incrementa influencerConvidados do host (1 vez).
 */
async function confirmarInfluencerSeAplicavel(token, projectId, userData, novosPontos, userPath) {
  try {
    if ((novosPontos || 0) < 30) return;
    if (userData.influencerConfirmado === true) return;

    const codigo =
      userData.indicadoPorInfluencer ||
      userData.codigoInfluencerOrigem ||
      userData.infCodigo ||
      '';
    if (!codigo) {
      // marca para não reprocessar se não há host
      return;
    }

    // Host pelo codigoInfluencer
    const hosts = await fsQuery(
      token,
      projectId,
      'usuarios',
      'codigoInfluencer',
      '==',
      String(codigo),
      1
    );
    if (!hosts.length) return;
    const host = hosts[0];
    const hd = host.data || {};

    // Já contado este email?
    const lista = Array.isArray(hd.influencerEmailsContados)
      ? hd.influencerEmailsContados.slice()
      : [];
    const emailGuest = String(userData.email || '')
      .trim()
      .toLowerCase();
    if (lista.indexOf(emailGuest) !== -1) {
      await fsPatch(
        token,
        projectId,
        userPath,
        { influencerConfirmado: toFsValue(true) },
        ['influencerConfirmado']
      );
      return;
    }

    lista.push(emailGuest);
    // Regra ratio após 900
    let ratio = parseInt(hd.influencerRatioApos900, 10) || 5;
    if (ratio < 1) ratio = 5;
    const reais = Number(hd.influencerConvidadosReais || 0) + 1;
    let contados = Number(hd.influencerConvidados || 0);
    const normal = hd.influencerContagemNormal === true;

    if (normal || reais <= 900) {
      contados += 1;
    } else {
      // após 900: cada `ratio` reais = +1 contado
      // simplificado: incrementa reais; só +1 contado a cada ratio
      const extras = reais - 900;
      const contadosPos = Math.floor(extras / ratio);
      const base = Math.min(900, contados); // approximate
      // Better: increment contados only when (reais - 900) % ratio === 0
      if ((reais - 900) % ratio === 0) contados += 1;
    }

    const hostFields = {
      influencerConvidadosReais: toFsValue(reais),
      influencerConvidados: toFsValue(contados),
      influencerEmailsContados: toFsValue(lista.slice(-2000)),
      ultimaAtualizacao: toFsValue(new Date().toISOString()),
    };
    await fsPatch(token, projectId, host.path, hostFields, Object.keys(hostFields));

    await fsPatch(
      token,
      projectId,
      userPath,
      {
        influencerConfirmado: toFsValue(true),
        influencerConfirmadoEm: toFsValue(new Date().toISOString()),
      },
      ['influencerConfirmado', 'influencerConfirmadoEm']
    );
  } catch (e) {
    console.warn('influencer confirm', e);
  }
}



async function fsAdd(token, projectId, collection, fields) {
  const url = `${fsBase(projectId)}/${collection}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('ADD ' + collection + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
}


async function fsCreateDoc(token, projectId, collection, docId, fields) {
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
  if (!r.ok) throw new Error('CREATE DOC ' + r.status + ' ' + (await r.text()));
  return r.json();
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET') return json({ ok: true, msg: 'aumento-pagar API no ar. Usa POST.' });
  if (request.method !== 'POST') return json({ ok: false, erro: 'Só POST' }, 405);

  let sa;
  try {
    const raw = env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return json({ ok: false, erro: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    sa = parseServiceAccount(raw);
  } catch (e) {
    return json({ ok: false, erro: 'Secret inválido: ' + (e.message || e) }, 500);
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ ok: false, erro: 'JSON inválido' }, 400);
  }


  const email = String(body.email || '').trim().toLowerCase();
  const pkg = String(body.pacote || body.pkg || '').trim();
  const txid = String(body.txid || body.txId || '').trim().replace(/\s+/g, '').toUpperCase();
  const telefone = String(body.telefone || '').replace(/\D/g, '');
  const EMOLA = '878037104';
  const valorEsperado = 20;

  if (!email || email.indexOf('@') === -1) return json({ ok: false, erro: 'E-mail inválido' }, 400);
  if (pkg !== 'checkin_16_vitalicio' && pkg !== 'checkin_vitalicio') {
    return json({ ok: false, erro: 'Pacote inválido' }, 400);
  }
  if (!/^PP[A-Z0-9.\-]{5,40}$/i.test(txid)) {
    return json({ ok: false, erro: 'ID e-Mola inválido (deve começar por PP)' }, 400);
  }
  let tel = telefone;
  if (tel.length === 12 && tel.indexOf('258') === 0) tel = tel.slice(3);
  if (!/^8\d{8}$/.test(tel)) return json({ ok: false, erro: 'Número de telefone inválido' }, 400);

  try {
    const token = await getAccessToken(sa);
    const projectId = sa.project_id;
    const user = await findUserByEmail(token, projectId, email);
    if (!user) return json({ ok: false, erro: 'Utilizador não encontrado' }, 404);
    const d = user.data || {};

    const jaBoost =
      d.checkinBoostVitalicio === true ||
      Number(d.checkinPtsDia) >= 16 ||
      d.checkinBoostTipo === '16_vitalicio';
    if (jaBoost) {
      return json({ ok: true, jaActivo: true, msg: 'Já tens o boost activo', pontos: d.pontos || 0 });
    }

    // Reserva ID (doc id = txid)
    const txPath = 'emolaTransacoes/' + txid;
    const existing = await fsGet(token, projectId, txPath);
    if (existing) {
      return json({ ok: false, erro: 'Este ID de transacção já foi usado' }, 409);
    }
    try {
      await fsCreateDoc(token, projectId, 'emolaTransacoes', txid, {
        email: toFsValue(email),
        telefone: toFsValue(tel),
        item: toFsValue(pkg),
        jogo: toFsValue('aumento_ganhos'),
        mt: toFsValue(valorEsperado),
        descricao: toFsValue(pkg),
        createdAt: toFsValue(new Date().toISOString()),
      });
    } catch (eC) {
      if (String(eC.message || eC).indexOf('409') !== -1 || String(eC.message || eC).indexOf('ALREADY') !== -1) {
        return json({ ok: false, erro: 'Este ID de transacção já foi usado' }, 409);
      }
      throw eC;
    }

    const detalhe = 'Check-in +2 MT (16 pts) / dia vitalício';
    await fsPatch(token, projectId, user.path, {
      checkinBoostVitalicio: toFsValue(true),
      checkinPtsDia: toFsValue(16),
      checkinBoostTipo: toFsValue('16_vitalicio'),
      ultimaAtualizacao: toFsValue(new Date().toISOString()),
    }, ['checkinBoostVitalicio', 'checkinPtsDia', 'checkinBoostTipo', 'ultimaAtualizacao']);

    try {
      await fsAdd(token, projectId, 'emolaUpgrades', {
        email: toFsValue(email),
        nome: toFsValue(d.nome || ''),
        txid: toFsValue(txid),
        telefone: toFsValue(tel),
        telefoneDestino: toFsValue(EMOLA),
        pacote: toFsValue(pkg),
        valorMt: toFsValue(valorEsperado),
        detalhe: toFsValue(detalhe),
        status: toFsValue('entregue'),
        createdAt: toFsValue(new Date().toISOString()),
      });
    } catch (eU) {}
    try {
      await fsAdd(token, projectId, 'pagamentosManuais', {
        jogo: toFsValue('aumento_ganhos'),
        email: toFsValue(email),
        item: toFsValue(pkg),
        label: toFsValue(detalhe),
        mt: toFsValue(valorEsperado),
        txId: toFsValue(txid),
        telefone: toFsValue(tel),
        status: toFsValue('entregue'),
        createdAt: toFsValue(new Date().toISOString()),
      });
    } catch (eP) {}

    return json({ ok: true, detalhe: detalhe, checkinPtsDia: 16 });
  } catch (e) {
    console.error(e);
    return json({ ok: false, erro: String(e.message || e) }, 500);
  }

}
