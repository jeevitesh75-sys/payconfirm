"use strict";
// Runs in Termux on the Android phone that receives your bank's SMS / UPI app notifications.
// Sends new bank SMS and UPI-app notifications to your PayConfirm server.
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const SERVER = (process.env.SERVER_URL || "").replace(/\/$/, "");
const SECRET = process.env.WATCHER_SECRET;
const SENDERS = (process.env.SENDER_MATCH || "SBI").toUpperCase().split(",").map(s => s.trim()).filter(Boolean);
const APPS = (process.env.NOTIFY_APPS === undefined ? "phonepe,paisa,paytm,npci,sbi" : process.env.NOTIFY_APPS)
  .toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
const STATE = path.join(os.homedir(), ".payconfirm-watcher.json");
if (!SERVER || !SECRET) { console.error("Set SERVER_URL and WATCHER_SECRET (see start.sh)"); process.exit(1); }

const run = (cmd, args) => new Promise((ok, no) => execFile(cmd, args, { maxBuffer: 8e6 }, (e, out) => {
  if (e) return no(e); try { ok(JSON.parse(out || "[]")); } catch (x) { no(x); }
}));
const load = () => { try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return null; } };
const save = s => fs.writeFileSync(STATE, JSON.stringify(s));
const h = s => crypto.createHash("sha1").update(s).digest("hex");

async function post(text, receivedAt, source) {
  const r = await fetch(SERVER + "/api/sms", { method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "x-watcher-secret": SECRET },
    body: JSON.stringify({ sms: text, receivedAt, source }) });
  if (!r.ok) throw new Error("Server answered HTTP " + r.status);
  console.log(new Date().toISOString(), source, (await r.text()).slice(0, 120));
}

async function tick() {
  const first = !load();
  const state = load() || { lastSms: 0, seen: [] };
  // 1) SMS
  const sms = (await run("termux-sms-list", ["-l", "50", "-t", "inbox"])).map(m => ({ ...m, id: Number(m._id) })).sort((a, b) => a.id - b.id);
  if (first && sms.length) state.lastSms = sms[sms.length - 1].id;
  else for (const m of sms) {
    if (m.id <= state.lastSms) continue;
    if (SENDERS.some(s => String(m.address || "").toUpperCase().includes(s))) await post(m.body, m.received, "sms");
    state.lastSms = m.id; save(state);
  }
  // 2) UPI app / bank app notifications (needs Notification access for Termux:API)
  if (APPS.length) {
    let notes = [];
    try { notes = await run("termux-notification-list", []); } catch (e) { if (first) console.error("Notifications unavailable:", e.message); }
    for (const n of notes) {
      if (!APPS.some(a => String(n.packageName || "").toLowerCase().includes(a))) continue;
      const key = h([n.packageName, n.when, n.title, n.content].join("|"));
      if (state.seen.includes(key)) continue;
      if (!first) await post(`${n.title || ""} ${n.content || ""}`, n.when, "notification");
      state.seen.push(key); state.seen = state.seen.slice(-500); save(state);
    }
  }
  if (first) { save(state); console.log("Baseline saved. Only new messages from now on will be sent."); }
}

(async function loop() {
  try { await tick(); } catch (e) { console.error(new Date().toISOString(), e.message); }
  setTimeout(loop, 5000);
})();
