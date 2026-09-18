/**
 * Desafio MOZ – menção no chat + convite idle (centro do ecrã)
 * window.__DM_NOTIF__ = { mencao: true, idle: true, idleSegundos: 20, idleMaxDia: 2 }
 */
(function () {
  if (window.__DM_NOTIF_LOADED__) return;
  window.__DM_NOTIF_LOADED__ = true;

  var cfg = Object.assign({
    mencao: true,
    idle: false,
    idleSegundos: 20,
    idleMaxDia: 2,
    pagina: (location.pathname.split('/').pop() || location.pathname || '').toLowerCase()
  }, window.__DM_NOTIF__ || {});

  if (cfg.pagina.indexOf('chat') !== -1 || cfg.pagina.indexOf('saque') !== -1) {
    cfg.mencao = false;
    cfg.idle = false;
  }

  function emailSessao() {
    try {
      var keys = ['emailUtilizador', 'email', 'userEmail'];
      for (var i = 0; i < keys.length; i++) {
        var v = (localStorage.getItem(keys[i]) || '').trim();
        if (v && v !== '—' && v.indexOf('@') !== -1) return v;
      }
    } catch (e) {}
    return '';
  }

  function injetaCSS() {
    if (document.getElementById('dm-notif-css')) return;
    var s = document.createElement('style');
    s.id = 'dm-notif-css';
    s.textContent = [
      '#dm-toast-mencao,#dm-toast-idle{',
      'position:fixed;left:50%;top:50%;z-index:999999;',
      'transform:translate(-50%,-50%) scale(0.92);',
      'max-width:min(420px,92vw);width:100%;',
      'opacity:0;pointer-events:none;',
      'transition:opacity .35s ease,transform .35s ease;',
      '}',
      '#dm-toast-mencao.mostrar,#dm-toast-idle.mostrar{',
      'opacity:1;pointer-events:auto;',
      'transform:translate(-50%,-50%) scale(1);',
      '}',
      '.dm-toast-card{',
      'border-radius:22px;padding:18px 16px;display:flex;gap:14px;align-items:flex-start;',
      'background:linear-gradient(145deg,rgba(48,22,80,.98),rgba(8,42,38,.98));',
      'border:2px solid rgba(34,255,153,.6);',
      'box-shadow:0 0 40px rgba(168,85,247,.55),0 0 70px rgba(34,255,153,.3),0 20px 50px rgba(0,0,0,.55);',
      'animation:dmPulse 1.8s ease-in-out infinite;',
      '}',
      '@keyframes dmPulse{',
      '0%,100%{box-shadow:0 0 28px rgba(168,85,247,.5),0 0 50px rgba(34,255,153,.22);}',
      '50%{box-shadow:0 0 48px rgba(34,255,153,.55),0 0 72px rgba(168,85,247,.45);}',
      '}',
      '.dm-toast-ico{',
      'width:52px;height:52px;border-radius:16px;flex-shrink:0;',
      'display:flex;align-items:center;justify-content:center;font-size:26px;',
      'background:linear-gradient(135deg,#a855f7,#22FF99);',
      'box-shadow:0 0 22px rgba(34,255,153,.5);',
      '}',
      '.dm-toast-body{flex:1;min-width:0;}',
      '.dm-toast-body h4{',
      'margin:0 0 6px;font-size:16px;font-weight:800;',
      'background:linear-gradient(90deg,#fff,#22FF99,#FFC94D);',
      '-webkit-background-clip:text;background-clip:text;color:transparent;',
      '}',
      '.dm-toast-body p{margin:0;font-size:13.5px;color:#d5dbe8;line-height:1.45;}',
      '.dm-toast-body b{color:#22FF99;}',
      '.dm-toast-btn{',
      'margin-top:14px;display:inline-flex;align-items:center;gap:8px;',
      'padding:12px 18px;border-radius:14px;border:none;',
      'font-size:14px;font-weight:800;cursor:pointer;color:#04140a;',
      'background:linear-gradient(90deg,#22FF99,#a855f7);',
      'box-shadow:0 6px 22px rgba(34,255,153,.45);text-decoration:none;',
      '}',
      '.dm-toast-x{',
      'background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);',
      'color:#ddd;font-size:18px;cursor:pointer;padding:4px 10px;',
      'line-height:1;border-radius:10px;flex-shrink:0;',
      '}',
      '.dm-toast-backdrop{',
      'position:fixed;inset:0;z-index:999998;background:rgba(4,6,12,.45);',
      'opacity:0;pointer-events:none;transition:opacity .3s;',
      '}',
      '.dm-toast-backdrop.mostrar{opacity:1;pointer-events:auto;}'
    ].join('');
    document.head.appendChild(s);
  }

  function ensureBackdrop() {
    var b = document.getElementById('dm-toast-backdrop');
    if (!b) {
      b = document.createElement('div');
      b.id = 'dm-toast-backdrop';
      b.className = 'dm-toast-backdrop';
      document.body.appendChild(b);
    }
    return b;
  }

  function mostrarToast(idEl, html, ms) {
    injetaCSS();
    var backdrop = ensureBackdrop();
    var el = document.getElementById(idEl);
    if (!el) {
      el = document.createElement('div');
      el.id = idEl;
      document.body.appendChild(el);
    }
    el.innerHTML = html;
    backdrop.classList.add('mostrar');
    el.classList.add('mostrar');

    function fechar() {
      el.classList.remove('mostrar');
      backdrop.classList.remove('mostrar');
      clearTimeout(el._t);
    }

    var x = el.querySelector('.dm-toast-x');
    if (x) x.onclick = fechar;
    backdrop.onclick = fechar;

    clearTimeout(el._t);
    el._t = setTimeout(fechar, ms || 30000);
  }


  function toastAdmin(titulo, texto, link, btnTexto, ms) {
    var href = link || 'index.html';
    var btn = btnTexto || 'Ver';
    mostrarToast(
      'dm-toast-mencao',
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">📢</div>' +
        '<div class="dm-toast-body">' +
          '<h4>' + titulo + '</h4>' +
          '<p>' + texto + '</p>' +
          '<a class="dm-toast-btn" href="' + href + '">' + btn + '</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>',
      ms || 15000
    );
  }
  function toastMencao(titulo, texto) {
    mostrarToast(
      'dm-toast-mencao',
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">💬</div>' +
        '<div class="dm-toast-body">' +
          '<h4>' + titulo + '</h4>' +
          '<p>' + texto + '</p>' +
          '<a class="dm-toast-btn" href="chat.html">Abrir bate-papo</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>',
      30000
    );
  }

  function toastIdle() {
    mostrarToast(
      'dm-toast-idle',
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">✨</div>' +
        '<div class="dm-toast-body">' +
          '<h4>A comunidade está no bate-papo</h4>' +
          '<p>Entra agora, conversa e responde — a sala está <b>ao vivo</b>.</p>' +
          '<a class="dm-toast-btn" href="chat.html">Ir ao bate-papo</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>',
      12000
    );
  }

  function diaKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function idleCount() {
    try {
      var o = JSON.parse(localStorage.getItem('dmIdleChat') || '{}');
      if (o.dia !== diaKey()) return 0;
      return Number(o.n) || 0;
    } catch (e) { return 0; }
  }

  function bumpIdle() {
    try {
      localStorage.setItem('dmIdleChat', JSON.stringify({ dia: diaKey(), n: idleCount() + 1 }));
    } catch (e) {}
  }

  /* Idle: NÃO reinicia. 20s desde que a página abriu. Máx 2×/dia. */
  function iniciarIdle() {
    if (!cfg.idle) return;
    var max = cfg.idleMaxDia || 2;
    if (idleCount() >= max) return;
    var segs = Number(cfg.idleSegundos) || 20;
    setTimeout(function () {
      if (idleCount() >= max) return;
      bumpIdle();
      toastIdle();
    }, segs * 1000);
  }

  function jaMostrou(id) {
    try {
      return (JSON.parse(localStorage.getItem('dmMencoesVistas') || '[]')).indexOf(id) !== -1;
    } catch (e) { return false; }
  }

  function marcarVista(id) {
    try {
      var arr = JSON.parse(localStorage.getItem('dmMencoesVistas') || '[]');
      if (arr.indexOf(id) === -1) arr.push(id);
      if (arr.length > 100) arr = arr.slice(-100);
      localStorage.setItem('dmMencoesVistas', JSON.stringify(arr));
    } catch (e) {}
  }

  function escutarMencoes() {
    if (!cfg.mencao) return;
    var email = emailSessao();
    if (!email) return;
    if (typeof firebase === 'undefined' || !window.db) {
      setTimeout(escutarMencoes, 800);
      return;
    }
    var db = window.db;
    var emailLow = email.toLowerCase();

    function toastPrivado(quem, trecho, deEmail) {
    var href = 'chat-privado.html';
    if (deEmail) {
      href += '?com=' + encodeURIComponent(String(deEmail).toLowerCase()) +
        '&nome=' + encodeURIComponent(quem || 'Membro');
    }
    mostrarToast(
      'dm-toast-mencao',
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">🔒</div>' +
        '<div class="dm-toast-body">' +
          '<h4>Papo privado</h4>' +
          '<p><b>' + quem + '</b> quer falar contigo em privado' +
            (trecho ? ': “' + trecho + '”' : '') + '</p>' +
          '<a class="dm-toast-btn" href="' + href + '">Abrir papo privado</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>',
      30000
    );
  }

  function toastDica(quem) {
    mostrarToast(
      'dm-toast-idle',
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">💡</div>' +
        '<div class="dm-toast-body">' +
          '<h4>Dicas para novatos</h4>' +
          '<p>Membros experientes partilham como <b>sacar mais rápido</b>' +
            (quem ? ' — nova dica de <b>' + quem + '</b>' : '') + '.</p>' +
          '<a class="dm-toast-btn" href="chat-dicas.html">Ver dicas</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>',
      15000
    );
  }

  function tratar(ch) {
      if (ch.type !== 'added') return;
      var id = ch.doc.id;
      if (jaMostrou(id)) return;
      var d = ch.doc.data() || {};
      var t = 0;
      try {
        if (d.createdAt && d.createdAt.toDate) t = d.createdAt.toDate().getTime();
        else if (typeof d.createdAt === 'string') t = new Date(d.createdAt).getTime();
      } catch (e) {}
      if (t && Date.now() - t > 600000) {
        marcarVista(id);
        return;
      }
      marcarVista(id);
      var quem = d.deNome || 'Alguém';
      var trecho = (d.texto || '').slice(0, 90);
      var tipo = d.tipo || 'mencao';
      if (tipo === 'privado') {
        toastPrivado(quem, trecho, d.deEmail || '');
      } else if (tipo === 'dica') {
        toastDica(quem);
      } else if (tipo === 'admin') {
        toastAdmin(d.titulo || 'Desafio MOZ', trecho || (d.texto || ''), d.link || 'index.html', d.btnTexto || 'Ver', d.duracaoMs || 15000);
      } else {
        toastMencao(
          'Foste mencionado no bate-papo',
          '<b>' + quem + '</b> ' + (tipo === 'resposta' ? 'respondeu-te' : 'mencionou-te') +
            (trecho ? ': “' + trecho + '”' : '')
        );
      }
      try { ch.doc.ref.update({ lida: true }).catch(function () {}); } catch (e) {}
    }

    function ligar(q) {
      return db.collection('notificacoesChat')
        .where('email', '==', q)
        .limit(20)
        .onSnapshot(function (snap) {
          snap.docChanges().forEach(tratar);
        }, function (err) { console.warn('notif', err); });
    }

    try {
      ligar(emailLow);
      if (email !== emailLow) ligar(email);
      ligar('_broadcast_admin_');
    } catch (e) { console.warn(e); }
  }

  function eNovato() {
    try {
      var pts = parseInt(localStorage.getItem('pontosUtilizador') || '0', 10);
      if (pts < 80) return true;
      var cad = localStorage.getItem('dataCadastro') || '';
      if (cad) {
        var t = new Date(cad).getTime();
        if (!isNaN(t) && (Date.now() - t) < 30 * 24 * 3600 * 1000) return true;
      }
    } catch (e) {}
    return false;
  }

  /* Só uma vez na vida da conta — nunca todos os dias */
  function jaMostrouDicaNovato() {
    try {
      return localStorage.getItem('dmDicaNovatoVisto') === '1';
    } catch (e) { return false; }
  }

  function marcarDicaNovato() {
    try { localStorage.setItem('dmDicaNovatoVisto', '1'); } catch (e) {}
  }

    function eContaNova() {
    try {
      if (localStorage.getItem('dmContaNova') === '1') return true;
      if (localStorage.getItem('dmDicaNovatoVisto') === '1') return false;
      var cad = localStorage.getItem('dataCadastro') || '';
      if (cad) {
        var t = new Date(cad).getTime();
        if (!isNaN(t) && (Date.now() - t) < 48 * 3600 * 1000) return true;
      }
      var pts = parseInt(localStorage.getItem('pontosUtilizador') || '0', 10);
      if (pts <= 15 && !cad) return true;
    } catch (e) {}
    return false;
  }

  function jaMostrouDicaNovato() {
    try {
      return localStorage.getItem('dmDicaNovatoVisto') === '1';
    } catch (e) { return false; }
  }

  function marcarDicaNovato() {
    try { localStorage.setItem('dmDicaNovatoVisto', '1'); } catch (e) {}
  }

  function toastDicasNovato() {
    mostrarToast(
      'dm-toast-idle',
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">💡</div>' +
        '<div class="dm-toast-body">' +
          '<h4>Dicas dos veteranos</h4>' +
          '<p>Contas que já estão a <b>ganhar</b> partilham como sacar mais rápido. Vale a pena ler!</p>' +
          '<a class="dm-toast-btn" href="chat-dicas.html">Ver dicas dos veteranos</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>',
      20000
    );
  }

  /* Só contas novas + página Início (desafios): após 5s, 15s no ecrã, uma vez só */
  function sugerirDicasNovato() {
    try {
      var p = (cfg.pagina || location.pathname || location.href || '').toLowerCase();
      var eInicio = p.indexOf('desafio') !== -1 || p.indexOf('index') !== -1 ||
        p === '/' || p === '' || /\/$/.test(p);
      if (!eInicio) return;
      if (p.indexOf('chat') !== -1) return;
      if (jaMostrouDicaNovato()) return;
      if (!eContaNova()) return;
      // email opcional — conta nova já tem flag
      setTimeout(function () {
        if (jaMostrouDicaNovato()) return;
        if (!eContaNova() && localStorage.getItem('dmContaNova') !== '1') return;
        marcarDicaNovato();
        try { localStorage.removeItem('dmContaNova'); } catch (e) {}
        toastDicasNovato();
      }, 5000);
    } catch (e) { console.warn('dica novato', e); }
  }

function boot() {
    injetaCSS();
    escutarMencoes();
    sugerirDicasNovato();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 30);
  }
})();
