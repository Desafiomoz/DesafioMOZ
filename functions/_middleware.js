// functions/_middleware.js
// Modo manutenção controlado pelo admin.html (aba "Manutenção").
// Lê o documento Firestore  config/manutencao  e, se "ativo" = true,
// mostra o aviso a todos, exceto aos e-mails escolhidos no admin.

const PROJETO = 'desafio-moz-61b70';
const CFG_URL = 'https://firestore.googleapis.com/v1/projects/' + PROJETO +
  '/databases/(default)/documents/config/manutencao';

// Caminhos que NUNCA são bloqueados
const LIVRES = [
  '/admin',
  '/postback-cpx',
  '/postback-mylead',
  '/netshop-webhook',
  '/netshop-status',
  '/get-offerwall-link',
  '/manutencao-check',
  '/.well-known',      // assetlinks.json (app Android/TWA)
  '/manifest.json'
];

let cache = { t: 0, v: null };   // v = última configuração lida com sucesso

async function lerConfig() {
  if (cache.v && Date.now() - cache.t < 10000) return cache.v;
  try {
    const r = await fetch(CFG_URL);
    if (r.ok) {
      const f = (await r.json()).fields || {};
      const arr = (f.emailsLivres && f.emailsLivres.arrayValue && f.emailsLivres.arrayValue.values) || [];
      const v = {
        ativo: !!(f.ativo && f.ativo.booleanValue),
        titulo: (f.titulo && f.titulo.stringValue) || '',
        mensagem: (f.mensagem && f.mensagem.stringValue) || '',
        emailsLivres: arr.map(x => String(x.stringValue || '').toLowerCase()).filter(Boolean)
      };
      cache = { t: Date.now(), v };
      return v;
    }
    // Ainda não existe configuração (404) ou regra não publicada (403): site aberto
    if (r.status === 404 || r.status === 403) {
      const v = { ativo: false, titulo: '', mensagem: '', emailsLivres: [] };
      cache = { t: Date.now(), v };
      return v;
    }
  } catch (e) { /* falha de rede: cai para o último estado conhecido */ }
  // Erro temporário: mantém o último estado conhecido (não abre o site por engano)
  if (cache.v) return cache.v;
  return { ativo: true, titulo: '', mensagem: '', emailsLivres: [] };
}

async function sha(txt) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function paginaManutencao(titulo, mensagem) {
  return `<!DOCTYPE html>
<html lang="pt"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@500;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:22px;
background:radial-gradient(1200px 700px at 50% 0%,#1b1145 0%,#0b0a1e 55%,#05050f 100%);
color:#fff;font-family:'Baloo 2',system-ui,sans-serif;overflow:hidden}
.orb{position:fixed;border-radius:50%;filter:blur(70px);opacity:.35;pointer-events:none;animation:flutua 14s ease-in-out infinite}
.o1{width:280px;height:280px;background:#7c4dff;top:-60px;left:-70px}
.o2{width:320px;height:320px;background:#00e676;bottom:-110px;right:-90px;animation-delay:-5s}
.o3{width:200px;height:200px;background:#ffca28;top:55%;left:-60px;animation-delay:-9s;opacity:.22}
@keyframes flutua{0%,100%{transform:translate(0,0)}50%{transform:translate(30px,-26px)}}

@property --ang{syntax:'<angle>';initial-value:0deg;inherits:true}
.caixa{position:relative;width:100%;max-width:440px;border-radius:26px;padding:3px;z-index:1;
animation:gira 9s linear infinite}
.caixa::before{content:"";position:absolute;inset:-26px;border-radius:50px;z-index:-2;
background:conic-gradient(from var(--ang),#00e676,#7c4dff,#ffca28,#00b8d4,#00e676);
filter:blur(34px);opacity:.55}
.caixa::after{content:"";position:absolute;inset:0;border-radius:26px;z-index:-1;
background:conic-gradient(from var(--ang),#00e676,#7c4dff,#ffca28,#00b8d4,#00e676)}
@keyframes gira{to{--ang:360deg}}
.miolo{position:relative;background:linear-gradient(180deg,#141033,#0c0a24);border-radius:24px;
padding:34px 26px 28px;text-align:center}
.icone{width:84px;height:84px;margin:0 auto 16px;border-radius:50%;display:flex;align-items:center;
justify-content:center;font-size:40px;background:radial-gradient(circle,#2a1f6b 0%,#150f3d 70%);
box-shadow:0 0 0 2px rgba(0,230,118,.5),0 0 34px 8px rgba(124,77,255,.55);animation:pulsa 2.8s ease-in-out infinite}
@keyframes pulsa{50%{box-shadow:0 0 0 2px rgba(255,202,40,.7),0 0 50px 16px rgba(0,230,118,.5)}}
h1{font-size:27px;font-weight:800;line-height:1.15;margin-bottom:12px}
.msg{font-size:17px;line-height:1.5;color:#dcd8ff;white-space:pre-line;word-wrap:break-word}
.nota{margin-top:20px;font-size:13px;color:#9a95c9}
.acesso{margin-top:14px}
.acesso a{font-size:12px;color:#7d78b0;text-decoration:underline;cursor:pointer}
.acesso form{display:none;margin-top:10px;gap:8px}
.acesso input{flex:1;min-width:0;padding:9px 12px;border-radius:10px;border:1px solid #3b3480;
background:#0b0a1e;color:#fff;font:inherit;font-size:14px}
.acesso button{padding:9px 14px;border-radius:10px;border:0;background:#00e676;color:#03210f;font:inherit;font-weight:700;cursor:pointer}
#erro{display:none;margin-top:8px;font-size:12px;color:#ff8a80}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body>
<div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div>
<main class="caixa"><div class="miolo">
<div class="icone">🛠️</div>
<h1>${esc(titulo)}</h1>
<p class="msg">${esc(mensagem)}</p>
<p class="nota">Esta página abre sozinha quando o site voltar.</p>
<div class="acesso">
<a id="lnk">Tenho acesso autorizado</a>
<form id="frm"><input id="em" type="email" placeholder="O teu e-mail" autocomplete="email"><button type="submit">Entrar</button></form>
<div id="erro">Este e-mail não tem acesso.</div>
</div>
</div></main>
<script>
(function(){
  function verifica(email,manual){
    return fetch('/manutencao-check?email='+encodeURIComponent(email),{cache:'no-store'})
      .then(function(r){return r.json()}).then(function(d){
        if(d.aberto||d.ok){location.reload();return true}
        if(manual){var e=document.getElementById('erro');e.style.display='block'}
        return false}).catch(function(){return false});
  }
  var guardado=(localStorage.getItem('emailUtilizador')||'').trim().toLowerCase();
  verifica(guardado,false);
  setInterval(function(){verifica(guardado,false)},20000);
  document.getElementById('lnk').onclick=function(){
    var f=document.getElementById('frm');f.style.display='flex'};
  document.getElementById('frm').onsubmit=function(ev){
    ev.preventDefault();
    var v=document.getElementById('em').value.trim().toLowerCase();
    if(v)verifica(v,true)};
})();
</script></body></html>`;
}

export async function onRequest(context) {
  const { pathname } = new URL(context.request.url);
  if (LIVRES.some(p => pathname.startsWith(p))) return context.next();

  const cfg = await lerConfig();
  if (!cfg.ativo) return context.next();

  // Utilizador escolhido no admin? (cookie criado por /manutencao-check)
  const ck = context.request.headers.get('Cookie') || '';
  const m = ck.match(/(?:^|;\s*)manut_ok=([^;]+)/);
  if (m) {
    const val = m[1];
    const i = val.lastIndexOf('.');
    if (i > 0) {
      let email = '';
      try { email = decodeURIComponent(val.slice(0, i)).toLowerCase(); } catch (e) {}
      const token = val.slice(i + 1);
      const segredo = context.env.NETSHOP_WEBHOOK_SECRET || 'desafiomoz';
      if (email && cfg.emailsLivres.includes(email) && token === await sha(email + segredo)) {
        return context.next();
      }
    }
  }

  return new Response(
    paginaManutencao(cfg.titulo || 'Estamos em manutenção',
      cfg.mensagem || 'Voltamos em breve.'),
    { status: 503, headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Retry-After': '1800'
    } });
}
