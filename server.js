"use strict";
// PayConfirm — zero-dependency UPI payment confirmation server (Node 22.5+).
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { parseCredit } = require("./parse");

try { // tiny .env loader
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const E = process.env;
const cfg = {
  port: +(E.PORT || 8080), host: E.HOST || "127.0.0.1",
  apiKey: E.API_KEY, watcherSecret: E.WATCHER_SECRET, vpa: E.UPI_VPA,
  name: E.MERCHANT_NAME || "Store", holdMs: +(E.HOLD_MINUTES || 15) * 60000,
  last4: E.ACCOUNT_LAST4 || "", callbackUrl: E.CALLBACK_URL || "", callbackSecret: E.CALLBACK_SECRET || "",
  publicUrl: (E.PUBLIC_URL || "").replace(/\/$/, "") || `http://localhost:${E.PORT || 8080}`,
  dbPath: E.DB_PATH || path.join(__dirname, "data", "payconfirm.sqlite"),
};
const bad = [];
for (const k of ["UPI_VPA", "API_KEY", "WATCHER_SECRET"]) if (!E[k] || /^(change-me|yourname@)/.test(E[k])) bad.push(k);
for (const k of ["API_KEY", "WATCHER_SECRET"]) if (E[k] && E[k].length < 16) bad.push(k + " (min 16 characters)");
if (cfg.callbackUrl && cfg.callbackSecret.length < 16) bad.push("CALLBACK_SECRET (min 16 characters when CALLBACK_URL is set)");
if (bad.length) { console.error("Fix these in your .env file, then start again:\n - " + bad.join("\n - ")); process.exit(1); }

fs.mkdirSync(path.dirname(cfg.dbPath), { recursive: true });
const db = new DatabaseSync(cfg.dbPath);
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS payments(
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, base_paise INTEGER NOT NULL, amount_paise INTEGER NOT NULL,
  status TEXT NOT NULL, utr TEXT, return_url TEXT, created_at INTEGER, expires_at INTEGER, paid_at INTEGER,
  paid_by TEXT, callback_state TEXT DEFAULT 'none', callback_tries INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_pay_amt ON payments(amount_paise, status);
CREATE TABLE IF NOT EXISTS incoming(
  id TEXT PRIMARY KEY, utr TEXT, amount_paise INTEGER, text TEXT, source TEXT, status TEXT, payment_id TEXT, created_at INTEGER);
`);

const now = () => Date.now();
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const fail = (code, msg) => Object.assign(new Error(msg), { code });
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};
const readBody = req => new Promise((ok, no) => {
  let n = 0; const c = [];
  req.on("data", d => { n += d.length; if (n > 65536) { no(fail(413, "Body too large")); req.destroy(); } else c.push(d); });
  req.on("end", () => ok(Buffer.concat(c).toString())); req.on("error", no);
});
const parseJson = s => { try { return JSON.parse(s || "{}"); } catch { throw fail(400, "Invalid JSON"); } };
const authed = req => eq((req.headers.authorization || "").replace(/^Bearer /, ""), cfg.apiKey);

const expire = () => db.prepare("UPDATE payments SET status='expired' WHERE status='pending' AND expires_at<=?").run(now());
setInterval(expire, 30000).unref();

function upiLink(p) {
  return "upi://pay?" + new URLSearchParams({ pa: cfg.vpa, pn: cfg.name, am: (p.amount_paise / 100).toFixed(2), cu: "INR", tn: "Order " + p.order_id.slice(0, 20) });
}
const view = p => ({
  paymentId: p.id, orderId: p.order_id, status: p.status, amount: (p.amount_paise / 100).toFixed(2), amountPaise: p.amount_paise,
  expiresAt: p.expires_at, paidAt: p.paid_at, utr: p.utr, returnUrl: p.return_url, upiLink: upiLink(p), payUrl: `${cfg.publicUrl}/pay/${p.id}`
});

function createPayment(b) {
  const orderId = String(b.orderId || "").slice(0, 100);
  if (!orderId) throw fail(400, "orderId is required");
  const amount = Number(b.amount);
  if (!(amount > 0 && amount <= 200000)) throw fail(400, "amount must be between 0.01 and 200000 (rupees)");
  if (b.returnUrl && !/^https?:\/\//i.test(b.returnUrl)) throw fail(400, "returnUrl must start with http:// or https://");
  const base = Math.round(amount * 100);
  expire();
  if (db.prepare("SELECT 1 FROM payments WHERE order_id=? AND status='paid'").get(orderId)) throw fail(409, "Order already paid");
  const ex = db.prepare("SELECT * FROM payments WHERE order_id=? AND status='pending' AND base_paise=?").get(orderId, base);
  if (ex) return ex;
  const used = new Set(db.prepare("SELECT amount_paise a FROM payments WHERE status='pending'").all().map(r => r.a));
  const offs = Array.from({ length: 99 }, (_, i) => i + 1);
  for (let i = offs.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [offs[i], offs[j]] = [offs[j], offs[i]]; }
  const k = offs.find(o => !used.has(base + o));
  if (!k) throw fail(503, "Too many open UPI payments for this amount, try again shortly");
  const id = crypto.randomUUID(), t = now();
  db.prepare("INSERT INTO payments(id,order_id,base_paise,amount_paise,status,return_url,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)")
    .run(id, orderId, base, base + k, "pending", b.returnUrl || null, t, t + cfg.holdMs);
  return db.prepare("SELECT * FROM payments WHERE id=?").get(id);
}

function handleIncoming(text, receivedAt, source) {
  expire();
  text = String(text || "").slice(0, 1000);
  const p = parseCredit(text, { accountLast4: source === "sms" ? cfg.last4 : "" });
  if (!p) return { ignored: true };
  const id = p.utr ? "u" + p.utr : "h" + sha(text + "|" + receivedAt).slice(0, 32);
  if (db.prepare("SELECT 1 FROM incoming WHERE id=?").get(id)) return { status: "duplicate" };
  // same payment seen twice via SMS + app notification
  if (db.prepare("SELECT 1 FROM incoming WHERE amount_paise=? AND status='matched' AND created_at>?").get(p.amountPaise, now() - cfg.holdMs))
    { db.prepare("INSERT INTO incoming VALUES(?,?,?,?,?,?,?,?)").run(id, p.utr, p.amountPaise, text, source, "duplicate", null, now()); return { status: "duplicate" }; }
  const live = db.prepare("SELECT * FROM payments WHERE status='pending' AND amount_paise=? AND expires_at>?").all(p.amountPaise, now());
  let status = "unmatched", paymentId = null;
  if (live.length === 1) {
    paymentId = live[0].id; status = "matched";
    db.prepare("UPDATE payments SET status='paid', utr=?, paid_at=?, paid_by='auto' WHERE id=?").run(p.utr, now(), paymentId);
  } else if (live.length > 1) status = "ambiguous";
  db.prepare("INSERT INTO incoming VALUES(?,?,?,?,?,?,?,?)").run(id, p.utr, p.amountPaise, text, source || "sms", status, paymentId, now());
  if (paymentId) startCallback(paymentId);
  return { status, paymentId };
}

function startCallback(id) {
  if (!cfg.callbackUrl) return;
  db.prepare("UPDATE payments SET callback_state='pending' WHERE id=?").run(id);
  sendCallback(id);
}
async function sendCallback(id) {
  const p = db.prepare("SELECT * FROM payments WHERE id=?").get(id);
  if (!p || p.callback_state !== "pending") return;
  const body = JSON.stringify({ event: "payment.paid", paymentId: p.id, orderId: p.order_id, amount: (p.amount_paise / 100).toFixed(2), amountPaise: p.amount_paise, utr: p.utr, paidAt: p.paid_at });
  const ts = String(now());
  const sig = "sha256=" + crypto.createHmac("sha256", cfg.callbackSecret).update(ts + "." + body).digest("hex");
  try {
    const r = await fetch(cfg.callbackUrl, { method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "X-PayConfirm-Signature": sig, "X-PayConfirm-Timestamp": ts }, body });
    if (!r.ok) throw new Error("HTTP " + r.status);
    db.prepare("UPDATE payments SET callback_state='done' WHERE id=?").run(id);
  } catch (e) {
    const tries = p.callback_tries + 1;
    if (tries >= 8) db.prepare("UPDATE payments SET callback_state='failed', callback_tries=? WHERE id=?").run(tries, id);
    else { db.prepare("UPDATE payments SET callback_tries=? WHERE id=?").run(tries, id); setTimeout(() => sendCallback(id), Math.min(3600000, 5000 * 2 ** tries)).unref(); }
    console.error(`callback for ${id} failed (${e.message}), try ${tries}`);
  }
}

const PAY_PAGE = id => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pay</title><style>body{font-family:system-ui,sans-serif;background:#f6f6f6;margin:0;display:flex;justify-content:center;padding:24px}
.c{background:#fff;border-radius:18px;padding:28px;max-width:380px;width:100%;text-align:center;box-shadow:0 6px 30px #0001}
.a{font-size:38px;font-weight:800;margin:8px 0}.b{display:block;background:#111;color:#fff;border-radius:12px;padding:14px;text-decoration:none;font-weight:700;margin:18px 0}
#qr{display:flex;justify-content:center;margin:14px 0}.s{color:#666;font-size:14px}.ok{color:#16a34a;font-size:44px}</style></head><body><div class="c" id="c">Loading…</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
<script>
const ID=${JSON.stringify(id)};let drawn=false;const c=document.getElementById("c");
function el(t,cls,txt){const e=document.createElement(t);if(cls)e.className=cls;if(txt!=null)e.textContent=txt;return e}
async function tick(){try{const d=await (await fetch("/api/payments/"+ID)).json();if(d.error){c.textContent=d.error;return}
if(d.status==="paid"){c.replaceChildren(el("div","ok","✓"),el("h2",null,"Payment received"),el("p","s","₹"+d.amount));
if(d.returnUrl){setTimeout(()=>location.href=d.returnUrl+(d.returnUrl.includes("?")?"&":"?")+"paymentId="+ID,1500)}return}
if(d.status==="expired"){c.replaceChildren(el("h2",null,"This payment link expired"),el("p","s","Please go back and start again."));return}
if(!drawn){drawn=true;const a=el("a","b","Open UPI app");a.href=d.upiLink;const q=el("div");q.id="qr";
c.replaceChildren(el("p","s","Pay exactly"),el("div","a","₹"+d.amount),el("p","s","Enter this exact amount, including paise, so we can confirm your payment."),a,q,el("p","s","Waiting for payment…"));
if(window.QRCode)new QRCode(q,{text:d.upiLink,width:200,height:200});}
}catch(e){}setTimeout(tick,3000)}tick();</script></body></html>`;

const ADMIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>PayConfirm Admin</title>
<style>body{font-family:system-ui,sans-serif;margin:16px}table{border-collapse:collapse;width:100%;font-size:13px;margin-bottom:24px}td,th{border:1px solid #ddd;padding:6px;text-align:left;word-break:break-word}th{background:#f3f3f3}</style></head><body>
<h2>PayConfirm Admin</h2><input id="k" type="password" placeholder="API_KEY" size="30"> <button id="go">Load</button>
<h3>Payments</h3><table id="p"></table><h3>Incoming credits seen</h3><table id="i"></table>
<script>
const $=id=>document.getElementById(id);$("k").value=sessionStorage.getItem("k")||"";
const H=()=>({Authorization:"Bearer "+$("k").value});
function row(t,cells,head){const r=t.insertRow();cells.forEach(c=>{const x=document.createElement(head?"th":"td");if(c instanceof Node)x.appendChild(c);else x.textContent=c==null?"":c;r.appendChild(x)})}
const T=ms=>ms?new Date(ms).toLocaleString():"";
async function load(){sessionStorage.setItem("k",$("k").value);
const [p,i]=await Promise.all(["payments","incoming"].map(n=>fetch("/api/admin/"+n,{headers:H()}).then(r=>r.json())));
if(p.error){alert(p.error);return}
$("p").replaceChildren();row($("p"),["Created","Order","Amount","Status","UTR","By","Action"],1);
p.forEach(x=>{let a="";if(x.status!=="paid"){a=document.createElement("button");a.textContent="Mark paid";a.onclick=async()=>{const u=prompt("UTR (optional)")||"";if(!confirm("Mark "+x.orderId+" as PAID?"))return;
await fetch("/api/admin/payments/"+x.paymentId+"/mark-paid",{method:"POST",headers:{...H(),"Content-Type":"application/json"},body:JSON.stringify({utr:u})});load()}}
row($("p"),[T(x.createdAt),x.orderId,"₹"+x.amount,x.status,x.utr,x.paidBy,a])});
$("i").replaceChildren();row($("i"),["Seen","Amount","Status","Source","UTR","Text"],1);
i.forEach(x=>row($("i"),[T(x.createdAt),"₹"+(x.amountPaise/100).toFixed(2),x.status,x.source,x.utr,x.text]))}
$("go").onclick=load;if($("k").value)load();</script></body></html>`;

async function route(req, res) {
  const url = new URL(req.url, "http://x"), p = url.pathname, m = req.method;
  expire();
  if (m === "GET" && p === "/health") return send(res, 200, { ok: true });
  if (m === "GET" && p === "/") return send(res, 200, "PayConfirm is running.", "text/plain; charset=utf-8");
  if (m === "GET" && p === "/admin") return send(res, 200, ADMIN_PAGE, "text/html; charset=utf-8");
  let r;
  if (m === "GET" && (r = p.match(/^\/pay\/([0-9a-f-]{36})$/))) return send(res, 200, PAY_PAGE(r[1]), "text/html; charset=utf-8");
  if (m === "GET" && (r = p.match(/^\/api\/payments\/([0-9a-f-]{36})$/))) {
    const row = db.prepare("SELECT * FROM payments WHERE id=?").get(r[1]);
    return row ? send(res, 200, view(row)) : send(res, 404, { error: "Payment not found" });
  }
  if (m === "POST" && p === "/api/payments") {
    if (!authed(req)) throw fail(401, "Unauthorized");
    return send(res, 201, view(createPayment(parseJson(await readBody(req)))));
  }
  if (m === "POST" && p === "/api/sms") {
    if (!eq(req.headers["x-watcher-secret"] || "", cfg.watcherSecret)) throw fail(401, "Unauthorized");
    const b = parseJson(await readBody(req));
    return send(res, 200, handleIncoming(b.sms, b.receivedAt, b.source === "notification" ? "notification" : "sms"));
  }
  if (p.startsWith("/api/admin/")) {
    if (!authed(req)) throw fail(401, "Unauthorized");
    if (m === "GET" && p === "/api/admin/payments")
      return send(res, 200, db.prepare("SELECT * FROM payments ORDER BY created_at DESC LIMIT 100").all().map(x => ({ ...view(x), createdAt: x.created_at, paidBy: x.paid_by })));
    if (m === "GET" && p === "/api/admin/incoming")
      return send(res, 200, db.prepare("SELECT id,utr,amount_paise amountPaise,text,source,status,payment_id paymentId,created_at createdAt FROM incoming ORDER BY created_at DESC LIMIT 100").all());
    if (m === "POST" && (r = p.match(/^\/api\/admin\/payments\/([0-9a-f-]{36})\/mark-paid$/))) {
      const b = parseJson(await readBody(req));
      const u = /^\d{12}$/.test(b.utr || "") ? b.utr : null;
      const x = db.prepare("UPDATE payments SET status='paid', utr=?, paid_at=?, paid_by='admin' WHERE id=? AND status IN ('pending','expired')").run(u, now(), r[1]);
      if (!x.changes) throw fail(404, "Payment not found or already paid");
      startCallback(r[1]);
      return send(res, 200, { ok: true });
    }
  }
  throw fail(404, "Not found");
}

http.createServer((req, res) => {
  route(req, res).catch(e => {
    if (!e.code || e.code > 599) console.error(e);
    send(res, e.code > 0 && e.code < 600 ? e.code : 500, { error: e.code ? e.message : "Server error" });
  });
}).listen(cfg.port, cfg.host, () => {
  console.log(`PayConfirm running on http://${cfg.host}:${cfg.port}  (admin: ${cfg.publicUrl}/admin)`);
  for (const r of db.prepare("SELECT id FROM payments WHERE callback_state='pending'").all()) sendCallback(r.id);
});
