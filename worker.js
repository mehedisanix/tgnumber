const UPSTREAM_BASE = "https://tele-to-phone.felixrdx.xyz/api/developer/Cyb3rB4nn3r/fast";
const UPSTREAM_KEY = "9123ac29ef044ff796a85ac98da3cf29";
const DEFAULT_ADMIN_PASSWORD = "5274100";
const CHANNEL_URL = "https://t.me/CobraX_Empire";
const CHANNEL_HANDLE = "@CobraX_Empire";

const MEMORY_STATE = {
  apiEnabled: true,
  totalRequests: 0,
  successRequests: 0,
  emptyRequests: 0,
  blockedRequests: 0,
  uniqueClients: {},
  channelUsage: {},
  queriedUsers: {},
  recentLogs: []
};

export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);
    const pathname = urlObj.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-password"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders
        }
      });
    };

    const htmlResponse = (html, status = 200) => {
      return new Response(html, {
        status,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders
        }
      });
    };

    const kv = env && env.API_KV ? env.API_KV : null;
    const adminPass = (env && env.ADMIN_PASSWORD) ? String(env.ADMIN_PASSWORD) : DEFAULT_ADMIN_PASSWORD;
    const state = await loadState(kv);

    // Admin Panel UI
    if (pathname === "/admin" && request.method === "GET") {
      return htmlResponse(renderAdminPanelHtml(state.apiEnabled), 200);
    }

    // Admin Control & Analytics API
    if (pathname.startsWith("/admin/api/")) {
      const providedPass = request.headers.get("x-admin-password") || "";
      let bodyData = {};
      if (request.method === "POST") {
        try {
          bodyData = await request.json();
        } catch {
          bodyData = {};
        }
      }

      const authPass = providedPass || bodyData.password || "";
      if (!authPass || authPass !== adminPass) {
        return jsonResponse({ error: "ভুল পাসওয়ার্ড! সঠিক এডমিন পাসওয়ার্ড দিন।" }, 401);
      }

      if (pathname === "/admin/api/stats" && request.method === "GET") {
        return jsonResponse({
          apiEnabled: state.apiEnabled,
          storageMode: kv ? "Cloudflare KV (Persistent)" : "Worker Memory",
          totalRequests: state.totalRequests,
          successRequests: state.successRequests,
          emptyRequests: state.emptyRequests,
          blockedRequests: state.blockedRequests,
          uniqueClientsCount: Object.keys(state.uniqueClients).length,
          channelsCount: Object.keys(state.channelUsage).length,
          queriedUsersCount: Object.keys(state.queriedUsers).length,
          clients: sortTop(state.uniqueClients, "requests", 40),
          channels: sortTop(state.channelUsage, "requests", 40),
          topUsers: sortTop(state.queriedUsers, "count", 30),
          recentLogs: state.recentLogs.slice(0, 50)
        }, 200);
      }

      if (pathname === "/admin/api/toggle" && request.method === "POST") {
        state.apiEnabled = typeof bodyData.enabled === "boolean" ? bodyData.enabled : !state.apiEnabled;
        await saveState(kv, state);
        return jsonResponse({
          ok: true,
          apiEnabled: state.apiEnabled,
          message: state.apiEnabled ? "API চালু (ONLINE) করা হয়েছে।" : "API বন্ধ (OFFLINE) করা হয়েছে।"
        }, 200);
      }

      if (pathname === "/admin/api/reset" && request.method === "POST") {
        state.totalRequests = 0;
        state.successRequests = 0;
        state.emptyRequests = 0;
        state.blockedRequests = 0;
        state.uniqueClients = {};
        state.channelUsage = {};
        state.queriedUsers = {};
        state.recentLogs = [];
        await saveState(kv, state);
        return jsonResponse({ ok: true, message: "সমস্ত স্ট্যাটস রিসেট করা হয়েছে।" }, 200);
      }

      return jsonResponse({ error: "Admin endpoint not found." }, 404);
    }

    // Request metadata extraction
    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const referer = request.headers.get("referer") || "";
    const channelHint = extractChannelHint(urlObj, request.headers, referer);
    const cfInfo = request.cf || {};
    const country = cfInfo.country || "Unknown";
    const city = cfInfo.city || "";
    const isp = cfInfo.asOrganization || "Unknown ISP";
    const userId = (
      urlObj.searchParams.get("userid") ||
      urlObj.searchParams.get("user_id") ||
      urlObj.searchParams.get("id") ||
      ""
    ).trim();

    // If API is turned OFF by Admin
    if (!state.apiEnabled) {
      state.totalRequests += 1;
      state.blockedRequests += 1;
      recordBaseAnalytics(state, {
        ip: clientIp,
        country,
        city,
        isp,
        channelHint,
        userId,
        status: "OFFLINE_BLOCKED"
      });
      await saveState(kv, state);
      return htmlResponse(renderApiDisabledHtml(), 503);
    }

    // Main API Execution
    try {
      if (!userId) {
        state.totalRequests += 1;
        state.emptyRequests += 1;
        recordBaseAnalytics(state, {
          ip: clientIp,
          country,
          city,
          isp,
          channelHint,
          userId: "-",
          status: "MISSING_PARAM"
        });
        await saveState(kv, state);
        return jsonResponse({ error: "Missing 'userid' parameter." }, 400);
      }

      const apiKey = (env && env.API_KEY) ? env.API_KEY : UPSTREAM_KEY;
      const upstreamUrl = `${UPSTREAM_BASE}?key=${encodeURIComponent(apiKey)}&userid=${encodeURIComponent(userId)}`;

      const upstreamRes = await fetch(upstreamUrl, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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
        state.totalRequests += 1;
        state.emptyRequests += 1;
        recordBaseAnalytics(state, {
          ip: clientIp,
          country,
          city,
          isp,
          channelHint,
          userId,
          status: `UPSTREAM_${upstreamRes.status}`
        });
        await saveState(kv, state);

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
      const hasSuccess = records.length > 0;

      state.totalRequests += 1;
      if (hasSuccess) {
        state.successRequests += 1;
      } else {
        state.emptyRequests += 1;
      }

      recordBaseAnalytics(state, {
        ip: clientIp,
        country,
        city,
        isp,
        channelHint,
        userId,
        status: hasSuccess ? "FOUND" : "NOT_FOUND"
      });
      await saveState(kv, state);

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
      state.totalRequests += 1;
      state.emptyRequests += 1;
      recordBaseAnalytics(state, {
        ip: clientIp,
        country,
        city,
        isp,
        channelHint,
        userId: userId || "-",
        status: "ERROR"
      });
      await saveState(kv, state);

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

function cleanPrimitive(val) {
  if (val === null || val === undefined) return "";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
    const s = String(val).trim();
    if (!s || s === "[object Object]" || s === "null" || s === "undefined") return "";
    return s;
  }
  return "";
}

function extractPhoneFields(item, fallbackUserId) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;

  const uid =
    cleanPrimitive(item.user_id) ||
    cleanPrimitive(item.userid) ||
    cleanPrimitive(item.id) ||
    fallbackUserId;

  let rawNum = "";
  let countryCode = cleanPrimitive(item.country_code) || cleanPrimitive(item.code) || cleanPrimitive(item.dial_code);
  let country = cleanPrimitive(item.country) || cleanPrimitive(item.country_name);

  const phoneCandidates = [item.number, item.phone, item.mobile, item.phone_number, item.tel];
  for (const candidate of phoneCandidates) {
    if (!candidate) continue;
    if (typeof candidate === "object" && !Array.isArray(candidate)) {
      rawNum =
        cleanPrimitive(candidate.number) ||
        cleanPrimitive(candidate.phone) ||
        cleanPrimitive(candidate.value) ||
        cleanPrimitive(candidate.national) ||
        cleanPrimitive(candidate.international) ||
        cleanPrimitive(candidate.formatted);
      if (!countryCode) {
        countryCode = cleanPrimitive(candidate.country_code) || cleanPrimitive(candidate.code) || cleanPrimitive(candidate.dial_code);
      }
      if (!country) {
        country = cleanPrimitive(candidate.country) || cleanPrimitive(candidate.country_name);
      }
      if (rawNum) break;
    } else {
      rawNum = cleanPrimitive(candidate);
      if (rawNum) break;
    }
  }

  if (!rawNum) return null;

  return {
    user_id: uid,
    number: rawNum,
    country_code: countryCode,
    country: country
  };
}

function extractRecords(payload, fallbackUserId) {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidateLists = [];

  if (Array.isArray(payload)) {
    candidateLists.push(payload);
  } else {
    if (payload.response && typeof payload.response === "object") {
      if (Array.isArray(payload.response.data)) {
        candidateLists.push(payload.response.data);
      } else if (payload.response.data && typeof payload.response.data === "object") {
        candidateLists.push([payload.response.data]);
      }
      if (Array.isArray(payload.response.result)) {
        candidateLists.push(payload.response.result);
      } else if (payload.response.result && typeof payload.response.result === "object") {
        candidateLists.push([payload.response.result]);
      }
      candidateLists.push([payload.response]);
    }

    if (Array.isArray(payload.data)) {
      candidateLists.push(payload.data);
    } else if (payload.data && typeof payload.data === "object") {
      candidateLists.push([payload.data]);
    }

    if (Array.isArray(payload.result)) {
      candidateLists.push(payload.result);
    } else if (payload.result && typeof payload.result === "object") {
      candidateLists.push([payload.result]);
    }

    candidateLists.push([payload]);
  }

  const normalized = [];
  const seen = new Set();

  for (const list of candidateLists) {
    for (const item of list) {
      const parsed = extractPhoneFields(item, fallbackUserId);
      if (parsed && parsed.number) {
        const key = `${parsed.user_id}:${parsed.number}`;
        if (!seen.has(key)) {
          seen.add(key);
          normalized.push(parsed);
        }
      }
    }
    if (normalized.length > 0) break;
  }

  return normalized;
}

async function loadState(kv) {
  if (kv) {
    try {
      const saved = await kv.get("api_panel_state_v2", { type: "json" });
      if (saved && typeof saved === "object") {
        return {
          apiEnabled: typeof saved.apiEnabled === "boolean" ? saved.apiEnabled : true,
          totalRequests: Number(saved.totalRequests) || 0,
          successRequests: Number(saved.successRequests) || 0,
          emptyRequests: Number(saved.emptyRequests) || 0,
          blockedRequests: Number(saved.blockedRequests) || 0,
          uniqueClients: saved.uniqueClients && typeof saved.uniqueClients === "object" ? saved.uniqueClients : {},
          channelUsage: saved.channelUsage && typeof saved.channelUsage === "object" ? saved.channelUsage : {},
          queriedUsers: saved.queriedUsers && typeof saved.queriedUsers === "object" ? saved.queriedUsers : {},
          recentLogs: Array.isArray(saved.recentLogs) ? saved.recentLogs : []
        };
      }
    } catch {
      // Fallback to memory
    }
  }
  return MEMORY_STATE;
}

async function saveState(kv, state) {
  MEMORY_STATE.apiEnabled = state.apiEnabled;
  MEMORY_STATE.totalRequests = state.totalRequests;
  MEMORY_STATE.successRequests = state.successRequests;
  MEMORY_STATE.emptyRequests = state.emptyRequests;
  MEMORY_STATE.blockedRequests = state.blockedRequests;
  MEMORY_STATE.uniqueClients = state.uniqueClients;
  MEMORY_STATE.channelUsage = state.channelUsage;
  MEMORY_STATE.queriedUsers = state.queriedUsers;
  MEMORY_STATE.recentLogs = state.recentLogs.slice(0, 60);

  if (kv) {
    try {
      await kv.put("api_panel_state_v2", JSON.stringify(MEMORY_STATE));
    } catch {
      // Ignore KV write error
    }
  }
}

function extractChannelHint(urlObj, headers, referer) {
  const explicit =
    urlObj.searchParams.get("channel") ||
    urlObj.searchParams.get("source") ||
    urlObj.searchParams.get("ref") ||
    headers.get("x-channel") ||
    "";

  if (explicit.trim()) {
    return explicit.trim().slice(0, 80);
  }

  if (referer) {
    try {
      const refUrl = new URL(referer);
      return `${refUrl.hostname}${refUrl.pathname}`.slice(0, 80);
    } catch {
      return referer.slice(0, 80);
    }
  }

  return "Direct / Bot Request";
}

function recordBaseAnalytics(state, info) {
  const nowIso = new Date().toISOString();

  if (!state.uniqueClients[info.ip]) {
    state.uniqueClients[info.ip] = {
      ip: info.ip,
      country: info.country,
      city: info.city,
      isp: info.isp,
      requests: 0,
      lastSeen: nowIso,
      lastChannel: info.channelHint
    };
  }
  state.uniqueClients[info.ip].requests += 1;
  state.uniqueClients[info.ip].lastSeen = nowIso;
  state.uniqueClients[info.ip].lastChannel = info.channelHint;
  if (info.country && info.country !== "Unknown") state.uniqueClients[info.ip].country = info.country;
  if (info.isp && info.isp !== "Unknown ISP") state.uniqueClients[info.ip].isp = info.isp;

  if (!state.channelUsage[info.channelHint]) {
    state.channelUsage[info.channelHint] = {
      channel: info.channelHint,
      requests: 0,
      lastUsed: nowIso
    };
  }
  state.channelUsage[info.channelHint].requests += 1;
  state.channelUsage[info.channelHint].lastUsed = nowIso;

  if (info.userId && info.userId !== "-") {
    if (!state.queriedUsers[info.userId]) {
      state.queriedUsers[info.userId] = {
        userid: info.userId,
        count: 0,
        lastStatus: info.status,
        lastSeen: nowIso
      };
    }
    state.queriedUsers[info.userId].count += 1;
    state.queriedUsers[info.userId].lastStatus = info.status;
    state.queriedUsers[info.userId].lastSeen = nowIso;
  }

  state.recentLogs.unshift({
    time: nowIso,
    ip: info.ip,
    country: info.country,
    channel: info.channelHint,
    userid: info.userId || "-",
    status: info.status
  });
  if (state.recentLogs.length > 60) {
    state.recentLogs.length = 60;
  }
}

function sortTop(obj, key, limit) {
  return Object.values(obj)
    .sort((a, b) => (b[key] || 0) - (a[key] || 0))
    .slice(0, limit);
}

function renderApiDisabledHtml() {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Notice • API সাময়িকভাবে বন্ধ রাখা হয়েছে</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;600;700&family=Orbitron:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background:
        radial-gradient(circle at 20% 20%, rgba(245, 178, 53, 0.16), transparent 45%),
        radial-gradient(circle at 80% 80%, rgba(0, 212, 255, 0.12), transparent 45%),
        #070c0a;
      color: #eef6f1;
      font-family: 'Hind Siliguri', sans-serif;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: rgba(13, 23, 19, 0.94);
      border: 1px solid rgba(245, 178, 53, 0.38);
      border-radius: 24px;
      padding: 34px 24px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.7), 0 0 40px rgba(245, 178, 53, 0.14);
      backdrop-filter: blur(14px);
    }
    .top-badge {
      display: inline-block;
      font-family: 'Orbitron', sans-serif;
      font-size: 11px;
      letter-spacing: 1.5px;
      color: #f5b235;
      background: rgba(245, 178, 53, 0.12);
      border: 1px solid rgba(245, 178, 53, 0.32);
      padding: 5px 13px;
      border-radius: 999px;
      margin-bottom: 18px;
    }
    .warn-box {
      width: 68px;
      height: 68px;
      margin: 0 auto 20px;
      border-radius: 18px;
      background: linear-gradient(145deg, #f7be46, #d98a14);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 28px rgba(245, 178, 53, 0.38);
    }
    .warn-box svg {
      width: 34px;
      height: 34px;
      fill: #171204;
    }
    h1 {
      font-size: 25px;
      line-height: 1.35;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 14px;
    }
    .reason {
      font-size: 15px;
      line-height: 1.65;
      color: #c8d8cf;
      margin-bottom: 22px;
    }
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.16), transparent);
      margin: 18px 0;
    }
    .cta-note {
      font-size: 14.5px;
      line-height: 1.6;
      color: #dcebe3;
      margin-bottom: 20px;
    }
    .join-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      width: 100%;
      padding: 14px 18px;
      border-radius: 14px;
      text-decoration: none;
      font-size: 16px;
      font-weight: 700;
      color: #151003;
      background: linear-gradient(135deg, #ffd166, #e69c20);
      box-shadow: 0 10px 25px rgba(230, 156, 32, 0.35);
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .join-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 14px 30px rgba(230, 156, 32, 0.5);
    }
    .join-btn svg {
      width: 20px;
      height: 20px;
      fill: #151003;
      flex-shrink: 0;
    }
    .channel-link {
      display: inline-block;
      margin-top: 18px;
      font-size: 13.5px;
      color: #8eb3a1;
      text-decoration: none;
    }
    .channel-link:hover {
      color: #ffd166;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="top-badge">NOTICE • SERVICE PAUSED</div>
    <div class="warn-box" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <path d="M12 2L1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z"/>
      </svg>
    </div>
    <h1>API সাময়িকভাবে বন্ধ রাখা হয়েছে</h1>
    <p class="reason">
      কপিবাজরা আমাদের API নিয়ে নিজেদের চ্যানেলে ব্যবহার করছিল, যার কারণে এটি সাময়িকভাবে বন্ধ করা হলো।
    </p>
    <div class="divider"></div>
    <p class="cta-note">
      নতুন আপডেট ও ভালো মানের টুলস, API সবার আগে পেতে আমাদের অফিসিয়াল চ্যানেলে জয়েন থাকুন।
    </p>
    <a class="join-btn" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">
      <svg viewBox="0 0 24 24">
        <path d="M21.5 3.5L2.5 10.8c-1.3.5-1.3 1.2-.2 1.6l4.9 1.5 11.3-7.1c.5-.3 1-.1.6.2l-9.1 8.2-.3 5c.5 0 .7-.2 1-.5l2.4-2.3 5 3.7c.9.5 1.6.2 1.8-.8l3.2-15.1c.3-1.3-.5-1.9-1.5-1.5z"/>
      </svg>
      <span>অফিসিয়াল চ্যানেলে জয়েন করুন</span>
    </a>
    <a class="channel-link" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">t.me/CobraX_Empire</a>
  </div>
</body>
</html>`;
}

function renderAdminPanelHtml(initialEnabled) {
  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Admin Panel • MehediSaniX API Control</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&family=Hind+Siliguri:wght@400;600;700&family=Orbitron:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at top right, #0f1c38, #060913 55%);
      color: #e8eeff;
      font-family: 'Hind Siliguri', sans-serif;
      padding: 18px;
      min-height: 100vh;
    }
    .wrap { max-width: 1020px; margin: 0 auto; }
    .panel {
      background: rgba(13, 19, 36, 0.92);
      border: 1px solid rgba(0, 212, 255, 0.24);
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 18px;
      box-shadow: 0 12px 35px rgba(0,0,0,0.45);
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 8px;
    }
    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: 20px;
      color: #00e5ff;
      letter-spacing: 1px;
    }
    .badge-storage {
      font-family: 'Fira Code', monospace;
      font-size: 11px;
      padding: 5px 10px;
      border-radius: 999px;
      background: rgba(0, 229, 255, 0.12);
      border: 1px solid rgba(0, 229, 255, 0.3);
      color: #7eeeff;
    }
    .sub { font-size: 13.5px; color: #9fb0d9; margin-bottom: 15px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    input {
      flex: 1;
      min-width: 200px;
      padding: 11px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.2);
      background: #090d1a;
      color: #fff;
      font-family: 'Fira Code', monospace;
    }
    button {
      padding: 11px 16px;
      border: none;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
      font-family: 'Hind Siliguri', sans-serif;
      font-size: 14px;
      transition: opacity 0.2s;
    }
    button:hover { opacity: 0.9; }
    .btn-primary { background: #00d4ff; color: #051018; }
    .btn-on { background: #00e676; color: #04180c; }
    .btn-off { background: #ff4757; color: #fff; }
    .btn-ghost { background: rgba(255,255,255,0.1); color: #fff; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .stat-card {
      background: #0a0f20;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 14px;
    }
    .stat-label { font-size: 12px; color: #94a5cf; }
    .stat-val {
      font-family: 'Orbitron', sans-serif;
      font-size: 20px;
      margin-top: 5px;
      color: #fff;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 18px;
    }
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 12.5px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      font-family: 'Fira Code', monospace;
      white-space: nowrap;
    }
    th { color: #7cd6ff; font-size: 11.5px; }
    .pill-on { color: #00e676; }
    .pill-off { color: #ff5252; }
    .tag-found { color: #00e676; }
    .tag-miss { color: #ffb74d; }
    .tag-block { color: #ff5252; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <div class="header-top">
        <h1>ADMIN CONTROL PANEL</h1>
        <span class="badge-storage" id="storageBadge">STORAGE: CHECKING</span>
      </div>
      <div class="sub">API অন/অফ নিয়ন্ত্রণ, মোট রিকোয়েস্ট, সাকসেস রেট, IP লোকেশন এবং চ্যানেল/সোর্স মনিটরিং • ${CHANNEL_HANDLE}</div>
      <div class="row">
        <input type="password" id="adminPass" placeholder="Admin Password দিন..." />
        <button class="btn-primary" onclick="loadStats()">Login & Refresh</button>
        <button id="toggleBtn" class="${initialEnabled ? 'btn-off' : 'btn-on'}" onclick="toggleApi()">
          ${initialEnabled ? 'API বন্ধ করুন (OFF)' : 'API চালু করুন (ON)'}
        </button>
        <button class="btn-ghost" onclick="resetStats()">Reset Stats</button>
      </div>
      <div class="stats">
        <div class="stat-card">
          <div class="stat-label">API STATUS</div>
          <div class="stat-val" id="apiStatusText">${initialEnabled ? 'ONLINE' : 'OFFLINE'}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">TOTAL REQUESTS</div>
          <div class="stat-val" id="totalReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">NUMBER FOUND</div>
          <div class="stat-val pill-on" id="successReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">NOT FOUND / EMPTY</div>
          <div class="stat-val tag-miss" id="emptyReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">BLOCKED (OFFLINE)</div>
          <div class="stat-val pill-off" id="blockedReqText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">UNIQUE CLIENTS (IP)</div>
          <div class="stat-val" id="clientsCountText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">CHANNELS / SOURCES</div>
          <div class="stat-val" id="channelsCountText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">UNIQUE USER IDs</div>
          <div class="stat-val" id="usersCountText">0</div>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <h2 style="font-size:16px;color:#ffd166;">চ্যানেল / রেফারেল সোর্স (Channels & Sources)</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>Channel / Source</th><th>Requests</th><th>Last Used</th></tr>
            </thead>
            <tbody id="channelsTable"></tbody>
          </table>
        </div>
      </div>

      <div class="panel">
        <h2 style="font-size:16px;color:#00e676;">সবচেয়ে বেশি সার্চ হওয়া User ID</h2>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>User ID</th><th>Searches</th><th>Last Status</th></tr>
            </thead>
            <tbody id="usersTable"></tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2 style="font-size:16px;color:#00e5ff;">কারা রিকোয়েস্ট করছে (Clients by IP, Country & ISP)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>IP Address</th><th>Country</th><th>ISP / Org</th><th>Requests</th><th>Channel / Source</th><th>Last Seen</th></tr>
          </thead>
          <tbody id="clientsTable"></tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <h2 style="font-size:16px;color:#ff8a65;">সাম্প্রতিক লাইভ রিকোয়েস্ট লগ (Recent Activity)</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Time (UTC)</th><th>IP</th><th>Country</th><th>User ID</th><th>Channel</th><th>Status</th></tr>
          </thead>
          <tbody id="logsTable"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    const savedPass = sessionStorage.getItem("worker_admin_pass") || "";
    if (savedPass) document.getElementById("adminPass").value = savedPass;

    function getPass() {
      const p = document.getElementById("adminPass").value.trim();
      if (p) sessionStorage.setItem("worker_admin_pass", p);
      return p;
    }

    async function loadStats() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      const res = await fetch("/admin/api/stats", {
        headers: { "x-admin-password": pass }
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");

      document.getElementById("storageBadge").textContent = "STORAGE: " + (data.storageMode || "MEMORY");

      const statusEl = document.getElementById("apiStatusText");
      const toggleBtn = document.getElementById("toggleBtn");
      statusEl.textContent = data.apiEnabled ? "ONLINE" : "OFFLINE";
      statusEl.className = "stat-val " + (data.apiEnabled ? "pill-on" : "pill-off");
      toggleBtn.textContent = data.apiEnabled ? "API বন্ধ করুন (OFF)" : "API চালু করুন (ON)";
      toggleBtn.className = data.apiEnabled ? "btn-off" : "btn-on";

      document.getElementById("totalReqText").textContent = data.totalRequests;
      document.getElementById("successReqText").textContent = data.successRequests;
      document.getElementById("emptyReqText").textContent = data.emptyRequests;
      document.getElementById("blockedReqText").textContent = data.blockedRequests;
      document.getElementById("clientsCountText").textContent = data.uniqueClientsCount;
      document.getElementById("channelsCountText").textContent = data.channelsCount;
      document.getElementById("usersCountText").textContent = data.queriedUsersCount;

      document.getElementById("channelsTable").innerHTML = (data.channels || []).map(c =>
        \`<tr><td>\${esc(c.channel)}</td><td>\${c.requests}</td><td>\${esc(formatTime(c.lastUsed))}</td></tr>\`
      ).join("") || \`<tr><td colspan="3">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("usersTable").innerHTML = (data.topUsers || []).map(u =>
        \`<tr><td>\${esc(u.userid)}</td><td>\${u.count}</td><td class="\${statusCls(u.lastStatus)}">\${esc(u.lastStatus)}</td></tr>\`
      ).join("") || \`<tr><td colspan="3">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("clientsTable").innerHTML = (data.clients || []).map(cl =>
        \`<tr><td>\${esc(cl.ip)}</td><td>\${esc(cl.country || "-")}</td><td>\${esc(cl.isp || "-")}</td><td>\${cl.requests}</td><td>\${esc(cl.lastChannel || "-")}</td><td>\${esc(formatTime(cl.lastSeen))}</td></tr>\`
      ).join("") || \`<tr><td colspan="6">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("logsTable").innerHTML = (data.recentLogs || []).map(l =>
        \`<tr><td>\${esc(formatTime(l.time))}</td><td>\${esc(l.ip)}</td><td>\${esc(l.country || "-")}</td><td>\${esc(l.userid)}</td><td>\${esc(l.channel)}</td><td class="\${statusCls(l.status)}">\${esc(l.status)}</td></tr>\`
      ).join("") || \`<tr><td colspan="6">কোনো লগ নেই</td></tr>\`;
    }

    async function toggleApi() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      const res = await fetch("/admin/api/toggle", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pass
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");
      loadStats();
    }

    async function resetStats() {
      const pass = getPass();
      if (!pass) return alert("Admin password দিন");
      if (!confirm("সব স্ট্যাটস ও লগ মুছে ফেলবেন?")) return;
      const res = await fetch("/admin/api/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pass
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) return alert(data.error || "Failed");
      loadStats();
    }

    function statusCls(st) {
      if (st === "FOUND") return "tag-found";
      if (st === "OFFLINE_BLOCKED") return "tag-block";
      return "tag-miss";
    }

    function formatTime(iso) {
      if (!iso) return "-";
      return iso.replace("T", " ").slice(0, 19);
    }

    function esc(str) {
      return String(str).replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[m]));
    }

    if (savedPass) loadStats();
  </script>
</body>
</html>`;
}
