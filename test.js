"use strict";
// End-to-end self test: starts the server, runs a full payment flow, checks the signed callback.
const { spawn } = require("node:child_process");
const http = require("node:http");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const KEY = "test-api-key-1234567890", WS = "test-watcher-secret-1234", CS = "callback-secret-123456";
const BASE = "http://127.0.0.1:18080";
const calls = [];
const cb = http.createServer((req, res) => { let b = ""; req.on("data", d => b += d); req.on("end", () => { calls.push({ h: req.headers, b }); res.end("ok"); }); }).listen(18081);
const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(__dirname, "server.js")], {
  env: { ...process.env, PORT: "18080", HOST: "127.0.0.1", API_KEY: KEY, WATCHER_SECRET: WS, UPI_VPA: "shop@sbi", ACCOUNT_LAST4: "1234",
    CALLBACK_URL: "http://127.0.0.1:18081/cb", CALLBACK_SECRET: CS, DB_PATH: path.join(os.tmpdir(), "pc-test-" + Date.now() + ".sqlite") }, stdio: "inherit" });
const api = (p, o = {}) => fetch(BASE + p, o).then(async r => ({ s: r.status, j: await r.json().catch(() => ({})) }));
const post = (p, body, h) => api(p, { method: "POST", headers: { "Content-Type": "application/json", ...h }, body: JSON.stringify(body) });
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (let i = 0; i < 50; i++) { try { if ((await api("/health")).s === 200) break; } catch {} await wait(100); }
  let n = 0; const ok = m => console.log(" ✓", m, ++n);
  try {
    assert.equal((await post("/api/payments", { orderId: "A1", amount: 245 })).s, 401); ok("create payment needs API key");
    const c = await post("/api/payments", { orderId: "A1", amount: 245 }, { Authorization: "Bearer " + KEY });
    assert.equal(c.s, 201); const paise = c.j.amountPaise - 24500; assert.ok(paise >= 1 && paise <= 99); ok("unique amount " + c.j.amount);
    const again = await post("/api/payments", { orderId: "A1", amount: 245 }, { Authorization: "Bearer " + KEY });
    assert.equal(again.j.paymentId, c.j.paymentId); ok("same order returns same payment");
    const c2 = await post("/api/payments", { orderId: "A2", amount: 245 }, { Authorization: "Bearer " + KEY });
    assert.notEqual(c2.j.amountPaise, c.j.amountPaise); ok("two orders with same price get different amounts");
    assert.equal((await post("/api/sms", { sms: "x" }, { "x-watcher-secret": "wrong" })).s, 401); ok("watcher secret enforced");
    const W = { "x-watcher-secret": WS };
    assert.equal((await post("/api/sms", { sms: `A/c X1234 debited by Rs.${c.j.amount} Ref No 111111111111` }, W)).j.ignored, true); ok("debit ignored");
    assert.equal((await post("/api/sms", { sms: `A/c X9999 credited by Rs.${c.j.amount} Ref No 222222222222` }, W)).j.ignored, true); ok("other account ignored");
    const m = await post("/api/sms", { sms: `Dear Customer, A/c X1234 credited by Rs.${c.j.amount} on 18Oct26 transfer from TEST (Ref No 333333333333)` }, W);
    assert.equal(m.j.status, "matched"); assert.equal(m.j.paymentId, c.j.paymentId); ok("credit SMS matched the order");
    assert.equal((await api("/api/payments/" + c.j.paymentId)).j.status, "paid"); ok("payment status is paid");
    assert.equal((await post("/api/sms", { sms: `A/c X1234 credited by Rs.${c.j.amount} Ref No 333333333333` }, W)).j.status, "duplicate"); ok("same SMS twice is not counted twice");
    const nt = await post("/api/sms", { sms: `Received ₹${c2.j.amount} from Ravi`, source: "notification" }, W);
    assert.equal(nt.j.paymentId, c2.j.paymentId); ok("PhonePe-style notification matched");
    assert.equal((await post("/api/sms", { sms: "A/c X1234 credited by Rs.999.00 Ref No 444444444444" }, W)).j.status, "unmatched"); ok("unknown amount stays unmatched");
    await wait(500);
    assert.ok(calls.length >= 2); const k = calls.find(x => JSON.parse(x.b).orderId === "A1");
    const exp = "sha256=" + crypto.createHmac("sha256", CS).update(k.h["x-payconfirm-timestamp"] + "." + k.b).digest("hex");
    assert.equal(k.h["x-payconfirm-signature"], exp); ok("signed callback delivered");
    const adm = await api("/api/admin/payments", { headers: { Authorization: "Bearer " + KEY } });
    assert.equal(adm.j.length, 2); ok("admin list works");
    console.log("\nALL TESTS PASSED");
  } catch (e) { console.error("\nTEST FAILED:", e.message); process.exitCode = 1; }
  srv.kill(); cb.close();
})();
