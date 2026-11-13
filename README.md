# MediGuide Ethiopia

A directory of 19 specialized hospitals in Addis Ababa, with an AI symptom checker that points patients to the right specialty, hospital and urgency level.

## Structure

```
public/index.html              the website (hospital data lives in `const H=[ ... ]`)
netlify/functions/triage.mjs   AI symptom-checker backend (Google Gemini)
cloudflare-worker/             optional alternative backend (Cloudflare Worker)
netlify.toml  .env.example     config
```

## Technologies
- Static HTML + React 18 (loaded from a CDN), no build step
- Netlify Functions (Node) with the `@google/genai` SDK
- Netlify AI Gateway or your own Google AI Studio key for Gemini

## API keys: where they go

**No key is required on Netlify.** If you don't set one, Netlify AI Gateway gives the function Gemini access automatically, and usage is billed to your Netlify credits.

To use your own **free** Google key instead:
1. Create a key at https://aistudio.google.com/app/apikey.
2. In Netlify, go to **Project configuration → Environment variables → Add a variable**.
   - Key: `GEMINI_API_KEY`, Value: your key, Scopes: Functions.
   - Optional: `GEMINI_MODEL` (default `gemini-flash-latest`).
3. Go to **Deploys → Trigger deploy**.

Never put a key in `public/index.html` or commit it to Git.

## Run locally
```
npm install
netlify dev
```
To test locally with your own key, copy `.env.example` to `.env` and paste in the key. `.env` is git-ignored.

## Cloudflare alternative (optional)
See `cloudflare-worker/`: run `npx wrangler secret put GEMINI_API_KEY` (or use the Workers AI binding, which needs no key), then `npx wrangler deploy`. After that, set `TRIAGE_ENDPOINT` in `public/index.html` to the Worker URL and set `ALLOWED_ORIGIN` in `wrangler.toml`.

## Notes
- Privacy: on free tiers, providers may use submitted text to improve their products. The site tells patients not to enter identifying details.
- Physician names were compiled from public sources. Check each one with its hospital before public launch.
- If you see a "model not found" error, set `GEMINI_MODEL` to a current Flash model.
