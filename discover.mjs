#!/usr/bin/env node
/**
 * Weekly directory discovery for MediGuide Ethiopia.
 *   node --env-file=.env scripts/discover.mjs            (local, uses GEMINI_API_KEY from .env)
 *   node scripts/discover.mjs --dry-run                  (prints results, writes nothing)
 * In GitHub Actions the key comes from the repository secret GEMINI_API_KEY.
 *
 * What it does: asks Gemini (with Google Search grounding) for facilities / specialists not yet
 * listed, then REJECTS anything whose name is not actually found on a fetched source page.
 * Survivors go into public/data/hospitals-extra.json and a PR body for human review.
 */
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";
import {
  extractJson, htmlToText, makePageLoader, processFacilities, processDoctors,
  weekNumber, pickRotating, buildPrBody, buildIssueBody, ALLOWED_TAGS,
} from "./lib.mjs";

const DRY = process.argv.includes("--dry-run");
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INDEX = path.join(ROOT, "public/index.html");
const STORE = path.join(ROOT, "public/data/hospitals-extra.json");
const REPORTS = path.join(ROOT, "reports");
const date = new Date().toISOString().slice(0, 10);
const week = weekNumber();

if (!process.env.GEMINI_API_KEY) { console.error("GEMINI_API_KEY is not set."); process.exit(1); }
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const FOCUSES = [
  "private general and teaching hospitals",
  "specialty centers: cardiac, kidney/dialysis, cancer/oncology",
  "eye, ENT and dental hospitals and centers",
  "women's health, fertility/IVF, maternal and child hospitals",
  "mental health, rehabilitation, physiotherapy and addiction centers",
  "orthopedic, spine, neurosurgery and trauma centers",
  "diagnostic imaging (MRI/CT) centers and medical laboratories",
  "medical plazas and multi-clinic buildings hosting many specialist clinics (Bole, Kazanchis, Piassa, CMC, Megenagna, Mexico)",
  "government, city-administration and sub-city referral hospitals",
  "faith-based, mission and international/expat-oriented hospitals",
];

const SYS = "You are a careful research assistant building a medical directory for Addis Ababa, Ethiopia. " +
  "Use Google Search. Report ONLY facts you actually read on a web page (official site, Facebook page, Telegram channel, reputable directory). " +
  "Never invent doctors, phone numbers or addresses; use empty strings when unknown. Every item must cite the page URLs where you found it. " +
  "Reply with JSON only — no commentary.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(prompt) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model: MODEL, contents: prompt,
        config: { tools: [{ googleSearch: {} }], temperature: 0.1, systemInstruction: SYS },
      });
      const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      return { json: extractJson(res.text || ""), groundUrls: chunks.map((c) => c.web?.uri).filter(Boolean) };
    } catch (e) {
      console.warn(`Gemini call failed (attempt ${attempt}):`, e?.message || e);
      if (attempt < 3) await sleep(15000 * attempt);
    }
  }
  return { json: null, groundUrls: [] };
}

async function fetchText(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; MediGuideDirectoryCheck/1.0)" } });
    if (!r.ok) return "";
    return htmlToText((await r.text()).slice(0, 600000));
  } catch { return ""; } finally { clearTimeout(t); }
}

// ── existing data ─────────────────────────────────────────────────────────
function readBaseHospitals() {
  const html = fs.readFileSync(INDEX, "utf8");
  const m = html.match(/const H=\[([\s\S]*?)\n\];/);
  if (!m) throw new Error("Could not find `const H=[...]` in public/index.html");
  return new Function(`return [${m[1]}];`)();
}
const store = fs.existsSync(STORE) ? JSON.parse(fs.readFileSync(STORE, "utf8")) : {};
store.hospitals ||= []; store.doctorAdditions ||= [];
const base = readBaseHospitals();
const all = [...base, ...store.hospitals];
const docsByHospital = new Map(all.map((h) => [h.id, [
  ...(h.specs || []).flatMap((s) => s.docs || []),
  ...store.doctorAdditions.filter((d) => d.hospitalId === h.id).map((d) => d.name),
].join(" | ")]));

const load = makePageLoader(fetchText);
const focuses = pickRotating(FOCUSES, 2, week);
let nextId = Math.max(99, ...store.hospitals.map((h) => h.id || 0)) + 1;

// ── 1) new facilities ─────────────────────────────────────────────────────
const newFacilities = [], rejectedFacilities = [];
for (const focus of focuses) {
  const names = all.map((h) => h.name).concat(newFacilities.map((f) => f.hospital.name)).join("; ");
  const { json, groundUrls } = await ask(
    `Search the web for hospitals, specialty centers, clinics and medical plazas in Addis Ababa, Ethiopia, focusing on: ${focus}.\n` +
    `ALREADY LISTED (do not return these): ${names}\n\n` +
    `Return ONLY a JSON array (max 6 items) of objects:\n` +
    `{"name":"","type":"Public|Private|NGO","address":"","phone":"","website":"","facebook":"","telegram":"",` +
    `"description":"max 2 factual sentences","tags":[subset of ${JSON.stringify(ALLOWED_TAGS)}],` +
    `"specialties":[{"name":"","subspecialties":[""],"doctors":["Dr. Full Name (sub-specialty)"]}],"sources":["page URLs"]}\n` +
    `Return [] if you find nothing new that is backed by a page.`);
  const r = await processFacilities({ candidates: json, groundUrls, load, existing: [...all, ...newFacilities.map((f) => f.hospital)], startId: nextId, date });
  nextId += r.accepted.length;
  newFacilities.push(...r.accepted); rejectedFacilities.push(...r.rejected);
  await sleep(5000);
}

// ── 2) new specialists at already-listed hospitals (3 per week, rotating) ─
const roster = pickRotating(base, 3, week);
const newDoctors = [], rejectedDoctors = [];
for (const h of roster) {
  const known = (docsByHospital.get(h.id) || "").slice(0, 1500);
  const { json, groundUrls } = await ask(
    `Search the official website, Facebook page and Telegram channel of "${h.name}" in Addis Ababa (website: ${h.web || "unknown"}) ` +
    `for specialist physicians who are publicly named there.\nALREADY LISTED: ${known}\n\n` +
    `Return ONLY a JSON array (max 5) of NEW people not already listed: ` +
    `[{"hospital":"${h.name}","specialty":"","doctor":"Dr. Full Name (sub-specialty)","sources":["page URLs"]}]. Return [] if none.`);
  const r = await processDoctors({ items: json, groundUrls, load, hospitals: [...all, ...newFacilities.map((f) => f.hospital)], docsByHospital, date });
  newDoctors.push(...r.accepted); rejectedDoctors.push(...r.rejected);
  await sleep(5000);
}

// ── 3) write outputs ──────────────────────────────────────────────────────
const spot = pickRotating(base, 3, week + 7);
const pr = buildPrBody({ date, facilities: newFacilities, doctors: newDoctors, rejectedFacilities, rejectedDoctors, focuses });
const issue = buildIssueBody({ date, spot, hasPr: newFacilities.length + newDoctors.length > 0 });
console.log(pr, "\n\n----- ISSUE -----\n", issue);

if (DRY) { console.log("\n(dry run — nothing written)"); process.exit(0); }
fs.mkdirSync(REPORTS, { recursive: true });
fs.writeFileSync(path.join(REPORTS, "pr-body.md"), pr);
fs.writeFileSync(path.join(REPORTS, "issue.md"), issue);
if (newFacilities.length + newDoctors.length > 0) {
  store.hospitals.push(...newFacilities.map((f) => f.hospital));
  store.doctorAdditions.push(...newDoctors);
  store.lastUpdated = date;
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2) + "\n");
}
console.log(`\nDone: +${newFacilities.length} facilities, +${newDoctors.length} specialists.`);
