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

  if (
    !authDate ||
    Math.floor(Date.now() / 1000) - authDate > 86400
  ) {
    return null;
  }

  try {
    return JSON.parse(params.get("user") || "null");
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

    const { initData } = req.body || {};

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

    // Find the Telegram user
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_id=eq.${encodeURIComponent(
        telegramUser.id
      )}&select=id,balance`,
      {
        headers
      }
    );

    const users = await userResponse.json();

    if (!userResponse.ok || !users.length) {
      return res.status(404).json({
        error: "User not found"
      });
    }

    const user = users[0];

    // Find a completed mining cycle ready to claim
    const now = new Date().toISOString();

    const cycleResponse = await fetch(
      `${supabaseUrl}/rest/v1/mining_cycles?user_id=eq.${user.id}&status=eq.active&ends_at=lte.${encodeURIComponent(
        now
      )}&select=id,reward,ends_at&order=ends_at.asc&limit=1`,
      {
        headers
      }
    );

    const cycles = await cycleResponse.json();

    if (!cycleResponse.ok) {
      return res.status(500).json({
        error: "Could not check mining cycle",
        details: cycles
      });
    }

    if (!cycles.length) {
      return res.status(409).json({
        error: "No completed mining cycle available to claim"
      });
    }

    const cycle = cycles[0];

    const reward = Number(cycle.reward) || 0;
    const oldBalance = Number(user.balance) || 0;
    const newBalance = oldBalance + reward;

    // Mark the mining cycle as completed
    const completeResponse = await fetch(
      `${supabaseUrl}/rest/v1/mining_cycles?id=eq.${cycle.id}&status=eq.active`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          status: "completed"
        })
      }
    );

    const completedCycles = await completeResponse.json();

    if (!completeResponse.ok || !completedCycles.length) {
      return res.status(409).json({
        error: "Mining cycle could not be claimed",
        details: completedCycles
      });
    }

    // Add reward to user balance
    const balanceResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?id=eq.${user.id}`,
      {
        method: "PATCH",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          balance: newBalance
        })
      }
    );

    const updatedUsers = await balanceResponse.json();

    if (!balanceResponse.ok || !updatedUsers.length) {
      // Restore the cycle if balance update failed
      await fetch(
        `${supabaseUrl}/rest/v1/mining_cycles?id=eq.${cycle.id}&status=eq.completed`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            status: "active"
          })
        }
      );

      return res.status(500).json({
        error: "Could not update user balance",
        details: updatedUsers
      });
    }

    return res.status(200).json({
      success: true,
      reward,
      balance: newBalance,
      cycleId: cycle.id
    });

  } catch (error) {
    console.error("Claim API error:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
}
