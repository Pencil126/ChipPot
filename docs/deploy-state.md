# ChipPot — Deployed state (live resources)

Non-secret record of provisioned infrastructure so an autonomous run survives context
compaction. Secrets live only in `packages/worker/.dev.vars` (gitignored) + Cloudflare
secrets. Cloudflare account **PoterPan** `d216cdc92992e29b473cc209f06bbf32`.

## Worker
- Name `chippot` · https://chippot.poterpan.workers.dev · daily cron `0 1 * * *`
- D1 `chippot-db` `adf93584-5bfa-4376-b08d-b0847709ecfe` (APAC)
- R2 `chippot-proofs` (private)
- vars: DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, WEB_ORIGIN=https://pay.panspace.dev
- secrets: DISCORD_BOT_TOKEN

## Discord (app "ChipPot" id 1510355256498978917)
- Test guild 1305872150015639623 · #ai-訂閱 channel 1510368202541236335
- persistent pay button message id 1510384762345361478
- `/繳費` registered to the guild; interactions endpoint = worker /interactions
- plan→role: ChatGPT 1510380231243075676 · Claude Standard 1510380202109178006 · Claude Premium 1510380082391421008
- test member: discord 290324369442603020 (PoterPan) → Claude Premium sub, payment #1 (2026-05)

## Web upload page (Phase 5)
- Pages project `chippot-web` · custom domain **pay.panspace.dev** (active)

## Admin (Phase 6 — in progress)
- Zone `panspace.dev` `ce6689373c848956c359c09587a4eb1a`
- Cloudflare Access app **ChipPot Admin** id `f500045d-575f-40a2-af20-56a89434ed82`
  - domain `admin.panspace.dev` · session 24h · allow `poterpan5466@gmail.com`
  - **AUD `6682958aadf8ca528792922ff3c7a0756ae8a15976180343ce85cb09cbf6f508`**
  - team domain `panspace.cloudflareaccess.com` · login via built-in One-time PIN
- Plan: SPA on Pages `chippot-admin` @ admin.panspace.dev (Access-gated); admin API
  served by the existing worker via Worker route `admin.panspace.dev/api/*` (worker strips
  `/api` prefix). Same-origin ⇒ Access JWT (Cf-Access-Jwt-Assertion) reaches the worker;
  existing `requireAccess` verifies it. Worker Access vars: ACCESS_TEAM_DOMAIN=panspace,
  ACCESS_AUD=<above>, ACCESS_ALLOWED_EMAILS=poterpan5466@gmail.com.
