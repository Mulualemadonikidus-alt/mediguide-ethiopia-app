// Pure helpers for the weekly directory update (no network, fully testable).

export const ALLOWED_TAGS = [
  "cardiology","neurology","neurosurgery","oncology","orthopedics","obstetrics","gynecology",
  "pediatrics","ophthalmology","nephrology","urology","gastroenterology","dermatology","ent",
  "psychiatry","plastic","endocrinology","pulmonology","hematology","dentistry","fistula",
  "emergency","surgery","internal","dialysis","fertility","ivf","neonatology","laboratory","radiology",
];

const STOP = new Set(["hospital","hospitals","general","specialized","specialised","specialty","comprehensive",
  "center","centre","medical","clinic","clinics","addis","ababa","plc","the","of","and","college","teaching",
  "referral","higher","health","care","services"]);

export const isHttp = (u) => typeof u === "string" && /^https?:\/\//i.test(u);
export const str = (x, max = 200) => String(x ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export function cleanUrl(u, hostRe) {
  try {
    const p = new URL(String(u));
    if (!/^https?:$/.test(p.protocol)) return "";
    if (hostRe && !hostRe.test(p.hostname)) return "";
    return p.toString();
  } catch { return ""; }
}

export function normName(s = "") {
  const base = String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const words = base.split(" ").filter(Boolean);
  const kept = words.filter((w) => !STOP.has(w));
  return (kept.length ? kept : words).join(" ");
}

export function phoneTails(s = "") {
  return String(s).split(/[\/,;]|\bor\b/i).map((p) => p.replace(/\D/g, "")).filter((d) => d.length >= 9).map((d) => d.slice(-9));
}

export function isDuplicate(c, list) {
  const n = normName(c.name);
  const tails = new Set(phoneTails(c.phone));
  return list.some((h) => {
    const m = normName(h.name);
    if (n && m && (n === m || (n.length >= 6 && m.includes(n)) || (m.length >= 6 && n.includes(m)))) return true;
    return phoneTails(h.phone).some((t) => tails.has(t));
  });
}

export function extractJson(text = "") {
  const t = String(text).replace(/```(?:json)?/gi, "").trim();
  const starts = [t.indexOf("["), t.indexOf("{")].filter((i) => i >= 0);
  if (!starts.length) return null;
  const s = Math.min(...starts);
  const close = t[s] === "[" ? "]" : "}";
  const e = t.lastIndexOf(close);
  if (e < s) return null;
  try { return JSON.parse(t.slice(s, e + 1)); } catch { return null; }
}

export function htmlToText(html = "") {
  return String(html).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ").toLowerCase();
}

const nameTokens = (name) => normName(name).split(" ").filter((w) => w.length >= 3);
const pageHasName = (text, name) => {
  const tk = nameTokens(name);
  return tk.length ? tk.every((w) => text.includes(w)) : text.includes(String(name).toLowerCase());
};

export function verifyFacility(c, pages) {
  const good = pages.filter((p) => p.text && pageHasName(p.text, c.name));
  const tails = phoneTails(c.phone);
  const phoneOk = tails.length > 0 && good.some((p) => { const d = p.text.replace(/\D/g, ""); return tails.some((t) => d.includes(t)); });
  return { nameOk: good.length > 0, phoneOk, sources: good.map((p) => p.url) };
}

export function personTokens(name = "") {
  return String(name).replace(/\(.*?\)/g, " ").replace(/\b(dr|prof|professor|mr|ms|mrs|md)\b\.?/gi, " ")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z\s-]/g, " ")
    .split(/\s+/).filter((w) => w.length >= 3);
}

export function verifyDoctor(doctor, facilityName, pages) {
  const pt = personTokens(doctor);
  if (pt.length < 2) return { ok: false, sources: [] };
  const good = pages.filter((p) => p.text && pt.every((w) => p.text.includes(w)) && pageHasName(p.text, facilityName));
  return { ok: good.length > 0, sources: good.map((p) => p.url) };
}

export function makePageLoader(fetchText) {
  const cache = new Map();
  return async (urls) => {
    const uniq = [...new Set(urls.filter(isHttp))].slice(0, 12);
    return Promise.all(uniq.map(async (u) => {
      if (!cache.has(u)) cache.set(u, Promise.resolve().then(() => fetchText(u)).catch(() => ""));
      return { url: u, text: (await cache.get(u)) || "" };
    }));
  };
}

const TYPES = { public: "Public", private: "Private", ngo: "NGO" };
export function normalizeHospital(c, { id, date, sources, phoneOk }) {
  const tags = [...new Set((c.tags || []).map((t) => String(t).toLowerCase()).filter((t) => ALLOWED_TAGS.includes(t)))];
  const specs = (c.specialties || []).slice(0, 8).map((s) => ({
    n: str(s.name, 80), icon: "◈",
    subs: (s.subspecialties || []).slice(0, 10).map((x) => str(x, 60)).filter(Boolean),
    docs: (s.doctors || []).slice(0, 10).map((x) => str(x, 90)).filter(Boolean),
  })).filter((s) => s.n);
  const phone = phoneOk ? str(c.phone, 60) : "";
  const web = cleanUrl(c.website), fb = cleanUrl(c.facebook, /(^|\.)(facebook\.com|fb\.com)$/i), tg = cleanUrl(c.telegram, /(^|\.)(t\.me|telegram\.me)$/i);
  return {
    id, name: str(c.name, 120), am: "", type: TYPES[String(c.type || "").toLowerCase()] || "Private",
    est: null, beds: null, addr: str(c.address, 160), phone,
    appt: phone ? `Call ${phone}` : web ? `See ${web}` : "Contact the facility directly — details not yet confirmed",
    web, fb, tg, coords: "", badge: "Newly added", desc: str(c.description, 400),
    tags, specs, sources: sources.slice(0, 3), addedOn: date,
  };
}

export async function processFacilities({ candidates, groundUrls = [], load, existing, startId, date }) {
  const accepted = [], rejected = [];
  let id = startId;
  const seen = [...existing];
  for (const c of (Array.isArray(candidates) ? candidates : []).slice(0, 8)) {
    if (!c || !c.name) continue;
    if (isDuplicate(c, seen)) { rejected.push({ name: c.name, reason: "already listed" }); continue; }
    const pages = await load([...(c.sources || []), c.website, ...groundUrls]);
    const v = verifyFacility(c, pages);
    if (!v.nameOk) { rejected.push({ name: c.name, reason: "name not found on any fetchable source page", sources: c.sources || [] }); continue; }
    const droppedDoctors = [];
    const specialties = (c.specialties || []).map((s) => {
      const doctors = [];
      for (const d of s.doctors || []) (verifyDoctor(d, c.name, pages).ok ? doctors : droppedDoctors).push(d);
      return { ...s, doctors };
    });
    const hospital = normalizeHospital({ ...c, specialties }, { id: id++, date, sources: v.sources, phoneOk: v.phoneOk });
    accepted.push({ hospital, flags: { phoneVerified: v.phoneOk, droppedDoctors } });
    seen.push(hospital);
  }
  return { accepted, rejected };
}

export function matchHospital(name, list) {
  const n = normName(name);
  if (!n) return null;
  return list.find((h) => { const m = normName(h.name); return m === n || (n.length >= 5 && m.includes(n)) || (m.length >= 5 && n.includes(m)); }) || null;
}

export async function processDoctors({ items, groundUrls = [], load, hospitals, docsByHospital, date }) {
  const accepted = [], rejected = [];
  for (const it of (Array.isArray(items) ? items : []).slice(0, 15)) {
    const name = str(it?.doctor, 100);
    const h = matchHospital(it?.hospital, hospitals);
    if (!name || !h) { rejected.push({ name: name || "(blank)", reason: "hospital not recognised" }); continue; }
    const known = (docsByHospital.get(h.id) || "").toLowerCase();
    const pt = personTokens(name);
    if (pt.length >= 2 && pt.every((w) => known.includes(w))) { rejected.push({ name, reason: "already listed", hospital: h.name }); continue; }
    const pages = await load([...(it.sources || []), ...groundUrls]);
    const v = verifyDoctor(name, h.name, pages);
    if (!v.ok) { rejected.push({ name, reason: "name not found on a source page together with the hospital name", hospital: h.name, sources: it.sources || [] }); continue; }
    accepted.push({ hospitalId: h.id, hospital: h.name, specialty: str(it.specialty, 80) || "Specialists", name, addedOn: date, sources: v.sources.slice(0, 2) });
  }
  return { accepted, rejected };
}

export const weekNumber = (d = new Date()) => Math.floor(d.getTime() / (7 * 864e5));
export const pickRotating = (arr, k, w) => Array.from({ length: Math.min(k, arr.length) }, (_, i) => arr[(w * k + i) % arr.length]);

export function buildPrBody({ date, facilities, doctors, rejectedFacilities, rejectedDoctors, focuses }) {
  const L = [];
  L.push(`## Weekly directory update — ${date}`, "",
    `Search focus this week: ${focuses.join("; ")}.`, "",
    `**${facilities.length}** new facilities · **${doctors.length}** new specialists · ${rejectedFacilities.length + rejectedDoctors.length} candidates rejected.`, "",
    "Only items whose name was found on a real source page are included below. **You are the final check — merging this PR publishes them; closing it discards them.**", "");
  L.push("### New facilities");
  if (!facilities.length) L.push("_None this week._");
  for (const { hospital: h, flags } of facilities) {
    L.push(`- **${h.name}** (${h.type}) — ${h.addr || "address not found"}`,
      `  - phone: ${h.phone ? `${h.phone} ✅ found on source page` : "⚠️ not confirmed on a source page — left blank"}`,
      `  - specialties: ${h.specs.map((s) => s.n).join(", ") || "—"}`,
      `  - sources: ${h.sources.join(" , ") || "—"}`);
    if (flags.droppedDoctors.length) L.push(`  - doctors dropped (not verifiable): ${flags.droppedDoctors.join("; ")}`);
  }
  L.push("", "### New specialists at listed hospitals");
  if (!doctors.length) L.push("_None this week._");
  for (const d of doctors) L.push(`- **${d.name}** — ${d.specialty} @ ${d.hospital} — ${d.sources.join(" , ")}`);
  const rej = [...rejectedFacilities.filter((r) => r.reason !== "already listed"), ...rejectedDoctors.filter((r) => r.reason !== "already listed")];
  L.push("", "### Not added (could not be verified — follow up manually if you know them)");
  if (!rej.length) L.push("_None._");
  for (const r of rej) L.push(`- ${r.name}${r.hospital ? ` @ ${r.hospital}` : ""} — ${r.reason}`);
  L.push("", "### Your confirmation checklist",
    "- [ ] Open the **Netlify Deploy Preview** link on this PR and look at the new entries",
    "- [ ] Check names, phone numbers and specialties against the sources",
    "- [ ] Edit `public/data/hospitals-extra.json` in this PR to remove or fix anything wrong",
    "- [ ] **Merge** to publish (Netlify redeploys automatically)");
  return L.join("\n");
}

export function buildIssueBody({ date, spot, hasPr }) {
  const L = [`## Weekly accuracy confirmation — ${date}`, "",
    hasPr ? "A pull request with this week's proposed additions is waiting for your review." : "No new facilities or specialists were found this week, so there is no pull request.", "",
    "### 3-minute spot check of existing entries (rotates weekly)", ""];
  for (const h of spot) L.push(`- [ ] **${h.name}** — phone ${h.phone || "—"} · ${h.web || "no website listed"} — still correct? any new/left specialists?`);
  L.push("", "Close this issue when you've confirmed the directory is accurate. Edit `public/index.html` (`const H=[...]`) to fix any entry.");
  return L.join("\n");
}
