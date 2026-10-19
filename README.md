# PayConfirm

**Accept UPI payments straight into your own bank account, and have your website know automatically when a customer has paid.**

- 0% gateway fees. Money goes from the customer's UPI app directly to **your** bank account.
- No third-party servers and no monthly bills. You run it yourself.
- Nothing to install except Node.js.

> **New here?** Read sections 1 and 2, then follow **section 4 (Setup A)** from top to bottom. Every command is in a box you can copy. Do the steps in order and do not skip any.

---

## Contents

1. [What it is, and what it is not](#1-what-it-is-and-what-it-is-not)
2. [How it works](#2-how-it-works)
3. [Choose your setup](#3-choose-your-setup)
4. [Setup A: everything on one Android phone (easiest)](#4-setup-a-everything-on-one-android-phone-easiest)
5. [Setup B: server on your PC, 24/7](#5-setup-b-server-on-your-pc-247)
6. [Setup C: server on a VPS](#6-setup-c-server-on-a-vps)
7. [Connect your website](#7-connect-your-website)
8. [Admin page](#8-admin-page)
9. [Test it](#9-test-it)
10. [Every day use: start, stop, check](#10-every-day-use-start-stop-check)
11. [Settings reference](#11-settings-reference)
12. [Troubleshooting](#12-troubleshooting)
13. [Security, legal and limits](#13-security-legal-and-limits)
14. [All commands in one place](#14-all-commands-in-one-place)

---

## 1. What it is, and what it is not

PayConfirm is a **payment confirmation tool**. It does **not** hold, move or settle money.

| | |
|---|---|
| Customer pays | with any UPI app, by scanning a QR or typing your UPI ID |
| Money lands | directly in **your** bank account, as fast as UPI itself (usually seconds) |
| PayConfirm's job | notice that the money arrived, and tell your website "order X is paid" |

It is **not** a licensed payment aggregator. It does not do refunds, split payments, payouts to others, or chargeback protection. For those you need a regulated gateway (Razorpay, PhonePe, Cashfree and others).

**Read these four limits before you sell to customers:**

1. **It needs an Android phone** that receives your bank's SMS and/or UPI-app notifications. The phone must stay on, charged and online. If the phone is off, payments are not confirmed.
2. **Some payments produce no alert.** Banks often send no SMS for small amounts (usually under about ₹100). UPI-app notifications (for example PhonePe) are not guaranteed either. Always keep the manual fallback: the **Mark paid** button in the admin page (section 8).
3. **The "Open UPI app" button is often declined for a personal UPI ID.** Apps such as PhonePe and FamPay can show "payment declined for security reasons" or "transaction not created". Paying by **UPI ID** or **QR** works. A **merchant/business UPI ID** (for example from PhonePe Business or a current account) usually allows the button. See section 12.
4. **The customer must pay the exact amount shown**, including paise. That exact amount is how PayConfirm knows which order was paid.

## 2. How it works

```
Your website --(1) create payment--> PayConfirm server
                                        | gives a pay page with a QR for e.g. Rs 245.37
Customer pays Rs 245.37 in any UPI app ----------------> Your bank account
                                        |
Bank SMS / UPI-app notification --> Phone watcher --(2)--> PayConfirm server
                                        | matches Rs 245.37 to the right order
Your website <--(3) signed "paid" message (webhook)--+
```

Each open order gets a **unique amount**: order total plus 1 to 99 paise (for example ₹245.37). The incoming alert is matched to the order by that exact amount. A payment is held for 15 minutes by default.

There are two programs:

- the **server** (`server.js`): creates payments, shows the pay page, marks orders paid, sends webhooks. It can run anywhere.
- the **watcher** (`watcher/watcher.js`): runs in Termux on the Android phone that receives your bank alerts. It reads new SMS and notifications and sends the ones that look like money received to the server.

## 3. Choose your setup

| Setup | Where the server runs | Where the watcher runs | Best for |
|---|---|---|---|
| **A** (easiest) | the Android phone | the same phone | trying it out, one small shop |
| **B** | your PC, on 24/7 | the Android phone | a shop with a PC that is always on |
| **C** | a cloud server (VPS) | the Android phone | always on, without a PC |

In every setup the watcher is on the Android phone, so **Steps 1 to 4 of Setup A are needed in all three setups.** Setups B and C then tell you what to do on the server.

---

## 4. Setup A: everything on one Android phone (easiest)

You need: an Android phone (Android 8 or newer), the SIM that is registered with your bank, internet, and about 30 minutes.

> Keep the **SIM in the phone**. Bank SMS and UPI apps depend on it.

### Step 1. Install the apps (from F-Droid, not the Play Store)

The Play Store version of Termux is outdated and will not work. Install all of these from F-Droid:

| App | What it is for | Link |
|---|---|---|
| **Termux** | the terminal where everything runs | https://f-droid.org/packages/com.termux/ |
| **Termux:API** | lets Termux read SMS and notifications | https://f-droid.org/packages/com.termux.api/ |
| **Termux:Boot** (optional) | starts everything after a phone restart | https://f-droid.org/packages/com.termux.boot/ |
| **F-Droid** (optional) | an app store that makes installs and updates easier | https://f-droid.org |

How to install: open a link above in your phone browser, scroll down to **Download APK**, open the downloaded file, and allow "install from this source" if Android asks.

Install **Termux and Termux:API from the same place** (both from F-Droid). A mix of Play Store and F-Droid versions will not work.

**If Android says "App blocked to protect your phone"** (Google Play Protect):
- Tap **More details**, then **Install anyway**.
- If there is no such option: open the Play Store, tap your profile picture, **Play Protect**, the gear icon, and turn off **Scan apps with Play Protect**. Install the app, then turn it back on.
- On Samsung phones also check Settings > Security and privacy > **Auto Blocker**. Turn it off while installing.
- Or install the F-Droid app first and install Termux and Termux:API from inside it.

Open **Termux** once so it finishes its first setup.

### Step 2. Give the permissions

This is the step most people miss. Do **all** of the following.

**2a. SMS and Contacts for Termux:API**
1. Open Android **Settings** > **Apps** > **Termux:API** > **Permissions**.
2. Set **SMS** to **Allow**.
3. Set **Contacts** to **Allow**. (Without Contacts, reading SMS fails with `grant READ_CONTACTS`.)

**2b. Notification access for Termux:API** (needed to read UPI-app notifications)
1. Open Android **Settings** and search for **Notification access** (on some phones: Settings > Notifications > Device & app notifications).
2. Switch **Termux:API** to **On**.
3. If Android says **"Restricted setting"**: go to Settings > Apps > **Termux:API**, tap the **three dots** at the top right, tap **Allow restricted settings**, then repeat 2b.

**2c. Stop Android from killing Termux**
1. Settings > Apps > **Termux** > **Battery** > set **Unrestricted**.
2. Do the same for **Termux:API** (and **Termux:Boot** if you installed it).
3. Optional but recommended: keep the phone on a charger.

**2d. Storage permission** (so Termux can see the downloaded zip). You will do this in Step 4.

### Step 3. Install the tools in Termux

Open Termux and run these, one box at a time. If it asks "Do you want to continue? [Y/n]", type `Y` and press Enter.

```bash
pkg update
```
```bash
pkg install -y nodejs termux-api unzip git
```

Check the Node.js version. It **must be 22.5 or higher**:
```bash
node -v
```

Now test the two permissions from Step 2:
```bash
termux-sms-list -l 1
```
This should print your latest SMS as text. If it asks for permission, allow it. If it says `grant READ_CONTACTS`, repeat Step 2a.

```bash
termux-notification-list
```
This should print your current notifications and finish in a couple of seconds. If it **hangs**, press **Ctrl+C** and repeat Step 2b.

### Step 4. Get PayConfirm onto the phone

**Option 1: from the GitHub link you received** (the repo is private; you must be added as a collaborator first)
```bash
cd ~
git clone https://github.com/YOUR_GITHUB_USERNAME/payconfirm.git
```
Git asks for your GitHub username, then a password. The password is a **personal access token**, not your GitHub password. Create one at https://github.com/settings/tokens (choose "Tokens (classic)", tick **repo**).

**Option 2: from the zip file**
```bash
termux-setup-storage
```
Allow the storage permission. Then:
```bash
cd ~
unzip ~/storage/downloads/payconfirm.zip
```
If your zip is named differently (for example `payconfirm (1).zip`), use that name.

Check that the folder exists:
```bash
cd ~/payconfirm && ls
```
You should see `server.js`, `watcher`, `README.md` and others.

### Step 5. Create your settings file (`.env`)

The `.env` file holds your private settings. It is **not** in the download (a ready-made one would be shared by everyone). You create it from the template `.env.example`. A file whose name starts with a dot is hidden by many file managers; that is normal.

```bash
cd ~/payconfirm
cp .env.example .env
```

Make two secrets. Run this command **twice** and copy each answer somewhere safe:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```
- the first answer is your **API_KEY**
- the second answer is your **WATCHER_SECRET**

Open the file:
```bash
nano .env
```

Change these lines. Each line is `NAME=value`, with **no spaces and no quotes**:

```
UPI_VPA=yourname@bank
API_KEY=paste-your-first-secret-here
WATCHER_SECRET=paste-your-second-secret-here
MERCHANT_NAME=My Store
PUBLIC_URL=http://localhost:8080
ACCOUNT_LAST4=1234
```

- `UPI_VPA`: the UPI ID that pays into your bank account.
- `ACCOUNT_LAST4`: the last 4 digits of your bank account number (as written in your bank SMS, for example `X1234`).
- Leave `PUBLIC_URL` as it is for now. You will change it in Step 9.

How to use nano: move with the arrow keys and type. To **save**, press **Ctrl+X**, then **Y**, then **Enter**.
Do **not** type or paste commands (such as `npm start`) into this file. Every line must be either a `#` comment or `NAME=value`.

### Step 6. Run the self-test

```bash
npm test
```
It takes a few seconds and moves no money. It must end with `ALL TESTS PASSED`.

### Step 7. Start the server

```bash
npm start
```
You should see `PayConfirm running on http://127.0.0.1:8080`. Leave this running.

If it refuses to start, it prints which line in `.env` to fix. It is not a bug: the server will not start with a missing, too-short (under 16 characters) or `change-me` secret.

**Open a new Termux session** for the next steps. Swipe in from the left edge of the screen and tap **New session**.

Check it works:
```bash
curl -s http://127.0.0.1:8080/health
```
It should print `{"ok":true}`.

> After you change `.env` or any file, press **Ctrl+C** in the server session and run `npm start` again. The server only reads its files when it starts.

### Step 8. Start the watcher

In the new session:
```bash
cd ~/payconfirm/watcher
```

Set the three values. Replace the text in capitals with your own values, and keep the quotes:

```bash
sed -i 's#^export SERVER_URL=.*#export SERVER_URL="http://127.0.0.1:8080"#' start.sh
```
```bash
sed -i 's#^export WATCHER_SECRET=.*#export WATCHER_SECRET="PASTE_YOUR_WATCHER_SECRET_HERE"#' start.sh
```
```bash
sed -i 's#^export SENDER_MATCH=.*#export SENDER_MATCH="SBI"#' start.sh
```

- `WATCHER_SECRET` must be **exactly the same** as in your `.env`.
- `SENDER_MATCH` is a word from the name that your bank's SMS shows as the sender (for example `SBI`, `HDFC`, `ICICI`). Use several with commas: `SBI,HDFC`.
- Never paste commands or README text inside `start.sh`. If you want to edit it by hand, use `nano start.sh` and only change the values between the quotes.

Check the file looks right:
```bash
cat start.sh
```
Start it:
```bash
bash start.sh
```
It prints `Watcher started.` Watch the log (press **Ctrl+C** to stop watching; the watcher keeps running):
```bash
tail -f watcher.log
```
On the first run the log says `Baseline saved. Only new messages from now on will be sent.` Old messages are ignored on purpose.

To check the watcher is running at any time:
```bash
pgrep -af watcher.js
```
If it prints nothing, run `bash start.sh` again.

### Step 9. Give the server a public address

Customers' phones cannot reach `localhost`, so you need a public HTTPS address. A free Cloudflare Tunnel does this with no router settings.

In a **third Termux session**:
```bash
pkg install -y cloudflared
```
```bash
cloudflared tunnel --url http://localhost:8080
```
After a few seconds it prints an address like `https://something-random.trycloudflare.com`. Leave this running.

Put that address in `.env`. Replace the address below with yours (no trailing slash):
```bash
cd ~/payconfirm
sed -i 's#^PUBLIC_URL=.*#PUBLIC_URL=https://something-random.trycloudflare.com#' .env
```
Then restart the server: in the server session press **Ctrl+C** and run `npm start`.

> This quick address **changes every time cloudflared restarts**. It is fine for testing. For a shop, make a **permanent** address: create a free Cloudflare account, add your domain, create a **named tunnel** in the Cloudflare dashboard (Zero Trust > Networks > Tunnels) and point `pay.yourdomain.com` to `http://localhost:8080`. Guide: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/

### Step 10. Make a test payment

Go to section 9 and do Tests 2 and 3 before you use PayConfirm with real customers.

### Step 11. Keep it running after a restart (optional)

Open the **Termux:Boot** app once (from Step 1). Then in Termux:
```bash
mkdir -p ~/.termux/boot
```
```bash
cat > ~/.termux/boot/payconfirm.sh <<'BOOT'
#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock
cd ~/payconfirm && nohup npm start >> server.log 2>&1 &
cd ~/payconfirm/watcher && bash start.sh
BOOT
```
```bash
chmod +x ~/.termux/boot/payconfirm.sh
```
Restart the phone and check with `pgrep -af "server.js|watcher.js"`. This boot step has had little testing; if it does not start, start the server and watcher by hand as in Steps 7 and 8. The tunnel (Step 9) is not started by this script, so for a permanent setup run a named tunnel as a service or start it by hand.

**Setup A is done.** Continue with section 7 to connect your website.

---

## 5. Setup B: server on your PC, 24/7

The **watcher stays on the phone** (do Steps 1 to 4 and Step 8 of Setup A). Only the server moves to the PC.

**On the PC:**

1. Install **Node.js 22.5 or newer** from https://nodejs.org (choose "LTS" or "Current", then check with `node -v`).
2. Unzip PayConfirm and open a terminal in the folder (Windows: Command Prompt or PowerShell; Mac and Linux: Terminal):
   ```bash
   cd payconfirm
   ```
3. Create the settings file:
   ```bash
   cp .env.example .env
   ```
   On Windows use `copy .env.example .env`.
4. Make two secrets (run twice):
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
5. Edit `.env` (Windows: `notepad .env`; Mac and Linux: `nano .env`) and fill in the same values as in Setup A Step 5. Keep `HOST=127.0.0.1`.
6. Test, then start:
   ```bash
   npm test
   ```
   ```bash
   npm start
   ```
   Open `http://localhost:8080/admin` in the PC browser. If it loads, the server works.
7. **Keep it running** after you close the window:
   ```bash
   npm install -g pm2
   ```
   ```bash
   pm2 start server.js --name payconfirm --node-args="--disable-warning=ExperimentalWarning"
   ```
   ```bash
   pm2 save
   ```
   ```bash
   pm2 startup
   ```
   Run the one line that `pm2 startup` prints, so it restarts after a reboot. On Windows use **Task Scheduler**: create a task "At startup" that runs `node server.js` in the PayConfirm folder.
8. **Public address:** install `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run:
   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```
   This is a temporary address. For a permanent one, create a named tunnel (see Setup A Step 9). Put the address in `.env` as `PUBLIC_URL` and restart.
9. In the PC's power settings, **turn off sleep**. If the PC is off, payments are not confirmed until it is back on.

**On the phone:** in `watcher/start.sh` set `SERVER_URL` to your **public address** (not `127.0.0.1`), and `WATCHER_SECRET` to the same value as in the PC's `.env`. Then `bash start.sh`.

---

## 6. Setup C: server on a VPS

The **watcher stays on the phone** (Steps 1 to 4 and Step 8 of Setup A). Only the server moves to the cloud. A small Linux VPS (1 vCPU, 1 GB RAM) is plenty. You also need a **domain name**.

**On a fresh Ubuntu 22.04 or 24.04 server** (log in with SSH):

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```
```bash
sudo apt install -y nodejs caddy unzip
```
```bash
sudo useradd -r -m payconfirm
sudo mkdir /opt/payconfirm
```
Upload the files into `/opt/payconfirm` (with `scp` or an SFTP app, or `git clone` into it), then:
```bash
cd /opt/payconfirm
sudo cp .env.example .env
sudo nano .env
```
Fill in `UPI_VPA`, `API_KEY`, `WATCHER_SECRET`, `MERCHANT_NAME`, `ACCOUNT_LAST4` and `PUBLIC_URL=https://pay.yourdomain.com`.
```bash
sudo chown -R payconfirm:payconfirm /opt/payconfirm
sudo cp deploy/payconfirm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now payconfirm
```
Free automatic HTTPS: open `deploy/Caddyfile` and put your own domain in it, then:
```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
Then:
1. In your domain's DNS settings, add an **A record**: name `pay`, value = the server's IP address.
2. In the VPS firewall, open ports **80 and 443**.
3. Check: `sudo systemctl status payconfirm`, and open `https://pay.yourdomain.com/health` in a browser.

Back up `/opt/payconfirm/data/payconfirm.sqlite` regularly. It is your payment record.

**On the phone:** set `SERVER_URL` in `watcher/start.sh` to `https://pay.yourdomain.com` and `WATCHER_SECRET` to the value from the server's `.env`. Then `bash start.sh`.

---

## 7. Connect your website

Keep your `API_KEY` on your **server**. **Never** put it in browser or app code.

**Step 1. Create a payment** (from your backend). Use a **new `orderId` every time**:
```bash
curl -s -X POST https://pay.yourdomain.com/api/payments \
  -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{"orderId":"ORDER-1001","amount":499,"returnUrl":"https://yourshop.com/thanks"}'
```
`amount` is in rupees. Response (shortened):
```json
{ "paymentId": "...", "amount": "499.37", "status": "pending",
  "payUrl": "https://pay.yourdomain.com/pay/...", "upiLink": "upi://pay?...", "expiresAt": 1760000000000 }
```
- Asking again for the same unpaid order returns the same payment and amount.
- Reusing an order that is already paid returns `Order already paid`.

**Step 2. Send the customer to `payUrl`.** It shows the exact amount, the UPI ID with **Copy** buttons, a QR code and an "Open UPI app" button. It updates by itself when the payment is confirmed (no refresh needed) and then sends the customer to your `returnUrl`.
You can also build your own screen from `amount` and `upiLink`, and check the status with:
```bash
curl -s https://pay.yourdomain.com/api/payments/PAYMENT_ID
```
until `status` is `paid`.

**Step 3. Confirm on your server with the webhook.** Do not trust the customer's browser alone. Set `CALLBACK_URL` and `CALLBACK_SECRET` in `.env`. PayConfirm sends this when an order is paid, and retries with growing delays if your server is down:
```json
{ "event": "payment.paid", "paymentId": "...", "orderId": "ORDER-1001",
  "amount": "499.37", "amountPaise": 49937, "utr": "123456789012", "paidAt": 1760000000000 }
```
`utr` is empty when the payment was detected from a notification, because those usually carry no UTR.

Headers: `X-PayConfirm-Timestamp`, and `X-PayConfirm-Signature` = `sha256=` + HMAC-SHA256 of `timestamp + "." + rawBody` using your `CALLBACK_SECRET`.

```js
// Node.js / Express
app.post("/payconfirm-webhook", express.raw({ type: "application/json" }), (req, res) => {
  const crypto = require("crypto");
  const ts = req.headers["x-payconfirm-timestamp"], sig = req.headers["x-payconfirm-signature"] || "";
  const expected = "sha256=" + crypto.createHmac("sha256", process.env.CALLBACK_SECRET)
                    .update(ts + "." + req.body).digest("hex");
  const ok = sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!ok || Math.abs(Date.now() - Number(ts)) > 10 * 60 * 1000) return res.sendStatus(401);
  const e = JSON.parse(req.body);
  if (e.event === "payment.paid") { /* mark e.orderId as paid, once */ }
  res.sendStatus(200);
});
```
Webhooks can arrive more than once. Make your handler safe to repeat.

**Always keep a fallback.** Some payments produce no alert on the phone (section 1). Show customers "Payment not confirmed yet? We will verify it shortly", and use **Mark paid** in the admin page after checking your bank statement.

---

## 8. Admin page

Open `https://pay.yourdomain.com/admin` (or `http://localhost:8080/admin`). Paste your `API_KEY` and press **Load**. After that it refreshes itself every few seconds.

- **Payments:** every order, its exact amount, status (`pending`, `paid`, `expired`), UTR, and whether it was confirmed `auto` or by `admin`.
- **Incoming credits seen:** every credit alert the watcher sent, where it came from (`sms` or `notification`), and the result (`matched`, `unmatched`, `ambiguous`, `duplicate`).
- **Mark paid:** for a payment you have **checked in your bank statement**. Do not press it unless the money is in your account.

---

## 9. Test it

You need the server and the watcher running (two Termux sessions, or two terminals).

**Test 1. Self-test (no money)**
```bash
npm test
```
Expected: `ALL TESTS PASSED`.

**Test 2. Fake bank SMS (proves the matching)**

Create a payment (`TEST1`). Use your own `API_KEY`:
```bash
curl -s -X POST http://127.0.0.1:8080/api/payments -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"orderId":"TEST1","amount":100}'; echo
```
Look at `"amount"` in the answer (for example `100.57`). Send a fake SMS with **that exact amount**:
```bash
curl -s -X POST http://127.0.0.1:8080/api/sms -H "x-watcher-secret: YOUR_WATCHER_SECRET" -H "Content-Type: application/json" -d '{"sms":"Dear Customer, A/c X1234 credited by Rs.100.57 on 18Oct26 transfer from TEST (Ref No 123456789012)"}'; echo
```
Use your own last 4 digits instead of `1234` if you set `ACCOUNT_LAST4`. Expected: `"status":"matched"`, and `TEST1` shows `paid` in the admin page.

**Test 3. A real payment (proves your bank and phone)**
1. Create a payment with a **new** `orderId` and an amount of **100 or more** (`"orderId":"TEST2","amount":100`). Note the exact amount, for example `100.38`.
2. Ask a friend to pay **exactly that amount** to your UPI ID. If you can, do it twice: once from inside PhonePe, and once by scanning the QR from Google Pay or Paytm. Your customers will use different apps.
3. Within a minute or two, `watcher.log` should show a `matched` line and the admin page should show `paid`.
4. For each payment, write down what appeared on the phone: a bank SMS, a UPI-app notification, both, or neither. That tells you which payments PayConfirm can confirm with your bank and apps.

**Test 4. From outside (proves the public address)**

On another phone, using mobile data, open `https://your-public-address/health`. It should show `{"ok":true}`. Then open the `payUrl` of a new payment: you should see the amount, the UPI ID, a QR code and an "Open UPI app" button. After paying exactly that amount, the page switches to "Payment received" by itself.

---

## 10. Every day use: start, stop, check

**Start** (after the phone restarts, if you did not set up Termux:Boot):

| Session | Command |
|---|---|
| 1. Server | `cd ~/payconfirm && npm start` |
| 2. Watcher | `cd ~/payconfirm/watcher && bash start.sh` |
| 3. Tunnel | `cloudflared tunnel --url http://localhost:8080` (then update `PUBLIC_URL` and restart the server if the address changed) |

**Check it is alive**
```bash
curl -s http://127.0.0.1:8080/health
```
```bash
pgrep -af watcher.js
```
```bash
tail -n 5 ~/payconfirm/watcher/watcher.log
```
`tail -n 5` shows the last five lines and exits. To watch live use `tail -f ~/payconfirm/watcher/watcher.log` and press Ctrl+C when done.

**Stop**
```bash
pkill -f watcher.js
```
The server and the tunnel stop with **Ctrl+C** in their sessions.

**Update PayConfirm to a new version:** copy the new files over the old ones, **keep your `.env` and the `data` folder**, then restart the server (Ctrl+C, `npm start`).

**Back up your payment records:**
```bash
cp ~/payconfirm/data/payconfirm.sqlite ~/payconfirm/data/payconfirm-backup.sqlite
```

---

## 11. Settings reference

**Server settings** (in `.env`)

| Setting | Meaning |
|---|---|
| `UPI_VPA` | Your UPI ID. Required |
| `API_KEY` | Secret your website uses to create payments. Required, 16+ characters |
| `WATCHER_SECRET` | Secret the phone watcher uses. Required, 16+ characters |
| `MERCHANT_NAME` | Name shown in the customer's UPI app |
| `PUBLIC_URL` | Your public https address, no trailing slash |
| `PORT` / `HOST` | Default `8080` / `127.0.0.1` (this machine only). Use `0.0.0.0` only if you need LAN access |
| `HOLD_MINUTES` | How long a customer has to pay (default 15) |
| `ACCOUNT_LAST4` | Last 4 digits of your bank account. Bank SMS without them are ignored (does not apply to app notifications) |
| `CALLBACK_URL` / `CALLBACK_SECRET` | Where to send "paid" webhooks, and the secret that signs them (16+ characters) |

**Watcher settings** (in `watcher/start.sh`)

| Setting | Meaning |
|---|---|
| `SERVER_URL` | Address of your server: `http://127.0.0.1:8080` if on the same phone, otherwise your public `https://` address |
| `WATCHER_SECRET` | Must be identical to the server's |
| `SENDER_MATCH` | Words in your bank's SMS sender name, comma separated (for example `SBI,HDFC`) |
| `NOTIFY_APPS` | Parts of app names to read notifications from. Default `phonepe,paisa,paytm,npci,sbi`. Set to `""` to turn notification reading off |

**What the watcher log lines mean**

| Line | Meaning |
|---|---|
| `... "status":"matched"` | Payment confirmed |
| `... "ignored":true` | The message was not money received (offer, debit, request). The log prints the start of the message after `| text:` |
| `... "status":"unmatched"` | Money seen, but no open order has that exact amount |
| `... "status":"duplicate"` | Already counted (for example an SMS and a notification for the same payment) |

---

## 12. Troubleshooting

| Problem | Fix |
|---|---|
| Server will not start | Read the message. It names the line in `.env` to fix. Node must be 22.5 or newer |
| I changed `.env` or a file and nothing changed | Stop the server (Ctrl+C) and run `npm start` again |
| `bash start.sh` shows "shell level too high" and Termux closes | `start.sh` has a stray line such as `bash start.sh` inside it (it calls itself forever). Check with `cat start.sh`, then rewrite the file or reinstall it from the download |
| `Order already paid` when creating a payment | Use a new `orderId` |
| Empty answer from `curl` | The server is not running. Start it with `npm start` |
| Pay URL cut off or not shown | Add `; echo` at the end of the curl command, or use `paymentId` from the answer |
| Payment stays `pending` | The customer paid a different amount, or the link expired, or no alert reached the phone. Check `watcher.log` and the "Incoming credits" table in the admin page |
| Shows `unmatched` | Money seen, but the amount did not match any open order. Verify in your bank statement, then use **Mark paid** on the right order |
| Shows `ambiguous` | Two open orders had the same amount (rare). Match by hand |
| `watcher.log` says `ignored` for a real payment | The wording is new to the parser. Look at the `| text:` printed after it and send it to support so the parser can be extended |
| Watcher log is silent | New lines appear only when an alert arrives. Check `pgrep -af watcher.js`, that `termux-sms-list -l 1` and `termux-notification-list` work, that battery is **Unrestricted**, and that `SERVER_URL` is reachable from the phone |
| `termux-sms-list` says grant READ_CONTACTS | Termux:API > Permissions: allow **Contacts** and **SMS** |
| `termux-notification-list` hangs | Turn on **Termux:API** under Notification access (and "Allow restricted settings" if shown) |
| No SMS for a small test payment | Banks often skip alerts for tiny amounts. Test with ₹100 or more |
| Paid by QR from another app and nothing happened | That payment produced no alert on the phone. Use the fallback (**Mark paid**) |
| Customer's app says "payment declined for security reasons" or "transaction not created" after tapping **Open UPI app** | Apps such as PhonePe and FamPay can block payment links to a **personal** UPI ID, and sometimes allow them. It is the app's rule, not a PayConfirm fault. Tell customers to pay by **UPI ID** (Copy buttons on the pay page, then type the exact amount) or by **QR** (scan from another phone, or take a screenshot and choose Scan from gallery in their UPI app). A **merchant/business UPI ID** usually allows the app button |
| A UPI app refuses the payment | The app's own rule (some teen or prepaid apps cannot pay personal UPI IDs). Try another app |
| Payment page does not switch to "paid" by itself | Make sure the server has the latest `server.js`. The page checks every 3 seconds and when the customer returns to the tab |
| "App blocked to protect your phone" | See Step 1 of Setup A |
| Quick tunnel address changed | It changes every time cloudflared restarts. Update `PUBLIC_URL` and restart the server, or use a named tunnel |
| Notifications stop after a while | Battery must be **Unrestricted** for Termux and Termux:API; the phone must stay online; run `termux-wake-lock` |
| Customer says the amount looks odd | The extra paise are how payments are matched. Tell customers to pay exactly the amount shown |
| I removed the SIM | Keep the SIM in. Bank SMS and UPI apps depend on it |

---

## 13. Security, legal and limits

- Your `.env` and the `data/` folder hold secrets and payment records (payer names can appear in stored notification text). **Never upload them to GitHub or share them.** Keep `HOST=127.0.0.1` and put HTTPS (Cloudflare Tunnel or Caddy) in front.
- **Make your own secrets.** Never reuse a secret you have pasted into a chat, email or screenshot.
- The phone watcher can read that phone's SMS and notifications. Use a phone you control and keep it locked.
- Detection relies on text alerts, which in rare cases can be faked by a sender with a look-alike name. Keep `ACCOUNT_LAST4` set, and for high-value orders check your bank statement before shipping.
- Receiving business payments on a **personal** bank account can be flagged by banks. Check your bank's rules and consider a current account. You are responsible for tax, GST and any rules that apply to your business.
- This is a confirmation tool, not a payment gateway. If you need every payment guaranteed, refunds, or settlements to other parties, use a licensed gateway.
- Provided "as is", without warranty. This is not legal or financial advice.

---

## 14. All commands in one place

```bash
# --- Termux setup (phone) ---
pkg update && pkg install -y nodejs termux-api unzip git cloudflared
termux-setup-storage
termux-sms-list -l 1                 # test SMS permission
termux-notification-list             # test notification access

# --- install and configure ---
cd ~ && unzip ~/storage/downloads/payconfirm.zip && cd payconfirm
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"   # run twice for 2 secrets
nano .env
npm test

# --- run (three Termux sessions) ---
cd ~/payconfirm && npm start                               # 1. server
cd ~/payconfirm/watcher && bash start.sh                   # 2. watcher
cloudflared tunnel --url http://localhost:8080             # 3. public address

# --- check ---
curl -s http://127.0.0.1:8080/health
pgrep -af watcher.js
tail -f ~/payconfirm/watcher/watcher.log                   # Ctrl+C to stop viewing

# --- stop ---
pkill -f watcher.js                                        # server and tunnel: Ctrl+C

# --- use ---
curl -s -X POST http://127.0.0.1:8080/api/payments -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"orderId":"ORDER-1","amount":100}'; echo
curl -s http://127.0.0.1:8080/api/payments/PAYMENT_ID; echo
# admin page: http://localhost:8080/admin

# --- backup ---
cp ~/payconfirm/data/payconfirm.sqlite ~/payconfirm/data/payconfirm-backup.sqlite
```

---
*Version 1.2*

