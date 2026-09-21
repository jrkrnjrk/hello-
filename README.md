# Visitor Alert

A small website that, on each visit, looks up the visitor’s public IP and country and checks common VPN / proxy / datacenter signals, then posts that to a Discord webhook.

The webhook URL stays on the server. Browsers cannot post to Discord webhooks directly because of CORS.

## Deploy on Railway

1. Create a Discord webhook  
   Channel settings → Integrations → Webhooks → New Webhook → Copy Webhook URL.

2. Put this project on GitHub  
   Create a new repo and upload the `visitor-alert` folder contents. Do **not** commit a real webhook URL.

3. In [Railway](https://railway.com):
   - New Project → Deploy from GitHub repo
   - Pick the repo
   - Railway will detect Node and run `npm start`

4. Before the first successful boot, open the service → **Variables** and add:

   | Name | Value |
   |---|---|
   | `DISCORD_WEBHOOK_URL` | your webhook URL |
   | `SITE_NAME` | optional, default `Secure Gate` |
   | `NODE_ENV` | `production` |

   Railway sets `PORT` for you. Do not hardcode a port.

5. Open the service → **Settings → Networking → Generate Domain**.  
   Visit `https://your-app.up.railway.app`. You should get a Discord embed with the visitor IP, country, and VPN/proxy flag.

If the deploy crashes immediately, the webhook variable is missing or not a valid Discord URL. Check **Deployments → View Logs**.

### Railway CLI (no GitHub)

```bash
npm i -g @railway/cli
cd visitor-alert
railway login
railway init
railway variable set DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/...."
railway up
railway domain
```

## What gets sent

- Public IP
- Country and city (best effort)
- VPN / proxy / Tor flag
- Datacenter / hosting flag
- ISP, ASN, user agent, path, timestamp

Detection uses [ip-api.com](https://ip-api.com/) `proxy` and `hosting` fields. That is a heuristic, not a guarantee someone is on a VPN.

Free ip-api is HTTP-only, 45 requests/minute, and non-commercial. For production, switch to a paid HTTPS provider.

## Local run

```bash
export DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/...."
npm install
npm start
```

Open http://localhost:3000  
Localhost visits are skipped on purpose. Use the Railway URL to test a real public IP.

## Limits built in

- 8 visit posts per IP per minute
- Same IP + user-agent is not resent for 2 minutes
- Webhook URL is never sent to the browser

## Legal / use

IP addresses are personal data in many places. Use this only on a site you control, tell people you log access if required, and do not use it to harvest visitors, stalk people, or run phishing pages.
