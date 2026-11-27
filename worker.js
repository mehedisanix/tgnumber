const UPSTREAM_BASE = "https://tele-to-phone.felixrdx.xyz/api/developer/Cyb3rB4nn3r/fast";
const UPSTREAM_KEY = "9123ac29ef044ff796a85ac98da3cf29";

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: corsHeaders
      });
    };

    try {
      const urlObj = new URL(request.url);
      const userId = (
        urlObj.searchParams.get("userid") ||
        urlObj.searchParams.get("user_id") ||
        urlObj.searchParams.get("id") ||
        ""
      ).trim();

      if (!userId) {
        return jsonResponse({ error: "Missing 'userid' parameter." }, 400);
      }

      const apiKey = (env && env.API_KEY) ? env.API_KEY : UPSTREAM_KEY;
      const upstreamUrl = `${UPSTREAM_BASE}?key=${encodeURIComponent(apiKey)}&userid=${encodeURIComponent(userId)}`;

      const upstreamRes = await fetch(upstreamUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "application/json, text/plain, */*"
        }
      });

      const rawText = await upstreamRes.text();
      let upstreamData = null;

      try {
        upstreamData = JSON.parse(rawText);
      } catch {
        upstreamData = null;
      }

      if (!upstreamRes.ok) {
        return jsonResponse({
          response: {
            parameters: {
              value: userId,
              service: "Telegram to Number",
              success: false
            },
            data: [],
            error: `Upstream request failed (${upstreamRes.status}).`
          },
          Api_Owner: "@MehediSanix",
          Telegram: "@CobraX_Empire",
          Developer: "@XrootCodeX"
        }, 502);
      }

      const records = extractRecords(upstreamData, userId);
      const hasSuccess = records.length > 0 || Boolean(upstreamData && upstreamData.success === true);

      const formattedResponse = {
        response: {
          parameters: {
            value: userId,
            service: "Telegram to Number",
            success: hasSuccess
          },
          data: records
        },
        Api_Owner: "@MehediSanix",
        Telegram: "@CobraX_Empire",
        Developer: "@XrootCodeX"
      };

      return jsonResponse(formattedResponse, 200);

    } catch (err) {
      return jsonResponse({
        error: "Internal server error.",
        details: err.message,
        Api_Owner: "@MehediSanix",
        Telegram: "@CobraX_Empire",
        Developer: "@XrootCodeX"
      }, 500);
    }
  }
};

function extractRecords(payload, fallbackUserId) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  let rawList = [];

  if (Array.isArray(payload)) {
    rawList = payload;
  } else if (Array.isArray(payload.data)) {
    rawList = payload.data;
  } else if (payload.response && Array.isArray(payload.response.data)) {
    rawList = payload.response.data;
  } else if (payload.data && typeof payload.data === "object") {
    rawList = [payload.data];
  } else if (payload.response && typeof payload.response === "object" && !Array.isArray(payload.response)) {
    rawList = [payload.response];
  } else if (payload.number || payload.phone || payload.mobile || payload.user_id || payload.userid) {
    rawList = [payload];
  }

  const normalized = [];

  for (const item of rawList) {
    if (!item || typeof item !== "object") continue;

    const uid = String(item.user_id || item.userid || item.id || fallbackUserId).trim();
    const rawNum = String(item.number || item.phone || item.mobile || "").trim();
    const countryCode = String(item.country_code || item.code || "").trim();
    const country = String(item.country || item.country_name || "").trim();

    if (rawNum || uid) {
      normalized.push({
        user_id: uid,
        number: rawNum,
        country_code: countryCode,
        country: country
      });
    }
  }

  return normalized;
}
