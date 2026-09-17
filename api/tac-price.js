export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://api.cryptorank.io/v2/currencies?symbol=TAC&fiat=USD",
      {
        headers: {
          "X-Api-Key": process.env.CRYPTORANK_API_KEY
        }
      }
    );

    if (!response.ok) {
      return res.status(response.status).json({
        error: "Unable to retrieve TAC price"
      });
    }

    const result = await response.json();

    if (!result.data || result.data.length === 0) {
      return res.status(404).json({
        error: "TAC price not found"
      });
    }

    const tac = result.data[0];

    return res.status(200).json({
      symbol: tac.symbol,
      name: tac.name,
      price: tac.price,
      percentChange24h: tac.percentChange?.h24 ?? null,
      lastUpdated: tac.lastUpdated
    });

  } catch (error) {

    return res.status(500).json({
      error: "Server error"
    });

  }
}
