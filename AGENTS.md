# AGENTS.md

## Architecture
- `public/` is the published directory. `public/index.html` is the whole frontend: React 18 UMD from cdnjs, using `React.createElement` (aliased as `E`), with no JSX and no build step. Hospital data is in `const H=[...]` and keyword triage rules are in `SYMP`. When the AI call fails, the page falls back to keyword-matched hospitals.
- `netlify/functions/triage.mjs` is a v2 (modern) Netlify Function served at `/.netlify/functions/triage`. It uses `@google/genai` with a zero-config `new GoogleGenAI({})`.
- `cloudflare-worker/` is an optional alternative backend and is not deployed by Netlify.

## Non-obvious decisions
- The function must stay in v2 syntax (`export default async (req) => Response`). Netlify AI Gateway only injects `GEMINI_API_KEY`/`GOOGLE_GEMINI_BASE_URL` into modern functions.
- If the owner sets their own `GEMINI_API_KEY`, Netlify doesn't override it and the SDK talks to Google directly. Otherwise the AI Gateway is used. Don't add "missing key" checks.
- The default model `gemini-flash-latest` is supported by both AI Gateway and Google directly. Only use AI Gateway-supported models.
- The system prompt is fixed on the server so the endpoint can't be used as a general-purpose AI proxy. Keep the hospital list in the prompt in sync with `H` in index.html.
