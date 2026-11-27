const UPSTREAM_BASE = "https://tele-to-phone.felixrdx.xyz/api/developer/Cyb3rB4nn3r/fast";
const UPSTREAM_KEY = "9123ac29ef044ff796a85ac98da3cf29";
const DEFAULT_ADMIN_PASSWORD = "ChangeMe@2026";
const CHANNEL_URL = "https://t.me/CobraX_Empire";
const CHANNEL_HANDLE = "@CobraX_Empire";

const MEMORY_STATE = {
  apiEnabled: true,
  totalRequests: 0,
  uniqueClients: {},
  channelUsage: {},
  recentLogs: []
};

export default {
  async fetch(request, env, ctx) {
    const urlObj = new URL(request.url);
    const pathname = urlObj.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const jsonResponse = (data, status = 200) => {
      return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
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

    // Admin Panel HTML UI
    if (pathname === "/admin" && request.method === "GET") {
      return htmlResponse(renderAdminPanelHtml(state.apiEnabled), 200);
    }

    // Admin API Endpoints
    if (pathname.startsWith("/admin/api/")) {
      const providedPass =
        request.headers.get("x-admin-password") ||
        urlObj.searchParams.get("password") ||
        "";

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
        return jsonResponse({ error: "Unauthorized: Invalid admin password." }, 401);
      }

      if (pathname === "/admin/api/stats" && request.method === "GET") {
        return jsonResponse({
          apiEnabled: state.apiEnabled,
          storageMode: kv ? "Cloudflare KV (Persistent)" : "Memory Fallback",
          totalRequests: state.totalRequests,
          uniqueClientsCount: Object.keys(state.uniqueClients).length,
          clients: buildClientList(state.uniqueClients),
          channelsCount: Object.keys(state.channelUsage).length,
          channels: buildChannelList(state.channelUsage),
          recentLogs: state.recentLogs.slice(0, 40)
        }, 200);
      }

      if (pathname === "/admin/api/toggle" && request.method === "POST") {
        if (typeof bodyData.enabled === "boolean") {
          state.apiEnabled = bodyData.enabled;
        } else {
          state.apiEnabled = !state.apiEnabled;
        }
        await saveState(kv, state);
        return jsonResponse({
          ok: true,
          apiEnabled: state.apiEnabled,
          message: state.apiEnabled ? "API is now ONLINE." : "API is now OFFLINE."
        }, 200);
      }

      if (pathname === "/admin/api/reset" && request.method === "POST") {
        state.totalRequests = 0;
        state.uniqueClients = {};
        state.channelUsage = {};
        state.recentLogs = [];
        await saveState(kv, state);
        return jsonResponse({ ok: true, message: "Analytics reset successfully." }, 200);
      }

      return jsonResponse({ error: "Admin endpoint not found." }, 404);
    }

    // Track requester IP, referrer, and channel/source hint
    const clientIp =
      request.headers.get("cf-connecting-ip") ||
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      "unknown";
    const referer = request.headers.get("referer") || "";
    const channelHint = extractChannelHint(urlObj, request.headers, referer);
    const userId = (
      urlObj.searchParams.get("userid") ||
      urlObj.searchParams.get("user_id") ||
      urlObj.searchParams.get("id") ||
      ""
    ).trim();

    recordAnalytics(state, {
      ip: clientIp,
      referer,
      channelHint,
      userId,
      userAgent: request.headers.get("user-agent") || "unknown"
    });
    await saveState(kv, state);

    // If API is turned OFF by Admin, render styled Notice page (or JSON if ?format=json)
    if (!state.apiEnabled) {
      const wantsJson =
        urlObj.searchParams.get("format") === "json" ||
        (request.headers.get("accept") || "").includes("application/json") &&
        !(request.headers.get("accept") || "").includes("text/html");

      if (wantsJson) {
        return jsonResponse({
          status: "disabled",
          error: "API সাময়িকভাবে বন্ধ রাখা হয়েছে",
          reason: "কপিবাজরা আমাদের API নিয়ে নিজেদের চ্যানেলে ব্যবহার করছিল, যার কারণে এটি সাময়িকভাবে বন্ধ করা হলো।",
          channel: CHANNEL_URL,
          Api_Owner: "@MehediSanix",
          Telegram: "@CobraX_Empire",
          Developer: "@XrootCodeX"
        }, 503);
      }

      return htmlResponse(renderApiDisabledHtml(), 503);
    }

    // Original Telegram-to-Number API Logic
    try {
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

async function loadState(kv) {
  if (kv) {
    try {
      const saved = await kv.get("api_panel_state", { type: "json" });
      if (saved && typeof saved === "object") {
        return {
          apiEnabled: typeof saved.apiEnabled === "boolean" ? saved.apiEnabled : true,
          totalRequests: Number(saved.totalRequests) || 0,
          uniqueClients: saved.uniqueClients && typeof saved.uniqueClients === "object" ? saved.uniqueClients : {},
          channelUsage: saved.channelUsage && typeof saved.channelUsage === "object" ? saved.channelUsage : {},
          recentLogs: Array.isArray(saved.recentLogs) ? saved.recentLogs : []
        };
      }
    } catch {
      // Fallback to memory state
    }
  }
  return MEMORY_STATE;
}

async function saveState(kv, state) {
  MEMORY_STATE.apiEnabled = state.apiEnabled;
  MEMORY_STATE.totalRequests = state.totalRequests;
  MEMORY_STATE.uniqueClients = state.uniqueClients;
  MEMORY_STATE.channelUsage = state.channelUsage;
  MEMORY_STATE.recentLogs = state.recentLogs.slice(0, 50);

  if (kv) {
    try {
      await kv.put("api_panel_state", JSON.stringify(MEMORY_STATE));
    } catch {
      // Ignore KV write failure
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

  return "Direct / Unknown";
}

function recordAnalytics(state, info) {
  state.totalRequests = (Number(state.totalRequests) || 0) + 1;
  const nowIso = new Date().toISOString();

  if (!state.uniqueClients[info.ip]) {
    state.uniqueClients[info.ip] = {
      ip: info.ip,
      requests: 0,
      firstSeen: nowIso,
      lastSeen: nowIso,
      lastChannel: info.channelHint,
      userAgent: info.userAgent.slice(0, 90)
    };
  }
  state.uniqueClients[info.ip].requests += 1;
  state.uniqueClients[info.ip].lastSeen = nowIso;
  state.uniqueClients[info.ip].lastChannel = info.channelHint;

  if (!state.channelUsage[info.channelHint]) {
    state.channelUsage[info.channelHint] = {
      channel: info.channelHint,
      requests: 0,
      lastUsed: nowIso
    };
  }
  state.channelUsage[info.channelHint].requests += 1;
  state.channelUsage[info.channelHint].lastUsed = nowIso;

  state.recentLogs.unshift({
    time: nowIso,
    ip: info.ip,
    channel: info.channelHint,
    userid: info.userId || "-"
  });
  if (state.recentLogs.length > 50) {
    state.recentLogs.length = 50;
  }
}

function buildClientList(clientsObj) {
  return Object.values(clientsObj)
    .sort((a, b) => (b.requests || 0) - (a.requests || 0))
    .slice(0, 30);
}

function buildChannelList(channelObj) {
  return Object.values(channelObj)
    .sort((a, b) => (b.requests || 0) - (a.requests || 0))
    .slice(0, 30);
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
        radial-gradient(circle at 20% 20%, rgba(245, 178, 53, 0.14), transparent 45%),
        radial-gradient(circle at 80% 80%, rgba(0, 212, 255, 0.10), transparent 45%),
        #070c0a;
      color: #eef6f1;
      font-family: 'Hind Siliguri', sans-serif;
    }
    .card {
      width: 100%;
      max-width: 440px;
      background: rgba(13, 23, 19, 0.92);
      border: 1px solid rgba(245, 178, 53, 0.35);
      border-radius: 24px;
      padding: 32px 24px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65), 0 0 35px rgba(245, 178, 53, 0.12);
      backdrop-filter: blur(14px);
    }
    .top-badge {
      display: inline-block;
      font-family: 'Orbitron', sans-serif;
      font-size: 11px;
      letter-spacing: 1.5px;
      color: #f5b235;
      background: rgba(245, 178, 53, 0.12);
      border: 1px solid rgba(245, 178, 53, 0.3);
      padding: 5px 12px;
      border-radius: 999px;
      margin-bottom: 18px;
    }
    .warn-box {
      width: 66px;
      height: 66px;
      margin: 0 auto 20px;
      border-radius: 18px;
      background: linear-gradient(145deg, #f7be46, #d98a14);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 28px rgba(245, 178, 53, 0.35);
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
      box-shadow: 0 14px 30px rgba(230, 156, 32, 0.48);
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
  <title>Admin Panel • API Control & Analytics</title>
  <link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;600&family=Hind+Siliguri:wght@400;600;700&family=Orbitron:wght@600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #070913;
      color: #e8eeff;
      font-family: 'Hind Siliguri', sans-serif;
      padding: 20px;
    }
    .wrap { max-width: 920px; margin: 0 auto; }
    .panel {
      background: rgba(15, 20, 38, 0.92);
      border: 1px solid rgba(0, 212, 255, 0.25);
      border-radius: 18px;
      padding: 20px;
      margin-bottom: 18px;
    }
    h1 {
      font-family: 'Orbitron', sans-serif;
      font-size: 20px;
      color: #00e5ff;
      margin-bottom: 6px;
    }
    .sub { font-size: 13px; color: #9fb0d9; margin-bottom: 14px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    input {
      flex: 1;
      min-width: 210px;
      padding: 11px 14px;
      border-radius: 10px;
      border: 1px solid rgba(255,255,255,0.18);
      background: #0a0e1c;
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
    }
    .btn-primary { background: #00d4ff; color: #051018; }
    .btn-on { background: #00e676; color: #04180c; }
    .btn-off { background: #ff4757; color: #fff; }
    .btn-ghost { background: rgba(255,255,255,0.1); color: #fff; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 14px;
    }
    .stat-card {
      background: #0b1022;
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px;
      padding: 14px;
    }
    .stat-label { font-size: 12px; color: #94a5cf; }
    .stat-val {
      font-family: 'Orbitron', sans-serif;
      font-size: 20px;
      margin-top: 4px;
      color: #fff;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 13px;
    }
    th, td {
      text-align: left;
      padding: 9px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      font-family: 'Fira Code', monospace;
    }
    th { color: #7cd6ff; font-size: 12px; }
    .pill-on { color: #00e676; }
    .pill-off { color: #ff5252; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="panel">
      <h1>ADMIN CONTROL PANEL</h1>
      <div class="sub">API অন/অফ নিয়ন্ত্রণ, রিকোয়েস্ট ট্র্যাকিং এবং চ্যানেল/সোর্স ব্যবহার তালিকা • Channel: ${CHANNEL_HANDLE}</div>
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
          <div class="stat-label">UNIQUE CLIENTS (IP)</div>
          <div class="stat-val" id="clientsCountText">0</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">CHANNELS / SOURCES</div>
          <div class="stat-val" id="channelsCountText">0</div>
        </div>
      </div>
    </div>

    <div class="panel">
      <h2 style="font-size:17px;color:#ffd166;">চ্যানেল / রেফারেল ব্যবহার (Channels & Sources)</h2>
      <table>
        <thead>
          <tr><th>Channel / Source</th><th>Requests</th><th>Last Used</th></tr>
        </thead>
        <tbody id="channelsTable"></tbody>
      </table>
    </div>

    <div class="panel">
      <h2 style="font-size:17px;color:#00e5ff;">কারা কতগুলো রিকোয়েস্ট করছে (Clients by IP)</h2>
      <table>
        <thead>
          <tr><th>IP Address</th><th>Requests</th><th>Channel / Source</th><th>Last Seen</th></tr>
        </thead>
        <tbody id="clientsTable"></tbody>
      </table>
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

      const statusEl = document.getElementById("apiStatusText");
      const toggleBtn = document.getElementById("toggleBtn");
      statusEl.textContent = data.apiEnabled ? "ONLINE" : "OFFLINE";
      statusEl.className = "stat-val " + (data.apiEnabled ? "pill-on" : "pill-off");
      toggleBtn.textContent = data.apiEnabled ? "API বন্ধ করুন (OFF)" : "API চালু করুন (ON)";
      toggleBtn.className = data.apiEnabled ? "btn-off" : "btn-on";

      document.getElementById("totalReqText").textContent = data.totalRequests;
      document.getElementById("clientsCountText").textContent = data.uniqueClientsCount;
      document.getElementById("channelsCountText").textContent = data.channelsCount;

      document.getElementById("channelsTable").innerHTML = (data.channels || []).map(c =>
        \`<tr><td>\${escapeHtml(c.channel)}</td><td>\${c.requests}</td><td>\${escapeHtml(c.lastUsed || "")}</td></tr>\`
      ).join("") || \`<tr><td colspan="3">কোনো ডেটা নেই</td></tr>\`;

      document.getElementById("clientsTable").innerHTML = (data.clients || []).map(cl =>
        \`<tr><td>\${escapeHtml(cl.ip)}</td><td>\${cl.requests}</td><td>\${escapeHtml(cl.lastChannel || "")}</td><td>\${escapeHtml(cl.lastSeen || "")}</td></tr>\`
      ).join("") || \`<tr><td colspan="4">কোনো ডেটা নেই</td></tr>\`;
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

    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[m]));
    }

    if (savedPass) loadStats();
  </script>
</body>
</html>`;
}
