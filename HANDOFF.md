# Handoff — Kathai translator

**Goal:** mobile-first web app: spoken English ⇄ spoken Jaffna Tamil, Gemini for understanding/translation and Gemini TTS for speech out of the phone speaker.

**Live:** https://flippingflapping.github.io/kathai-translator/ (demo: add `?demo`). Repo: github.com/flippingflapping/kathai-translator (public, GitHub Pages from `master`).

**Decisions:** static app, no server; user's own Gemini key in localStorage; one Gemini call does transcribe + translate; Interactions API (`/v1beta/interactions`) per Oct 2026 docs; models `gemini-3.8-flash` and `gemini-3.8-flash-tts` (changeable in Settings → Advanced).

**Status:** UI flow verified in headless Chromium (demo provider, fake mic). Adapter covered by `npm test` (7 pass) with a fake fetch.

**Not yet verified:** real Gemini calls (no API key on this machine). Request field names come from the docs; the adapter retries once with a minimal body on HTTP 400. Jaffna accent quality of TTS unknown. Real iPhone/Android mic + speaker not yet tried.

**Next:** run with a real key, check response shapes and latency, tune the dialect guide in `js/languages.js` with a Jaffna speaker.
