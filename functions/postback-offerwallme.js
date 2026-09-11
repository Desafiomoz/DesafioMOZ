// Cloudflare Pages Function
// Rota: https://desafiomoz.pages.dev/postback-offerwallme
// Reencaminha o postback da Offerwall.me para o Pipedream

const PIPEDREAM =
  "https://eo9vf365bb9io8m.m.pipedream.net/";

export async function onRequest(context) {
  const { request } = context;

  try {
    const incoming = new URL(request.url);
    const target = new URL(PIPEDREAM);

    // Copia todos os query params (subId, transId, reward, status, ...)
    incoming.searchParams.forEach((value, key) => {
      target.searchParams.set(key, value);
    });

    const res = await fetch(target.toString(), {
      method: "GET",
      headers: { "User-Agent": "DesafioMoz-OfferwallMe-Proxy/1.0" },
    });

    const text = await res.text().catch(() => "OK");

    return new Response(text || "OK", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
