import { createHmac, timingSafeEqual } from "crypto";

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");

  if (!hash) return null;

  const data = [];

  for (const [key, value] of params.entries()) {
    if (key !== "hash") {
      data.push(`${key}=${value}`);
    }
  }

  data.sort();

  const dataCheckString = data.join("\n");

  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();

  const calculatedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  try {
    const a = Buffer.from(calculatedHash, "hex");
    const b = Buffer.from(hash, "hex");

    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return null;
    }
  } catch {
    return null;
  }

  const authDate = Number(params.get("auth_date"));

  if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) {
    return null;
  }

  try {
    return JSON.parse(params.get("user"));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        error: "Method not allowed"
      });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;

    if (!supabaseUrl || !serviceKey || !botToken) {
      return res.status(500).json({
        error: "Server environment variables are not configured"
      });
    }

    const { initData, walletAddress } = req.body || {};

    if (!walletAddress) {
      return res.status(400).json({
        error: "Wallet address is required"
      });
    }

    const telegramUser = verifyTelegramInitData(
      initData,
      botToken
    );

    if (!telegramUser?.id) {
      return res.status(401).json({
        error: "Invalid Telegram authentication"
      });
    }

    const headers = {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json"
    };

    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_id=eq.${encodeURIComponent(
        telegramUser.id
      )}&select=id,telegram_id,wallet_address`,
      {
        headers
      }
    );

    const users = await userResponse.json();

    if (!userResponse.ok || !users.length) {
      return res.status(404).json({
        error: "TAC user not found"
      });
    }

    const userId = users[0].id;

    const updateResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${encodeURIComponent(userId)}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          wallet_address: walletAddress
        })
      }
    );

    const updatedUsers = await updateResponse.json();

    if (!updateResponse.ok || !updatedUsers.length) {
      return res.status(500).json({
        error: "Could not save wallet address",
        details: updatedUsers
      });
    }

    return res.status(200).json({
      success: true,
      walletAddress: updatedUsers[0].wallet_address
    });

  } catch (error) {
    console.error("Wallet API error:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
