// Versão de teste - mostra o erro
export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    
    const trackingId = url.searchParams.get("tracking_id") || "sem-tracking";
    const payout = url.searchParams.get("payout") || "0";
    const status = url.searchParams.get("status") || "1";
    const transactionId = url.searchParams.get("transaction_id") || "sem-id";

    // Resposta de teste (para vermos se a função está a correr)
    return new Response(
      JSON.stringify({
        ok: true,
        trackingId: trackingId,
        payout: payout,
        status: status,
        transactionId: transactionId,
        mensagem: "Função a funcionar"
      }, null, 2),
      {
        status: 200,
        headers: { "Content-Type": "application/json" }
      }
    );

  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        erro: err.message
      }, null, 2),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}