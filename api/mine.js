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

    // Get mining configuration
    const configResponse = await fetch(
      `${supabaseUrl}/rest/v1/mining_config?id=eq.1&select=*`,
      {
        headers
      }
    );

    const config = await configResponse.json();

    if (!configResponse.ok || !config.length) {
      return res.status(500).json({
        error: "Mining configuration not found"
      });
    }

    const ratePerHour = Number(config[0].rate_per_hour);
    const cycleHours = Number(config[0].cycle_hours);

    // Find the Telegram user
    const userResponse = await fetch(
      `${supabaseUrl}/rest/v1/users?telegram_id=eq.${telegramUser.id}&select=id`,
      {
        headers
      }
    );

    const users = await userResponse.json();

    let userId;

    if (users.length) {
      userId = users[0].id;
    } else {
      // Create the user
      const createUserResponse = await fetch(
        `${supabaseUrl}/rest/v1/users`,
        {
          method: "POST",
          headers: {
            ...headers,
            Prefer: "return=representation"
          },
          body: JSON.stringify({
            telegram_id: telegramUser.id,
            username: telegramUser.username || null,
            first_name: telegramUser.first_name || null,
            last_name: telegramUser.last_name || null,
            balance: 0
          })
        }
      );

      const newUsers = await createUserResponse.json();

      if (!createUserResponse.ok || !newUsers.length) {
        return res.status(500).json({
          error: "Could not create user",
          details: newUsers
        });
      }

      userId = newUsers[0].id;
    }

    // Check for an existing active mining cycle
    const activeResponse = await fetch(
      `${supabaseUrl}/rest/v1/mining_cycles?user_id=eq.${userId}&status=eq.active&select=id,started_at,ends_at,rate_per_hour,reward`,
      {
        headers
      }
    );

    const activeCycles = await activeResponse.json();

    if (activeCycles.length) {
      return res.status(409).json({
        error: "Mining is already active",
        cycle: activeCycles[0]
      });
    }

    const startedAt = new Date();
    const endsAt = new Date(
      startedAt.getTime() + cycleHours * 60 * 60 * 1000
    );

    const reward = ratePerHour * cycleHours;

    // Create mining cycle
    const cycleResponse = await fetch(
      `${supabaseUrl}/rest/v1/mining_cycles`,
      {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "return=representation"
        },
        body: JSON.stringify({
          user_id: userId,
          started_at: startedAt.toISOString(),
          ends_at: endsAt.toISOString(),
          rate_per_hour: ratePerHour,
          reward: reward,
          status: "active"
        })
      }
    );

    const cycle = await cycleResponse.json();

    if (!cycleResponse.ok) {
      return res.status(cycleResponse.status).json({
        error: "Could not create mining cycle",
        details: cycle
      });
    }

    return res.status(200).json({
      success: true,
      userId,
      ratePerHour,
      cycleHours,
      reward,
      cycle: cycle[0]
    });

  } catch (error) {
    console.error("Mining API error:", error);

    return res.status(500).json({
      error: "Server error",
      details: error.message
    });
  }
          }
