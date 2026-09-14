/**
 * Desafio MOZ – notificações de menção no chat + convite idle
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
      '#dm-toast-mencao,#dm-toast-idle{position:fixed;left:50%;z-index:99999;transform:translateX(-50%) translateY(-24px);',
      'max-width:min(440px,94vw);width:100%;opacity:0;pointer-events:none;transition:opacity .4s,transform .4s;}',
      '#dm-toast-mencao.mostrar,#dm-toast-idle.mostrar{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto;}',
      '#dm-toast-mencao{top:16px;}',
      '#dm-toast-idle{bottom:96px;}',
      '.dm-toast-card{border-radius:20px;padding:16px 16px;display:flex;gap:12px;align-items:flex-start;',
      'background:linear-gradient(135deg,rgba(48,24,78,.98),rgba(10,48,42,.98));',
      'border:1.5px solid rgba(34,255,153,.55);',
      'box-shadow:0 0 32px rgba(168,85,247,.55),0 0 56px rgba(34,255,153,.28),0 14px 44px rgba(0,0,0,.5);',
      'animation:dmPulse 1.8s ease-in-out infinite;}',
      '@keyframes dmPulse{0%,100%{box-shadow:0 0 24px rgba(168,85,247,.45),0 0 40px rgba(34,255,153,.2);}',
      '50%{box-shadow:0 0 40px rgba(34,255,153,.5),0 0 60px rgba(168,85,247,.4);}}',
      '.dm-toast-ico{width:48px;height:48px;border-radius:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;',
      'font-size:24px;background:linear-gradient(135deg,#a855f7,#22FF99);box-shadow:0 0 20px rgba(34,255,153,.45);}',
      '.dm-toast-body{flex:1;min-width:0;}',
      '.dm-toast-body h4{margin:0 0 5px;font-size:15px;font-weight:800;',
      'background:linear-gradient(90deg,#fff,#22FF99,#FFC94D);-webkit-background-clip:text;background-clip:text;color:transparent;}',
      '.dm-toast-body p{margin:0;font-size:13px;color:#d0d6e2;line-height:1.45;}',
      '.dm-toast-body b{color:#22FF99;}',
      '.dm-toast-btn{margin-top:12px;display:inline-flex;align-items:center;gap:6px;padding:10px 16px;border-radius:12px;border:none;',
      'font-size:13px;font-weight:800;cursor:pointer;color:#04140a;',
      'background:linear-gradient(90deg,#22FF99,#a855f7);box-shadow:0 6px 20px rgba(34,255,153,.4);text-decoration:none;}',
      '.dm-toast-x{background:transparent;border:none;color:#bbb;font-size:20px;cursor:pointer;padding:2px 8px;line-height:1;}'
    ].join('');
    document.head.appendChild(s);
  }

  function toastMencao(titulo, texto) {
    injetaCSS();
    var el = document.getElementById('dm-toast-mencao');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dm-toast-mencao';
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">💬</div>' +
        '<div class="dm-toast-body">' +
          '<h4>' + titulo + '</h4>' +
          '<p>' + texto + '</p>' +
          '<a class="dm-toast-btn" href="chat.html">Abrir bate-papo</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>';
    el.classList.add('mostrar');
    var x = el.querySelector('.dm-toast-x');
    if (x) x.onclick = function () { el.classList.remove('mostrar'); };
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('mostrar'); }, 15000);
  }

  function toastIdle() {
    injetaCSS();
    var el = document.getElementById('dm-toast-idle');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dm-toast-idle';
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">✨</div>' +
        '<div class="dm-toast-body">' +
          '<h4>A comunidade está no bate-papo</h4>' +
          '<p>Entra agora, conversa e responde — a sala está <b>ao vivo</b>.</p>' +
          '<a class="dm-toast-btn" href="chat.html">Ir ao bate-papo</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>';
    el.classList.add('mostrar');
    var x = el.querySelector('.dm-toast-x');
    if (x) x.onclick = function () { el.classList.remove('mostrar'); };
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('mostrar'); }, 12000);
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

  function iniciarIdle() {
    if (!cfg.idle) return;
    if (idleCount() >= (cfg.idleMaxDia || 2)) return;

    var segs = Number(cfg.idleSegundos) || 20;
    var timer = null;
    var shownThisVisit = false;

    function disparar() {
      if (shownThisVisit) return;
      if (idleCount() >= (cfg.idleMaxDia || 2)) return;
      shownThisVisit = true;
      bumpIdle();
      toastIdle();
    }

    function arm() {
      if (timer) clearTimeout(timer);
      if (shownThisVisit) return;
      if (idleCount() >= (cfg.idleMaxDia || 2)) return;
      timer = setTimeout(disparar, segs * 1000);
    }

    // Só interações claras reiniciam (scroll contínuo no telemóvel já não bloqueia)
    function onAct() { arm(); }
    document.addEventListener('click', onAct, true);
    document.addEventListener('touchstart', onAct, { passive: true, capture: true });
    document.addEventListener('keydown', onAct, true);

    // Arranca assim que a página está pronta
    arm();
    // Reforço: se por algum motivo o timer falhou, tenta de novo aos segs+2
    setTimeout(function () {
      if (!shownThisVisit && idleCount() < (cfg.idleMaxDia || 2)) {
        arm();
      }
    }, 1000);
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
      if (arr.length > 80) arr = arr.slice(-80);
      localStorage.setItem('dmMencoesVistas', JSON.stringify(arr));
    } catch (e) {}
  }

  function escutarMencoes() {
    if (!cfg.mencao) return;
    var email = emailSessao();
    if (!email) return;
    if (typeof firebase === 'undefined' || !window.db) return;
    var db = window.db;
    var emailLow = email.toLowerCase();

    function tratarDoc(ch) {
      if (ch.type !== 'added') return;
      var id = ch.doc.id;
      if (jaMostrou(id)) return;
      var d = ch.doc.data() || {};
      var t = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().getTime() : 0;
      if (t && Date.now() - t > 180000) { marcarVista(id); return; }
      marcarVista(id);
      var quem = d.deNome || 'Alguém';
      var trecho = (d.texto || '').slice(0, 80);
      toastMencao(
        'Foste mencionado no bate-papo',
        '<b>' + quem + '</b> ' + (d.tipo === 'resposta' ? 'respondeu-te' : 'mencionou-te') +
          (trecho ? ': “' + trecho + '”' : '')
      );
      try { ch.doc.ref.update({ lida: true }).catch(function () {}); } catch (e) {}
    }

    try {
      db.collection('notificacoesChat')
        .where('email', '==', emailLow)
        .orderBy('createdAt', 'desc')
        .limit(15)
        .onSnapshot(function (snap) {
          snap.docChanges().forEach(tratarDoc);
        }, function () {
          db.collection('notificacoesChat')
            .where('email', '==', emailLow)
            .limit(15)
            .onSnapshot(function (snap2) {
              snap2.docChanges().forEach(tratarDoc);
            });
        });
    } catch (e) { console.warn(e); }
  }

  function boot() {
    injetaCSS();
    try { iniciarIdle(); } catch (e) { console.warn('idle', e); }
    try { escutarMencoes(); } catch (e2) { console.warn('mencao', e2); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 50);
  }
})();
