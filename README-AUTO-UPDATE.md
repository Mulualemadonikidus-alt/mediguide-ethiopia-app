# Weekly auto-update + weekly confirmation — setup (≈10 minutes)

**What you get:** every Monday a GitHub Action asks Gemini (with Google Search) for hospitals, specialty
centers, medical plazas and specialists that are not yet listed. Each finding is checked against the real
web page it came from; unverifiable items are thrown out. The survivors arrive as a **Pull Request**
(= your weekly confirmation) plus a **GitHub Issue** with a 3-minute spot-check of existing entries.
When you merge the PR, Netlify redeploys and the site — and the AI symptom checker — include the new entries.

## Files to copy into your repo (keep the same paths)
```
.github/workflows/weekly-hospital-update.yml
scripts/lib.mjs  scripts/discover.mjs  scripts/test.mjs
public/index.html                      (replaces yours: adds mergeExtras + Google Maps links)
public/data/hospitals-extra.json       (starts empty)
netlify/functions/triage.mjs           (replaces yours: AI also reads the extra entries)
AGENTS.md  .env.example  .gitignore
```
`package.json` is unchanged (`@google/genai` is already there).

## One-time setup
1. **Add the key to GitHub** (the Action cannot see Netlify's variables):
   repo → *Settings → Secrets and variables → Actions → New repository secret* →
   name `GEMINI_API_KEY`, value = your free key from https://aistudio.google.com/app/apikey.
2. **Allow the bot to open PRs:** repo → *Settings → Actions → General → Workflow permissions* →
   tick **Read and write permissions** and **Allow GitHub Actions to create and approve pull requests**.
3. **Netlify:** *Site configuration → Build & deploy → Deploy Previews* → enable for pull requests,
   so each weekly PR gets a preview link you can click before merging.
4. **Test it now:** repo → *Actions → Weekly hospital directory update → Run workflow*.
   (Or locally, no changes written: `node --env-file=.env scripts/discover.mjs --dry-run`.)

## Your weekly routine (≈5 minutes)
1. Open the PR → click the **Netlify deploy preview** → look at the new entries.
2. Check names/phones against the listed sources; edit `public/data/hospitals-extra.json` in the PR to fix or delete anything wrong.
3. **Merge** = publish. **Close** = discard. Then tick off the Issue's spot-check list and close it.

## How wrong data is kept out
- A new facility is kept only if its name appears on a page the script actually fetched.
- A phone number is kept only if its digits appear on that page; otherwise it's blanked and flagged.
- A specialist is kept only if their full name AND the hospital name appear on the same page.
- Duplicates (same name or same phone as an existing entry) are skipped.
- Links are limited to http(s); Facebook/Telegram links must really be on those domains.
- Max 8 facilities + 15 specialists per week, so the PR stays reviewable.
- Nothing reaches production without your merge.

## Limits you should know
- Pages that need a login (many Facebook pages) can't be fetched, so valid hospitals found only there are
  listed under "Not added" in the PR for you to add by hand.
- Google Search grounding on the free Gemini tier has a daily quota; weekly use is a few calls.
  Check your limits at https://aistudio.google.com/rate-limit.
- Free-tier Gemini may use prompts to improve Google products. The weekly job only sends public
  hospital names, never patient data.
- GitHub pauses scheduled workflows after 60 days with no repository activity — merging the weekly PRs counts as activity.

## .env — what it's for
`.env` is a *local-only* file (git-ignored) so you can run `netlify dev` or the discovery script on your
computer with your key, without ever putting the key in code. It does **not** go to GitHub/Netlify and
does nothing on the live site. In production the same key lives in two places: a **Netlify environment variable**
(for the symptom checker) and a **GitHub Actions secret** (for the weekly job).
