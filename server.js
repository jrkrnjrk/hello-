"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const path = require("path");

const PORT = Number(process.env.PORT) || 3000;
const SITE_NAME = process.env.SITE_NAME || "Secure Gate";
const WEBHOOK_URL = (process.env.DISCORD_WEBHOOK_URL || "").trim();

if (!WEBHOOK_URL) {
  console.error("Missing DISCORD_WEBHOOK_URL. Copy .env.example and set your webhook.");
  process.exit(1);
}

if (!/^https:\/\/(discord(?:app)?\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/i.test(WEBHOOK_URL)) {
  console.error("DISCORD_WEBHOOK_URL does not look like a Discord webhook URL.");
  process.exit(1);
}

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

const visitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "rate_limited" },
});

const recent = new Map();
const DEDUPE_MS = 2 * 60 * 1000;

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const firstForwarded = typeof forwarded === "string" ? forwarded.split(",")[0].trim() : "";
  const raw =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-real-ip"] ||
    firstForwarded ||
    req.ip ||
    req.socket?.remoteAddress ||
    "";
  return String(raw).replace(/^::ffff:/, "");
}

function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return "🌐";
  return String.fromCodePoint(
    ...countryCode
      .toUpperCase()
      .split("")
      .map((c) => 127397 + c.charCodeAt(0))
  );
}

async function lookupIp(ip) {
  const fields = [
    "status",
    "message",
    "query",
    "country",
    "countryCode",
    "regionName",
    "city",
    "isp",
    "org",
    "as",
    "proxy",
    "hosting",
    "mobile",
  ].join(",");

  const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=${fields}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`geo lookup HTTP ${res.status}`);
  const data = await res.json();
  if (data.status !== "success") throw new Error(data.message || "geo lookup failed");
  return data;
}

function riskLabel(geo) {
  if (geo.proxy) return { text: "VPN / proxy / Tor likely", color: 0xe74c3c };
  if (geo.hosting) return { text: "Datacenter / hosting IP", color: 0xf39c12 };
  if (geo.mobile) return { text: "Mobile network", color: 0x3498db };
  return { text: "No VPN/proxy flag", color: 0x2ecc71 };
}

async function sendDiscord({ ip, geo, ua, pathName }) {
  const risk = riskLabel(geo || {});
  const country = geo?.country || "Unknown";
  const code = geo?.countryCode || "";
  const city = [geo?.city, geo?.regionName].filter(Boolean).join(", ") || "Unknown";

  const embed = {
    title: `${SITE_NAME} — new visit`,
    color: risk.color,
    timestamp: new Date().toISOString(),
    fields: [
      { name: "IP", value: `\`${ip}\``, inline: true },
      { name: "Country", value: `${flagEmoji(code)} ${country}${code ? ` (${code})` : ""}`, inline: true },
      { name: "VPN / proxy", value: geo?.proxy ? "Yes" : "No", inline: true },
      { name: "City / region", value: city, inline: true },
      { name: "Datacenter", value: geo?.hosting ? "Yes" : "No", inline: true },
      { name: "Mobile", value: geo?.mobile ? "Yes" : "No", inline: true },
      { name: "ISP / org", value: geo?.isp || geo?.org || "Unknown", inline: false },
      { name: "ASN", value: geo?.as || "Unknown", inline: false },
      { name: "Path", value: `\`${pathName || "/"}\``, inline: true },
      { name: "User-Agent", value: `\`\`\`${(ua || "unknown").slice(0, 240)}\`\`\``, inline: false },
    ],
    footer: { text: risk.text },
  };

  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: `${SITE_NAME} Monitor`,
      embeds: [embed],
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Discord ${res.status} ${body.slice(0, 200)}`);
  }
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/visit", visitLimiter, async (req, res) => {
  const ip = clientIp(req);
  const ua = String(req.headers["user-agent"] || "unknown");
  const pathName = typeof req.body?.path === "string" ? req.body.path.slice(0, 80) : "/";

  if (!ip || ip === "127.0.0.1" || ip === "::1") {
    return res.json({ ok: true, skipped: "local" });
  }

  const key = `${ip}|${ua.slice(0, 80)}`;
  const last = recent.get(key);
  if (last && Date.now() - last < DEDUPE_MS) {
    return res.json({ ok: true, skipped: "duplicate" });
  }
  recent.set(key, Date.now());

  let geo = null;
  try {
    geo = await lookupIp(ip);
  } catch (err) {
    console.warn("Geo lookup failed:", err.message);
  }

  try {
    await sendDiscord({ ip, geo, ua, pathName });
  } catch (err) {
    console.error("Discord send failed:", err.message);
    return res.status(502).json({ ok: false, error: "notify_failed" });
  }

  res.json({ ok: true });
});

setInterval(() => {
  const cutoff = Date.now() - DEDUPE_MS;
  for (const [key, ts] of recent) {
    if (ts < cutoff) recent.delete(key);
  }
}, 60 * 1000).unref();

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`${SITE_NAME} listening on 0.0.0.0:${PORT}`);
});
