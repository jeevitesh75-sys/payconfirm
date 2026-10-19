"use strict";
// Turns a bank SMS or UPI-app notification into { amountPaise, utr } if it is an incoming credit.
function parseCredit(text, opts = {}) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  if (!/\b(credited|received|deposited|paid you)\b/i.test(t)) return null;
  if (/\b(debited|withdrawn|spent|requested|request(?:s|ed)? money)\b|\b(?:you|u) (?:paid|sent)\b|\bpaid to\b|\bsent to\b/i.test(t)) return null;
  if (opts.accountLast4 && !t.includes(opts.accountLast4)) return null;

  const money = "(?:Rs\\.?|INR|₹)\\s*([\\d,]+(?:\\.\\d{1,2})?)";
  const m = t.match(new RegExp("(?:credited|received|deposited|paid you)\\D{0,25}?" + money, "i"))
         || t.match(new RegExp(money, "i"));
  if (!m) return null;
  const amountPaise = Math.round(parseFloat(m[1].replace(/,/g, "")) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) return null;

  const u = t.match(/(?:Ref(?:erence)?\.?\s*(?:No\.?|Number)?|UTR|RRN)\s*[:\-]?\s*(\d{12})/i) || t.match(/\b(\d{12})\b/);
  return { amountPaise, utr: u ? u[1] : null };
}
module.exports = { parseCredit };
