/**
 * Cliente: creditar pontos via Cloudflare Function
 * Uso:
 *   await DM_creditarPontos({
 *     email: '...',
 *     tipo: 'pesquisa_dados',
 *     pontos: 5,
 *     respostas: {...},
 *     detalhe: '...'
 *   });
 */
(function (g) {
  var API = 'https://desafiomoz.pages.dev/api/creditar-pontos';

  g.DM_creditarPontos = async function (opts) {
    opts = opts || {};
    var email = String(opts.email || '').trim().toLowerCase();
    if (!email) throw new Error('E-mail em falta');
    var body = {
      email: email,
      tipo: String(opts.tipo || 'outro'),
      pontos: parseInt(opts.pontos, 10) || 0,
      detalhe: opts.detalhe || '',
      respostas: opts.respostas || null,
      pesquisaId: opts.pesquisaId || null,
      desafioId: opts.desafioId || null,
      camposExtra: opts.camposExtra || null,
    };
    var r = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    var data = {};
    try {
      data = await r.json();
    } catch (e) {}
    if (!r.ok || data.ok === false) {
      throw new Error((data && data.erro) || ('API ' + r.status));
    }
    return data;
  };
})(typeof window !== 'undefined' ? window : this);
