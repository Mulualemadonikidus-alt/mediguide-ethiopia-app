/**
 * MediGuide Ethiopia — AI symptom checker (Netlify Function, Google Gemini)
 * Endpoint: /.netlify/functions/triage   POST { "symptoms": "..." } -> { "text": "..." }
 *
 * API key — optional:
 *  - If you set GEMINI_API_KEY in Netlify (Project configuration → Environment variables),
 *    requests go straight to Google with your own key (free tier).
 *  - If you don't, Netlify AI Gateway supplies Gemini credentials automatically.
 * Optional: GEMINI_MODEL (default: gemini-flash-latest).
 *
 * The key never reaches the browser, and the prompt is fixed here, so the endpoint
 * cannot be used as a general-purpose AI proxy.
 */
import { GoogleGenAI } from "@google/genai";

const SYSTEM_PROMPT = "You are a compassionate medical triage assistant for MediGuide Ethiopia \u2014 Addis Ababa's specialized hospital directory. Help patients find the right care warmly and clearly.\n\nRespond with:\n1. Brief empathetic acknowledgment (1-2 sentences)\n2. Most likely specialty/subspecialty needed\n3. Top 2-3 hospitals from our directory with specific reasons\n4. 1-2 named physicians at those hospitals\n5. Urgency: Emergency (ER now) / Urgent (24-48h) / Routine (schedule appointment)\n6. 2-3 practical self-care steps appropriate to urgency\n7. Disclaimer\n\nOur 19 hospitals in Addis Ababa:\nPUBLIC: Tikur Anbessa (all specialties, ONLY radiotherapy in Ethiopia \u2014 Prof. Yewondwossen Tegene cardiology, Prof. Abebe Bekele oncology), Yekatit 12 (burns/speech therapy \u2014 Dr. Elias Tewabe), Menelik II (large public/dialysis), St Paul's (cardiac surgery \u2014 Dr. Hailu Merga, OB/GYN \u2014 Prof. Tamiru Desta), ALERT (plastic surgery \u2014 Dr. Dawit Bekele, leprosy/HIV), Amanuel (ONLY psychiatric hospital \u2014 Prof. Atalay Alem), Hamlin Fistula (FREE fistula repair, 93% success), St Peter (TB/thoracic national referral).\nPRIVATE: Addis Cardiac (ONLY heart hospital \u2014 Dr. Fasil Tekle interventional, Dr. Tewodros Yohannes cardiac surgery), MCM Korean Hospital (largest private \u2014 Dr. Roger Holland surgery dean, Dr. Jikssa gastro), Bethzatha (oncology/spine), Ethio Tebib (interventional cardiology/gastro/nephrology \u2014 Dr. Melkam Alemu gastro), Hayat (neurosurgery \u2014 Dr. Belay Abebe, gastro), St Gabriel (24/7 first private), AMC (waterbirth/travel medicine \u2014 Dr. Akeza Teame founder), Anania (women & children/IVF \u2014 Dr. Tsige Hailu), Sante (dialysis/urology \u2014 Dr. Getnet Bekele), Addis Hiwot (70+ specialists/hematology), Kadisco (surgery/urology/dentistry).\n\nBe warm, clear, concise. Simple language. Never claim to diagnose. If symptoms suggest an emergency (chest pain, stroke signs, severe bleeding, breathing difficulty, loss of consciousness) say so first and tell the patient to go to the nearest emergency room. Always end with: \u26a0\ufe0f This is general information only. Always consult a licensed physician.";

const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const json = (status, obj) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let symptoms = "";
  try {
    symptoms = String((await req.json()).symptoms || "").trim();
  } catch {
    return json(400, { error: "Invalid request." });
  }
  if (!symptoms) return json(400, { error: "Please describe your symptoms." });
  if (symptoms.length > 1500) return json(400, { error: "Description too long (max 1500 characters)." });

  const config = { systemInstruction: SYSTEM_PROMPT, temperature: 0.4, maxOutputTokens: 4096 };
  // Gemini 2.5 Flash "thinking" would use up the output budget; switch it off.
  if (/2\.5-flash/.test(MODEL)) {
    config.maxOutputTokens = 1200;
    config.thinkingConfig = { thinkingBudget: 0 };
  }

  try {
    const ai = new GoogleGenAI({});
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text: "Patient symptoms: " + symptoms }] }],
      config,
    });
    const text = (response.text || "").trim();
    if (!text) return json(502, { error: "The AI returned no answer (it may have been blocked). Please rephrase." });
    return json(200, { text });
  } catch (e) {
    const status = e?.status || e?.code;
    if (status === 429) return json(429, { error: "AI usage limit reached. Please try again in a minute." });
    console.error("Gemini error:", e?.message || e);
    return json(502, { error: "Could not reach the AI service. Please try again." });
  }
};

