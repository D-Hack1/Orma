# Orma build status

## Repository structure
- [x] Reviewed directories against `plan.md` and `worksplit.md`.
- [x] Created the Android project folders under `app/`, backend modules under `backend/`, shared `contracts/`, and `ml/out/`.
- [x] Added `.gitkeep` placeholders so Git preserves empty leaf directories.
- Folder scaffold verified; app implementation progress is tracked separately in `app/STATUS.md`.

### Updated plan alignment — 2026-11-07
- Added Android `feature/prescription` (A1.10b), `feature/citations` (A1.10c), and `feature/sharing` (A1.10d).
- Added Android `feature/medicinecheck` for strip and pill-box checks (A1.18b), plus `feature/summary` and `feature/report` (A1.18c).
- Added shared Android `core/camera` for prescription and medicine photo capture.
- Added backend `answers` for grounded answers, `vision` for prescription/strip/pill-box processing, `sharing` for sharing controls, `summaries` for daily digests, and `reports` for doctor reports, under `backend/functions/src/`.
- Existing `telephony` covers conversational call turns; `contracts/` and `ml/` retain their planned locations.
- Verified all 12 new directories and their `.gitkeep` placeholders. Existing app implementation files and planning documents were preserved.

## Agent 1 — app
- [ ] A1.1 Android project scaffold and build configuration.
- [ ] A1.2 Accessibility theme.
- [ ] A1.3 Assistant implementation and device test.
- Device test pending: no device was listed by `adb devices` during initial inspection.

## Agent 2 — backend / ml
- Following the pulled expanded plan (G1–G6 + member-owned sharing), confirmed by the human driver. Android files are unchanged by Agent 2.
- [x] A2.1 Contracts authored: schema, 28 current API examples, 16 phrase fixtures, 31 bilingual templates, synthetic history, and fixed risk feature order. Contract self-check passes; Agent 1 acknowledgement and native Malayalam review are pending (not frozen).
- [x] A2.2 Firebase Node 22 scaffold, loopback emulators, guarded seed/reset and demo project configuration. Seed/reset verified with 1,046 documents; calls disabled in synthetic fixtures.
- [~] A2.3 `understand`: Vertex Gemini + OpenAI fallback, deadlines, schema/evidence validation and authenticated device/member checks implemented with provider mocks. Real audio clips/providers not verified; actual audio duration is not decoded.
- [x] A2.4–A2.6 Local implementation: transactional duplicate audit and shared stock across slots, current-role checks, schedule-grounded pending vs due Unknown, evidence/explanation callables, sharing rules, Gemini adapter with strict fallback and viewer/version-scoped answer persistence. Unresolved question-only input asks for date/slot instead of guessing. Live provider/app acceptance remains pending.
- [x] A2.14 Reproducible 30-family/10-round FL simulator; model, metrics and chart in `ml/out/`; eight tests and byte-identical rerun verified. Synthetic FL accuracy 68.36%, centralized 68.92%, local-only 69.35% (local-only wins; no clinical/DP claim).
- [x] A2.5b Local implementation: prescription extraction adapter, explicit atomic/idempotent confirmation; nurse draft-only; no replacement of existing stock. Tests include a real emulator confirmation transaction. Real prescription/handwriting samples remain pending.
- [x] A2.7–A2.9/A2.12 Local implementation: signed Twilio routers, enrolled consent/session checks, keypad and spoken turns, permanent callback/recording dedupe, status handling, SMS, scheduled due sweep, +15/+30 retries, final Unknown, duty/nurse/FCM/SMS routing, alert trigger and acknowledgement. Provider calls are mocked, not live. Raw recording deletion failures have a bound scheduled cleanup retry.
- [x] A2.10–A2.11 Local implementation: authorized Parayu/call messages, urgency/108 disclaimer, reviewed-phrase translation fallback, timezone/meal snoozes, entered-only medicine explanations and 7/4/2 stock alerts. Direct-message and optional-alert permissions tested against real rules.
- [~] A2.13 Audio generation/cache/private playback and admin pre-generation CLI implemented/tested; real MP3 generation/playback and Malayalam native review require cloud credentials/H4.
- [~] A2.13b Digests, member-local scheduler, private audio and cited English PDF reports implemented/tested. Malayalam PDF explicitly rejected after static/variable Noto font shaping failures; live delivery and exports remain unverified.
- [x] A2.13c Local implementation: confirmed-schedule-only strip matching and photo observations; an empty box cannot independently create ingestion evidence.
- [~] A2.15 Guarded reset, rules, secret bindings, private downloads, runtime export checks and deployment runbook delivered; no real deployment/App Check/OTP or final device verification.
- [x] A2.16 Local implementation: consent-bound T1 submission, clipping/version/dimension/dedup checks, private round bindings and atomic weighted K≥5 aggregation. Real emulator test proves one-time concurrent aggregation; no live phone round or formal DP claim.
- Integration review fixed guardian consent authority bypass: guardians manage consent but do not automatically read private counts, evidence or risk. Regression tests first failed, then passed with the fix.
- Final expanded checkpoint on Node 22.23.4: build, 372 non-emulator tests, 16 real Auth/Firestore/Storage emulator rules/integration checks, 28-example contract self-check and whitespace checks pass. Eight ML tests and pip dependency checks pass. Real emulator seed/reset each wrote 1,046 documents with calls disabled; the new local custom-token helper signed in as achan-uid and refused missing emulator configuration.
- Deployment/phone OTP/App Check on a device/live AI/Twilio/Malayalam review/Android integration are pending. Transitive dependency advisories remain; do not treat this local checkpoint as production-ready.

## Contract changes
- Initial contracts authored, not frozen/acknowledged. Projection fields aligned to implemented `settings.version` / derived `sharingVersion`; private raw risk factors stay local. Photo observation cannot independently establish ingestion.
- CONTRACT CHANGE (acknowledgement pending): documented `downloadMedia`, `ackAlert`, current-version directly addressed owner messages and live stock/risk alert gates. Existing wire field names are unchanged; backend handoff lists required Android stub-model mappings.

## Checkpoint results
- Directory structure verified. Build, integration, and device checkpoints are pending.
- Agent 2 local core checkpoint verified; contracts await Agent 1 acknowledgement, and real app/device/cloud checkpoints C0–C3 are not claimed. Small local commits only; no push.
- Pulled/merged `origin/agent2` at `b50742a` (also remote main at inspection) including `app/AGENT2_HANDOFF.md`. Response: `backend/AGENT1_HANDOFF.md`; operator setup: `backend/DEPLOYMENT.md`. Agent 2 did not edit Android implementation. User now explicitly authorized pushing branch `agent2`; no remote main push is intended.
- The handoff distinguishes implemented code and emulator/mocked evidence from unmet live acceptance: real Firebase client configuration/project provisioning, native reviews, real AI/audio/handwriting samples, Twilio/FCM delivery and Pixel integration remain open. Malayalam PDF and general translation limitations are explicitly documented, not silently marked complete.
