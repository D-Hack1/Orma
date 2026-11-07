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
- [x] A2.1 Contracts authored: schema, 26 API examples, 16 phrase fixtures, 31 bilingual templates, synthetic history, and fixed risk feature order. Contract self-check passes; Agent 1 acknowledgement and native Malayalam review are pending (not frozen).
- [x] A2.2 Firebase Node 22 scaffold, loopback emulators, guarded seed/reset and demo project configuration. Seed/reset verified with 1,046 documents; calls disabled in synthetic fixtures.
- [~] A2.3 `understand`: Vertex Gemini + OpenAI fallback, deadlines, schema/evidence validation and authenticated device/member checks implemented with provider mocks. Real audio clips/providers not verified; actual audio duration is not decoded.
- [~] A2.4–A2.6 Core checkpoint: transaction-based dose logging/duplicate audit/stock updates, grounded deterministic replies and validation, status/explanation callables, sharing controls and private projection rules. Explicit date/slot required for status queries. Live Gemini reply wording and answer persistence are not connected.
- [x] A2.14 Reproducible 30-family/10-round FL simulator; model, metrics and chart in `ml/out/`; eight tests and byte-identical rerun verified. Synthetic FL accuracy 68.36%, centralized 68.92%, local-only 69.35% (local-only wins; no clinical/DP claim).
- [ ] A2.5b/A2.7–A2.13c/A2.16: vision, telephony, scheduling/escalation/FCM, messaging, refill/snooze, audio, summaries/reports and live FL aggregation are specified but not implemented in this checkpoint.
- Integration review fixed guardian consent authority bypass: guardians manage consent but do not automatically read private counts, evidence or risk. Regression tests first failed, then passed with the fix.
- Final verification on Node 22.23.4: TypeScript build, 100 non-emulator tests, 10 Auth/Firestore/Storage emulator tests, contract self-check and whitespace checks pass. ML worker verified eight tests and reproducible artifacts.
- Deployment/phone OTP/App Check on a device/live AI/Twilio/Malayalam review/Android integration are pending. Transitive dependency advisories remain; do not treat this local checkpoint as production-ready.

## Contract changes
- Initial contracts authored, not frozen/acknowledged. Projection fields aligned to implemented `settings.version` / derived `sharingVersion`; private raw risk factors stay local. Photo observation cannot independently establish ingestion.

## Checkpoint results
- Directory structure verified. Build, integration, and device checkpoints are pending.
- Agent 2 local core checkpoint verified; contracts await Agent 1 acknowledgement, and real app/device/cloud checkpoints C0–C3 are not claimed. Small local commits only; no push.
