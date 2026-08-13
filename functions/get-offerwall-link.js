// Cloudflare Pages Function
// Gera com segurança o link da offerwall da CPX Research para um usuário,
// calculando o "secure_hash" no servidor (nunca no navegador do usuário).
//
// Chamada pelo site: /get-offerwall-link?email=usuario@exemplo.com

const APP_ID = "35309";

// Implementação MD5 em JavaScript puro (necessário pois o Cloudflare Worker
// não tem MD5 nativo, só SHA). Fonte: domínio público (blueimp-md5, resumido).
function md5(string) {
  function rotateLeft(n, s) { return (n << s) | (n >>> (32 - s)); }
  function toHex(num) {
    let s = "", n;
    for (let i = 0; i <= 3; i++) {
      n = (num >>> (i * 8)) & 255;
      s += ("0" + n.toString(16)).slice(-2);
    }
    return s;
  }
  function utf8Encode(str) { return unescape(encodeURIComponent(str)); }

  string = utf8Encode(string);
  const x = [];
  const len = string.length;
  for (let i = 0; i < len * 8; i += 8) x[i >> 5] |= (string.charCodeAt(i / 8) & 255) << (i % 32);
  x[len * 8 >> 5] |= 0x80 << ((len * 8) % 32);
  x[(((len * 8 + 64) >>> 9) << 4) + 14] = len * 8;

  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;

  function FF(a,b,c,d,x,s,t){a=(a+((b&c)|(~b&d))+x+t)|0;return (rotateLeft(a,s)+b)|0;}
  function GG(a,b,c,d,x,s,t){a=(a+((b&d)|(c&~d))+x+t)|0;return (rotateLeft(a,s)+b)|0;}
  function HH(a,b,c,d,x,s,t){a=(a+(b^c^d)+x+t)|0;return (rotateLeft(a,s)+b)|0;}
  function II(a,b,c,d,x,s,t){a=(a+(c^(b|~d))+x+t)|0;return (rotateLeft(a,s)+b)|0;}

  for (let i = 0; i < x.length; i += 16) {
    const oa=a, ob=b, oc=c, od=d;
    a=FF(a,b,c,d,x[i+0]||0,7,-680876936); d=FF(d,a,b,c,x[i+1]||0,12,-389564586);
    c=FF(c,d,a,b,x[i+2]||0,17,606105819); b=FF(b,c,d,a,x[i+3]||0,22,-1044525330);
    a=FF(a,b,c,d,x[i+4]||0,7,-176418897); d=FF(d,a,b,c,x[i+5]||0,12,1200080426);
    c=FF(c,d,a,b,x[i+6]||0,17,-1473231341); b=FF(b,c,d,a,x[i+7]||0,22,-45705983);
    a=FF(a,b,c,d,x[i+8]||0,7,1770035416); d=FF(d,a,b,c,x[i+9]||0,12,-1958414417);
    c=FF(c,d,a,b,x[i+10]||0,17,-42063); b=FF(b,c,d,a,x[i+11]||0,22,-1990404162);
    a=FF(a,b,c,d,x[i+12]||0,7,1804603682); d=FF(d,a,b,c,x[i+13]||0,12,-40341101);
    c=FF(c,d,a,b,x[i+14]||0,17,-1502002290); b=FF(b,c,d,a,x[i+15]||0,22,1236535329);

    a=GG(a,b,c,d,x[i+1]||0,5,-165796510); d=GG(d,a,b,c,x[i+6]||0,9,-1069501632);
    c=GG(c,d,a,b,x[i+11]||0,14,643717713); b=GG(b,c,d,a,x[i+0]||0,20,-373897302);
    a=GG(a,b,c,d,x[i+5]||0,5,-701558691); d=GG(d,a,b,c,x[i+10]||0,9,38016083);
    c=GG(c,d,a,b,x[i+15]||0,14,-660478335); b=GG(b,c,d,a,x[i+4]||0,20,-405537848);
    a=GG(a,b,c,d,x[i+9]||0,5,568446438); d=GG(d,a,b,c,x[i+14]||0,9,-1019803690);
    c=GG(c,d,a,b,x[i+3]||0,14,-187363961); b=GG(b,c,d,a,x[i+8]||0,20,1163531501);
    a=GG(a,b,c,d,x[i+13]||0,5,-1444681467); d=GG(d,a,b,c,x[i+2]||0,9,-51403784);
    c=GG(c,d,a,b,x[i+7]||0,14,1735328473); b=GG(b,c,d,a,x[i+12]||0,20,-1926607734);

    a=HH(a,b,c,d,x[i+5]||0,4,-378558); d=HH(d,a,b,c,x[i+8]||0,11,-2022574463);
    c=HH(c,d,a,b,x[i+11]||0,16,1839030562); b=HH(b,c,d,a,x[i+14]||0,23,-35309556);
    a=HH(a,b,c,d,x[i+1]||0,4,-1530992060); d=HH(d,a,b,c,x[i+4]||0,11,1272893353);
    c=HH(c,d,a,b,x[i+7]||0,16,-155497632); b=HH(b,c,d,a,x[i+10]||0,23,-1094730640);
    a=HH(a,b,c,d,x[i+13]||0,4,681279174); d=HH(d,a,b,c,x[i+0]||0,11,-358537222);
    c=HH(c,d,a,b,x[i+3]||0,16,-722521979); b=HH(b,c,d,a,x[i+6]||0,23,76029189);
    a=HH(a,b,c,d,x[i+9]||0,4,-640364487); d=HH(d,a,b,c,x[i+12]||0,11,-421815835);
    c=HH(c,d,a,b,x[i+15]||0,16,530742520); b=HH(b,c,d,a,x[i+2]||0,23,-995338651);

    a=II(a,b,c,d,x[i+0]||0,6,-198630844); d=II(d,a,b,c,x[i+7]||0,10,1126891415);
    c=II(c,d,a,b,x[i+14]||0,15,-1416354905); b=II(b,c,d,a,x[i+5]||0,21,-57434055);
    a=II(a,b,c,d,x[i+12]||0,6,1700485571); d=II(d,a,b,c,x[i+3]||0,10,-1894986606);
    c=II(c,d,a,b,x[i+10]||0,15,-1051523); b=II(b,c,d,a,x[i+1]||0,21,-2054922799);
    a=II(a,b,c,d,x[i+8]||0,6,1873313359); d=II(d,a,b,c,x[i+15]||0,10,-30611744);
    c=II(c,d,a,b,x[i+6]||0,15,-1560198380); b=II(b,c,d,a,x[i+13]||0,21,1309151649);
    a=II(a,b,c,d,x[i+4]||0,6,-145523070); d=II(d,a,b,c,x[i+11]||0,10,-1120210379);
    c=II(c,d,a,b,x[i+2]||0,15,718787259); b=II(b,c,d,a,x[i+9]||0,21,-343485551);

    a=(a+oa)|0; b=(b+ob)|0; c=(c+oc)|0; d=(d+od)|0;
  }
  return toHex(a)+toHex(b)+toHex(c)+toHex(d);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const email = url.searchParams.get("email");

  if (!email) {
    return new Response(JSON.stringify({ error: "email em falta" }), { status: 400 });
  }

  // A chave secreta fica guardada como variável de ambiente no Cloudflare Pages
  // (Settings > Environment variables > CPX_SECURE_HASH), nunca aqui no código.
  const secureHashKey = env.CPX_SECURE_HASH;
  if (!secureHashKey) {
    return new Response(JSON.stringify({ error: "chave não configurada no servidor" }), { status: 500 });
  }

  const hash = md5(`${email}-${secureHashKey}`);
  // "main_info=true&user_country_code=MZ" ajuda a CPX a mostrar ofertas
  // mais adequadas a Moçambique (idioma/ofertas mais relevantes).
  const offerwallUrl = `https://offers.cpx-research.com/index.php?app_id=${APP_ID}&ext_user_id=${encodeURIComponent(email)}&secure_hash=${hash}&main_info=true&user_country_code=MZ`;

  return new Response(JSON.stringify({ url: offerwallUrl }), {
    headers: { "Content-Type": "application/json" },
  });
}
