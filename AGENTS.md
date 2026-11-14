# AGENTS.md

## Architecture
- `public/` is the published directory. `public/index.html` is the whole frontend: React 18 UMD from cdnjs, using `React.createElement` (aliased as `E`), with no JSX and no build step. Curated hospital data is in `const H=[...]`; keyword triage rules are in `SYMP`. When the AI call fails, the page falls back to keyword-matched hospitals.
- `public/data/hospitals-extra.json` holds **auto-discovered** facilities (`hospitals`, ids ≥ 100) and specialists (`doctorAdditions`). `mergeExtras()` in index.html merges it into `H`/`SYMP` at page load. Never hand-assign ids ≥ 100 in `H`.
- `netlify/functions/triage.mjs` is a v2 (modern) Netlify Function at `/.netlify/functions/triage`. It uses `@google/genai` with a zero-config `new GoogleGenAI({})`. It also reads the deployed `/data/hospitals-extra.json` (cached 10 min) and appends it to the system prompt, so the AI knows the auto-added entries.
- `scripts/discover.mjs` + `scripts/lib.mjs` run weekly in GitHub Actions (`.github/workflows/weekly-hospital-update.yml`). Gemini + Google Search grounding proposes candidates; `lib.mjs` **rejects any candidate whose name (and, for doctors, name + hospital) is not found on a fetched source page**, and blanks unverified phone numbers. Survivors go to a PR (branch `auto/weekly-directory-update`). A human merge is the publish gate.
- `cloudflare-worker/` is an optional alternative backend and is not deployed by Netlify.

## Non-obvious decisions
- The function must stay in v2 syntax (`export default async (req) => Response`). Netlify AI Gateway only injects `GEMINI_API_KEY`/`GOOGLE_GEMINI_BASE_URL` into modern functions.
- If the owner sets their own `GEMINI_API_KEY`, Netlify doesn't override it and the SDK talks to Google directly. Otherwise the AI Gateway is used. Don't add "missing key" checks to the function.
- The **Actions script** has no AI Gateway: it needs `GEMINI_API_KEY` as a GitHub repository secret (separate from the Netlify variable).
- The default model `gemini-flash-latest` is supported by both AI Gateway and Google directly. Only use AI Gateway-supported models in the function.
- The system prompt is fixed on the server so the endpoint can't be used as a general-purpose AI proxy. Curated hospitals in the prompt must stay in sync with `H` (the "19" count is replaced dynamically by `19 + extras`; update both if you add curated entries).
- Gemini cannot combine Google Search grounding with strict JSON mode on all models, so `discover.mjs` asks for JSON in plain text and parses it with `extractJson`.
- Never auto-publish web-found medical data directly to `main`. Keep the PR gate.
- Tests: `node scripts/test.mjs` (offline, no API key needed).
