# PayConfirm

**Accept UPI payments straight into your own bank account and have your website know, automatically, when a customer has paid.**

- 0% gateway fees. Money goes from the customer's UPI app directly to **your** bank account.
- No third-party servers, no monthly bills. You run it yourself, on your PC or on a small cloud server (VPS).
- Zero dependencies. Nothing to install except Node.js.

---

## 1. What it is (and what it is not)

PayConfirm is a **payment confirmation tool**. It does **not** hold, move or settle money.

| | |
|---|---|
| Customer pays | by scanning a QR / tapping a UPI link, with any UPI app |
| Money lands | directly in your bank account, as fast as UPI itself (usually seconds) |
| PayConfirm's job | notice that the money arrived and tell your website "order X is paid" |

It is **not** a licensed payment aggregator. It does not do refunds, split payments, payouts to others, or chargeback protection. For those you need a regulated gateway (Razorpay, PhonePe, Cashfree, etc.).

## 2. How it works

```
Your website ──(1) create payment──▶  PayConfirm server
                                          │ returns a pay page with a QR for e.g. ₹245.37
Customer pays ₹245.37 in any UPI app ─────┼──────────▶ Your bank account
                                          │
Bank SMS / UPI-app notification ─▶ Phone watcher ──(2)──▶ PayConfirm server
                                          │ matches amount ₹245.37 to the order
Your website ◀──(3) signed "paid" webhook─┘
```

Each open order gets a **unique amount** (order total + 1 to 99 paise, e.g. ₹245.37). That exact amount is how the incoming bank alert is matched to the right order. The customer types nothing.

**You need a phone that receives your bank's SMS or UPI-app notifications** (an Android phone with Termux, always on). If neither arrives for your bank, PayConfirm cannot see payments. Use the admin page (section 8) to confirm manually.

## 3. Requirements

- **Node.js 22.5 or newer** (https://nodejs.org). Check with `node -v`.
- A UPI ID that receives money in your bank account.
- An Android phone that gets your bank's credit SMS or UPI-app notifications.
- A public HTTPS address for the server (sections 5 and 6 show how).

## 4. Quick start (any computer)

```bash
# 1. Get the files (unzip, then open a terminal in the folder)
cd payconfirm

# 2. Create your settings file
cp .env.example .env          # Windows: copy .env.example .env

# 3. Make two secrets (run twice, paste one into API_KEY and one into WATCHER_SECRET)
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"

# 4. Edit .env: set UPI_VPA, API_KEY, WATCHER_SECRET, MERCHANT_NAME, PUBLIC_URL
#    (Windows: notepad .env     Mac/Linux: nano .env)

# 5. Check everything works (takes 3 seconds)
npm test

# 6. Start it
npm start
```

Open `http://localhost:8080/admin`. If it loads, you are running.

> The server refuses to start if the secrets are missing, too short, or still say `change-me`. This is on purpose.

## 5. Option A: run it on your own PC, 24/7

Good for: trying it out, a shop with a PC that is always on.

1. **Keep it running** even after you close the window:
   ```bash
   npm install -g pm2
   pm2 start server.js --name payconfirm --node-args="--disable-warning=ExperimentalWarning"
   pm2 save
   pm2 startup        # follow the one line it prints, so it restarts after a reboot
   ```
   Windows alternative: Task Scheduler, "At startup", run `node server.js` in this folder.
2. **Give it a public HTTPS address** with a free Cloudflare Tunnel (no router settings needed):
   - Install `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
   - Quick test address: `cloudflared tunnel --url http://localhost:8080` (prints a temporary `https://….trycloudflare.com`).
   - Permanent address on your own domain: create a named tunnel in the Cloudflare dashboard and point `pay.yourdomain.com` to `http://localhost:8080`.
3. Put that address in `.env` as `PUBLIC_URL`, then restart.
4. In the PC's power settings, turn off sleep. If the PC is off, payments are not confirmed until it is back on.

## 6. Option B: run it on a cloud server (VPS)

Good for: always-on without keeping a PC running. Any small Linux VPS works (1 vCPU / 1 GB RAM is plenty).

```bash
# On a fresh Ubuntu 22.04/24.04 server
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs caddy unzip

sudo useradd -r -m payconfirm
sudo mkdir /opt/payconfirm
# upload the files into /opt/payconfirm (scp / sftp), then:
cd /opt/payconfirm
sudo cp .env.example .env && sudo nano .env       # fill in your settings
sudo chown -R payconfirm:payconfirm /opt/payconfirm

sudo cp deploy/payconfirm.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now payconfirm

# HTTPS (free, automatic): edit the domain inside deploy/Caddyfile first
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Point your domain's DNS **A record** (`pay.yourdomain.com`) to the server's IP address. Open ports 80 and 443 in the VPS firewall. Set `PUBLIC_URL=https://pay.yourdomain.com` in `.env` and run `sudo systemctl restart payconfirm`.

Back up `/opt/payconfirm/data/payconfirm.sqlite` regularly. It is your payment record.

## 7. Connect the phone (the part that notices payments)

Use the Android phone that receives your bank's SMS. Keep it charged and online.

1. Install **Termux** and **Termux:API** from **F-Droid** (not the Play Store version).
2. In Termux:
   ```bash
   pkg update && pkg install nodejs termux-api
   termux-sms-list -l 1          # accept the SMS permission
   termux-notification-list      # if it asks, grant "Notification access" to Termux:API in Android settings
   ```
3. Copy the `watcher` folder to the phone. Edit `start.sh`:
   - `SERVER_URL` = your public address
   - `WATCHER_SECRET` = the same value as in your server `.env`
   - `SENDER_MATCH` = a word in your bank's SMS sender name (e.g. `SBI`, `HDFC`)
4. Start it: `bash start.sh`. Watch it: `tail -f watcher.log`.
5. Android settings: Apps > Termux > Battery > **Unrestricted**. Otherwise Android stops it in the background.

The watcher reads (a) new SMS from your bank and (b) notifications from UPI and bank apps (PhonePe, Google Pay, Paytm, BHIM, SBI). It only sends messages that look like an incoming credit.

**Test before going live:** create a payment for ₹100 or more and pay the exact amount. Many banks do not send alerts for very small amounts (often under ₹100), so a ₹1 test can look like a failure when nothing is wrong.

## 8. Connect your website

Keep your `API_KEY` on your **server**, never in website/browser code.

**Step 1: create a payment (your backend)**

```bash
curl -X POST https://pay.yourdomain.com/api/payments \
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{"orderId":"ORDER-1001","amount":499,"returnUrl":"https://yourshop.com/thanks"}'
```
Response (shortened):
```json
{ "paymentId": "…", "amount": "499.37", "status": "pending",
  "payUrl": "https://pay.yourdomain.com/pay/…", "upiLink": "upi://pay?…", "expiresAt": 1760000000000 }
```

**Step 2: send the customer to `payUrl`.** It shows the exact amount, a QR code, an "Open UPI app" button, and updates by itself when paid. After paying it sends the customer to your `returnUrl`.
You can also build your own screen from `amount` and `upiLink`, and poll `GET /api/payments/{paymentId}` until `status` is `paid`.

**Step 3: confirm on your server with the webhook** (do not trust the browser alone). Set `CALLBACK_URL` and `CALLBACK_SECRET` in `.env`. PayConfirm will POST this when an order is paid, and retry for hours if your server is down:

```json
{ "event": "payment.paid", "paymentId": "…", "orderId": "ORDER-1001",
  "amount": "499.37", "amountPaise": 49937, "utr": "123456789012", "paidAt": 1760000000000 }
```
Headers: `X-PayConfirm-Timestamp` and `X-PayConfirm-Signature` = `sha256=` + HMAC-SHA256 of `timestamp + "." + rawBody` using your `CALLBACK_SECRET`.

```js
// Node.js / Express
app.post("/payconfirm-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const ts = req.headers["x-payconfirm-timestamp"], sig = req.headers["x-payconfirm-signature"] || "";
  const expected = "sha256=" + require("crypto").createHmac("sha256", process.env.CALLBACK_SECRET)
                    .update(ts + "." + req.body).digest("hex");
  const okSig = sig.length === expected.length && require("crypto").timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!okSig || Math.abs(Date.now() - Number(ts)) > 10 * 60 * 1000) return res.sendStatus(401);
  const e = JSON.parse(req.body);
  if (e.event === "payment.paid") { /* mark e.orderId as paid, once */ }
  res.sendStatus(200);
});
```
Webhooks can arrive more than once. Make your handler safe to repeat.

## 9. Admin page

`https://pay.yourdomain.com/admin`, sign in with your `API_KEY`. It shows:
- every payment and its status (`pending`, `paid`, `expired`)
- every bank alert the server saw, and whether it was `matched`, `unmatched`, `ambiguous` or `duplicate`
- a **Mark paid** button for payments the phone missed (check your bank statement first)

## 10. Settings reference (`.env`)

| Setting | Meaning |
|---|---|
| `UPI_VPA` | Your UPI ID. Required |
| `API_KEY` | Secret your website uses to create payments. Required, 16+ characters |
| `WATCHER_SECRET` | Secret the phone watcher uses. Required, 16+ characters |
| `MERCHANT_NAME` | Name shown in the customer's UPI app |
| `PUBLIC_URL` | Your public https address, no trailing slash |
| `PORT` / `HOST` | Default `8080` / `127.0.0.1` (this machine only). Use `0.0.0.0` only if you need LAN access |
| `HOLD_MINUTES` | How long a customer has to pay (default 15) |
| `ACCOUNT_LAST4` | Last 4 digits of your account; SMS without them are ignored |
| `CALLBACK_URL` / `CALLBACK_SECRET` | Where to send "paid" webhooks, and the secret that signs them |

## 11. Troubleshooting

| Problem | Fix |
|---|---|
| Server will not start | Read the message; usually a missing/short secret in `.env`. Node must be 22.5+ |
| Payment never turns `paid` | Check `watcher.log` on the phone. Did the SMS/notification arrive? Is `SERVER_URL` correct and reachable from the phone? |
| Bank sends no SMS | Small amounts are often skipped. Try ₹100+. Check your bank's SMS-alert registration. Enable notification reading (`NOTIFY_APPS`) |
| Shows `unmatched` in admin | Customer paid a different amount, or after the link expired. Match it by hand with **Mark paid** |
| Shows `ambiguous` | Two open orders had the same amount (rare). Match by hand |
| Watcher stops after a while | Android battery setting for Termux must be **Unrestricted**; run `termux-wake-lock` |
| Customer says "amount looks odd" | The extra paise are how payments are matched. Tell customers to pay exactly the amount shown |

## 12. Security and legal notes

- Your `.env` and `data/` folder hold secrets and payment records. Never upload them to GitHub or share them.
- Keep `HOST=127.0.0.1` and put HTTPS (Cloudflare Tunnel or Caddy) in front.
- The phone watcher can read that phone's SMS and notifications. Use a dedicated phone or a phone you control, and lock it.
- Detection relies on text messages, which can in rare cases be faked by a sender using a look-alike name. Keep `ACCOUNT_LAST4` set, and for high-value orders check your bank statement before shipping.
- Receiving business payments on a **personal** bank account can be flagged by banks. Check your bank's rules, and consider a current account.
- You are responsible for tax, GST and any regulatory requirements for your business. This software is not legal or financial advice.
- Provided "as is", without warranty.

---
*Version 1.0*
