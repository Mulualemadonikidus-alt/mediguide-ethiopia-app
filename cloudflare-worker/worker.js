/**
 * MediGuide Ethiopia — Cloudflare Worker (free plan)
 * POST { "symptoms": "..." }  ->  { "text": "..." }
 *
 * Two free AI options — the Worker uses the first one that is configured:
 *   A) Google Gemini : secret  GEMINI_API_KEY            (wrangler secret put GEMINI_API_KEY)
 *   B) Workers AI    : the [ai] binding in wrangler.toml (no external key at all)
 * Optional vars: GEMINI_MODEL, CF_AI_MODEL, ALLOWED_ORIGIN (your site URL; default "*")
 */
const SYSTEM_PROMPT = "You are a compassionate medical triage assistant for MediGuide Ethiopia \u2014 Addis Ababa's specialized hospital directory. Help patients find the right care warmly and clearly.\n\nRespond with:\n1. Brief empathetic acknowledgment (1-2 sentences)\n2. Most likely specialty/subspecialty needed\n3. Top 2-3 hospitals from our directory with specific reasons\n4. 1-2 named physicians at those hospitals\n5. Urgency: Emergency (ER now) / Urgent (24-48h) / Routine (schedule appointment)\n6. 2-3 practical self-care steps appropriate to urgency\n7. Disclaimer\n\nOur 19 hospitals in Addis Ababa:\nPUBLIC: Tikur Anbessa (all specialties, ONLY radiotherapy in Ethiopia \u2014 Prof. Yewondwossen Tegene cardiology, Prof. Abebe Bekele oncology), Yekatit 12 (burns/speech therapy \u2014 Dr. Elias Tewabe), Menelik II (large public/dialysis), St Paul's (cardiac surgery \u2014 Dr. Hailu Merga, OB/GYN \u2014 Prof. Tamiru Desta), ALERT (plastic surgery \u2014 Dr. Dawit Bekele, leprosy/HIV), Amanuel (ONLY psychiatric hospital \u2014 Prof. Atalay Alem), Hamlin Fistula (FREE fistula repair, 93% success), St Peter (TB/thoracic national referral).\nPRIVATE: Addis Cardiac (ONLY heart hospital \u2014 Dr. Fasil Tekle interventional, Dr. Tewodros Yohannes cardiac surgery), MCM Korean Hospital (largest private \u2014 Dr. Roger Holland surgery dean, Dr. Jikssa gastro), Bethzatha (oncology/spine), Ethio Tebib (interventional cardiology/gastro/nephrology \u2014 Dr. Melkam Alemu gastro), Hayat (neurosurgery \u2014 Dr. Belay Abebe, gastro), St Gabriel (24/7 first private), AMC (waterbirth/travel medicine \u2014 Dr. Akeza Teame founder), Anania (women & children/IVF \u2014 Dr. Tsige Hailu), Sante (dialysis/urology \u2014 Dr. Getnet Bekele), Addis Hiwot (70+ specialists/hematology), Kadisco (surgery/urology/dentistry).\n\nBe warm, clear, concise. Simple language. Never claim to diagnose. If symptoms suggest an emergency (chest pain, stroke signs, severe bleeding, breathing difficulty, loss of consciousness) say so first and tell the patient to go to the nearest emergency room. Always end with: \u26a0\ufe0f This is general information only. Always consult a licensed physician.";

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";
    const cors = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    const reply = (status, obj) =>
      new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply(405, { error: "Method not allowed" });

    let symptoms = "";
    try { symptoms = String((await request.json()).symptoms || "").trim(); }
    catch { return reply(400, { error: "Invalid request." }); }
    if (!symptoms) return reply(400, { error: "Please describe your symptoms." });
    if (symptoms.length > 1500) return reply(400, { error: "Description too long (max 1500 characters)." });

    try {
      // ── Option A: Google Gemini ─────────────────────────────────────────
      if (env.GEMINI_API_KEY) {
        const model = env.GEMINI_MODEL || "gemini-2.5-flash";
        const body = {
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: "Patient symptoms: " + symptoms }] }],
          generationConfig: { maxOutputTokens: 1200, temperature: 0.4 },
        };
        if (/2\.5-flash/.test(model)) body.generationConfig.thinkingConfig = { thinkingBudget: 0 };
        const r = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
          { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY }, body: JSON.stringify(body) }
        );
        const data = await r.json().catch(() => ({}));
        if (r.status === 429) return reply(429, { error: "Free-tier limit reached. Please try again in a minute." });
        if (!r.ok) return reply(502, { error: (data.error && data.error.message) || ("Gemini error " + r.status) });
        const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
          .map((p) => p.text || "").join("").trim();
        if (!text) return reply(502, { error: "The AI returned no answer. Please rephrase." });
        return reply(200, { text });
      }

      // ── Option B: Cloudflare Workers AI (no external key) ───────────────
      if (env.AI) {
        const model = env.CF_AI_MODEL || "@cf/meta/llama-3.1-8b-instruct";
        const out = await env.AI.run(model, {
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: "Patient symptoms: " + symptoms },
          ],
          max_tokens: 900,
        });
        const text = String((out && (out.response || out.result)) || "").trim();
        if (!text) return reply(502, { error: "The AI returned no answer. Please rephrase." });
        return reply(200, { text });
      }

      return reply(500, { error: "No AI backend configured (set GEMINI_API_KEY or enable the [ai] binding)." });
    } catch (e) {
      return reply(502, { error: "Could not reach the AI service." });
    }
  },
};
