/**
 * Desafio MOZ – registo de pontos no histórico diário (Admin → Histórico diário)
 * Uso: DM_histPontos(db, email, pontos, origem, detalhe)
 * origens: checkin | pesquisa | missao_semanal | convite | influencer | homejub |
 *          roleta | sorteio | desafio | cpx | offerwall | admin | bonus | outro
 */
(function (w) {
  function diaISO(d) {
    d = d || new Date();
    try {
      return d.toISOString().slice(0, 10);
    } catch (e) {
      var x = new Date();
      return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
    }
  }

  w.DM_histPontos = async function (db, email, pontos, origem, detalhe) {
    try {
      if (!db) return;
      var em = String(email || '').trim().toLowerCase();
      var pts = Number(pontos) || 0;
      if (!em || !pts) return;
      var agora = new Date();
      await db.collection('historicoPontos').add({
        email: em,
        pontos: pts,
        origem: String(origem || 'outro'),
        detalhe: String(detalhe || ''),
        dia: diaISO(agora),
        createdAt: agora.toISOString()
      });
    } catch (e) {
      try { console.warn('DM_histPontos', e); } catch (e2) {}
    }
  };

  w.DM_histPontosDia = diaISO;
})(window);
