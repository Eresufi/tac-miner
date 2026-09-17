export default async function handler(req, res) {
  try {
    const apiKey = process.env.CRYPTORANK_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "CRYPTORANK_API_KEY is not configured"
      });
    }

    const response = await fetch(
      "https://api.cryptorank.io/v2/currencies?symbol=TAC&fiat=USD",
      {
        headers: {
          "X-Api-Key": apiKey,
          "Accept": "application/json"
        }
      }
    );

    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "CryptoRank request failed",
        details: result
      });
    }

    if (!result?.data || !Array.isArray(result.data) || result.data.length === 0) {
      return res.status(404).json({
        error: "TAC price not found",
        details: result
      });
    }

    const tac = result.data[0];

    return res.status(200).json({
      symbol: tac.symbol ?? "TAC",
      name: tac.name ?? "TAC",
      price: tac.price ?? null,
      change24h: tac.percentChange?.h24 ?? null,
      lastUpdated: tac.lastUpdated ?? null
    });

  } catch (error) {
    console.error("CryptoRank error:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
