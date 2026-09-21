// functions/manutencao-check.js
// Chamado pela página de manutenção: se o e-mail estiver na lista escolhida
// no admin, cria o cookie que deixa essa pessoa entrar no site.
// Se o site já reabriu, devolve { aberto: true } e a página recarrega sozinha.

const PROJETO = 'desafio-moz-61b70';
const CFG_URL = 'https://firestore.googleapis.com/v1/projects/' + PROJETO +
  '/databases/(default)/documents/config/manutencao';

async function sha(txt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function onRequest(context) {
  const cab = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const email = (new URL(context.request.url).searchParams.get('email') || '').trim().toLowerCase();

  let ativo = false, lista = [];
  try {
    const r = await fetch(CFG_URL);
    if (r.ok) {
      const f = (await r.json()).fields || {};
      ativo = !!(f.ativo && f.ativo.booleanValue);
      const arr = (f.emailsLivres && f.emailsLivres.arrayValue && f.emailsLivres.arrayValue.values) || [];
      lista = arr.map(x => String(x.stringValue || '').toLowerCase()).filter(Boolean);
    }
  } catch (e) {}

  if (!ativo) return new Response(JSON.stringify({ aberto: true }), { headers: cab });
  if (!email || !lista.includes(email)) return new Response(JSON.stringify({ ok: false }), { headers: cab });

  const segredo = context.env.NETSHOP_WEBHOOK_SECRET || 'desafiomoz';
  const token = await sha(email + segredo);
  cab['Set-Cookie'] = 'manut_ok=' + encodeURIComponent(email) + '.' + token +
    '; Path=/; Max-Age=86400; Secure; SameSite=Lax';
  return new Response(JSON.stringify({ ok: true }), { headers: cab });
}
