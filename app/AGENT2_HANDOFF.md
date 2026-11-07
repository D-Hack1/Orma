# Agent Two handoff and acceptance checklist

Source of scope: `worksplit.md` A2.1–A2.16, checkpoints C0–C3, and `plan.md` §18–20.

Current status (2026-11-07, updated 14:06 IST): contracts v1 and the backend implementation have arrived in the updated checkout. Agent Two's response is `backend/AGENT1_HANDOFF.md`; operational setup is in `backend/DEPLOYMENT.md`. Agent One reviewed the handoff and core examples, but has not yet completed wire-model reconciliation, authenticated Android binding or C1–C3 acceptance. Delivery is not the same as live device/provider completion. The checklist below remains the acceptance criteria.

**Do not wait for the entire backend to finish before handing off.** Deliver the contracts first, then the core API, then each tested feature. "Ready for app integration" and "all assigned backend work complete" are different milestones.

## 1. Contract handoff — C0 / A2.1

Deliver these seven files in `contracts/`:

- [ ] `schema.md`: Firestore paths, canonical member/family/device IDs, date/slot IDs, enum values, evidence format, sharing fields, authentication/role mapping, and which paths each role may read/write.
- [ ] `api.md`: exact callable/HTTP names, request/response/error JSON, required/optional fields, Firebase region, authentication requirements, and examples for success, missing data, clarification, partial, duplicate and rejected access. Document media upload, supported MIME types/encoding/limits and download access too.
- [ ] `understand.schema.json`: intent fields, clarification, member/slot/count and verified `evidence[].span` format.
- [ ] `replies.json`: Malayalam/English answer and Why templates, including Unknown and duplicate protection; identify native-language review status.
- [ ] Language handoff: agree how selected English/Malayalam reaches each endpoint and cited sentence. The current Android stub has `Reply.textEn` / `textMl` and optional `Sentence.textMl`; keep facts and citations equivalent across languages. A Malayalam screen must not silently receive English-only generated answers.
- [ ] `phrases.json`: expected results for the demo phrases, group/ambiguous/negative speech and questions, including evidence spans.
- [ ] `risk-features.md`: fixed feature order, units, scaling, missing-value behavior, means, model/intercept format and contribution units.
- [ ] `demo-family.json`: consistent demo identities, schedules, consent/sharing, nurse assignments, roster, stock and 30 days of history; keep Farhan's unlinked account separate from the family.

Acceptance: examples parse and agree with each other; Agent One reconciles the Android models and acknowledges the contract commit. Subsequent changes use the `CONTRACT CHANGE:` procedure from `worksplit.md`.

## 2. Connection package — A2.2, H2 cloud setup

- [ ] Firebase project ID, region (`asia-south1`), registered Android app (`in.orma`) and its client configuration (`google-services.json` or equivalent FirebaseOptions).
- [ ] Auth setup: phone OTP enabled, approved test numbers/codes or Auth Emulator instructions, UID-to-member/role mapping and test accounts for member, supporter, nurse and independent modes.
- [ ] Actual emulator host/ports, start command, seed command and clean reset command. Include how the emulator and USB Pixel reach the services.
- [ ] Firestore/Storage rules and indexes; public listener paths and upload/download authorization behavior.
- [ ] Deployed function names/region, environment selector and deployment version/commit. Identify what is live, emulator-only or stubbed.
- [ ] App Check debug/development setup and production plan, with no secret server keys in Android assets or source.
- [ ] A working demo reset that moves dates to today and restores consistent schedules, stock and evidence.

Current APK signing certificate, for H2 to register with Firebase phone authentication:

```text
Package: in.orma
SHA-1:   07:5C:F2:E3:A7:50:61:E9:4B:0C:BB:14:49:EB:31:93:97:93:23:2F
SHA-256: 6C:E5:58:A9:A3:B9:EE:63:A3:2E:AF:5F:64:D4:0B:66:B5:D7:9D:41:82:E5:B7:43:D6:A2:31:A3:F1:4E:30:44
```

These are public certificate fingerprints, verified from the current APK. A different signing keystore requires its own fingerprints. H2 owns billing/project/service activation, provider accounts and secret provisioning; Agent Two should list any remaining human setup explicitly.

## 3. Minimum backend ready for Android integration — C1

| Endpoint / feature | Required proof |
|---|---|
| `understand` | Actual Malayalam/Manglish audio and text input; evidence spans verified against transcript; unclear speaker/slot/count asks a question; negative speech cannot become a taken record; provider timeout/fallback covered |
| `logDose` | Firestore transaction with one fixed dose ID; new, concurrent duplicate, partial and group cases tested; stock decremented once; actor/source/evidence retained |
| `askStatus` / `answer` | Existing record produces correctly cited sentences; missing record produces Unknown/wait/escalation; nonexistent citations, wrong times/counts and unsupported medicine names rejected |
| `explain` | Provenance from actual evidence for all five statuses; alert rules and risk reasons distinguish facts from predictions |
| `setSharing` + access rules | Only member/authorized guardian changes sharing; private data is not returned to supporters; nurse cannot read an unassigned patient; tests cover denied reads and writes, not just hidden UI |
| `parsePrescription` | Three real test samples, including handwriting; actual extraction with confidence and bounding boxes; uncertain lines flagged |
| `confirmPrescription` | Only explicitly accepted/confirmed lines become schedules and stock; rejected/unclear lines never auto-activate |
| Live member/dose/alert data | Exact listener paths and stable seed IDs available; a server write is observed by the Android client |

Acceptance: fresh backend start + seed + passing tests + reproducible requests. Agent One then wires the real API and verifies phrases 1–7, group/partial/duplicate/Unknown, evidence/citations and prescription confirmation on the Pixel. Backend unit tests alone do not complete the cross-device integration checkpoint.

## 4. Family, calls and alerts — C2 / A2.7–A2.9

- [ ] Twilio provider configuration and deployed public webhook URLs; signature validation and call consent enforced. Human/provider verification requirements documented.
- [ ] A consented test phone rings; keypad Taken/count updates Firestore with `source=call`, and the dashboard observes it.
- [ ] A spoken call turn reaches real speech understanding and plays a grounded Malayalam reply; unclear speech falls back to keypad input.
- [ ] Due-dose sweep, already-logged suppression, retry at +15/+30 minutes, Unknown and escalation are demonstrated.
- [ ] FCM device-token registration contract, on-duty routing, alert acknowledgement and escalation rules work. A missed/partial/double/unknown case reaches the intended test supporter.
- [ ] Test evidence identifies the call/dose/alert IDs and timestamps. A prerecorded call or manually inserted `source=call` entry is labelled as a fallback, not a live pass.

## 5. Remaining assigned backend work — C3 / A2.10–A2.15

- [ ] Parayu: audio/text message, transcription/translation, urgency routing and nurse delivery (`sendMessage`).
- [ ] Snooze reasons, 7/4/2-day stock warnings and medicine explanations grounded only in entered records (`snooze`, `explainMedicine`).
- [ ] Missed-call callback and SMS handlers, with authentication/signature checks and provider limitations recorded.
- [ ] Malayalam call/reply MP3 assets and their native-language review results.
- [ ] `dailyDigest`: cited sentences, permission-filtered facts, language-specific audio and supporter delivery.
- [ ] `doctorReport`: cited report sections, accessible PDF URL and actual generated sample.
- [ ] `checkStrip`: matches only the member's confirmed schedule; a nonmatching strip returns no match. `checkPillbox`: explicit true/false/uncertain semantics and evidence rules.
- [ ] `ml/out/initial_model.json` and `ml/out/fl_vs_central.png`, reproducible simulation commands, metrics and model version. Feature order agrees with `risk-features.md`; simulation is labelled as simulation.
- [ ] Final rules, App Check configuration, logs, deployment instructions and one-command demo reset.

`flSubmit` / `flAggregate` (A2.16) is **stretch**, separate from the initial handoff: version/dimension/clip checks, clipped/noised updates, at least K=5 clients before aggregation, weighted model update, server-only update access and a visible new version. Do not mark live FL complete using simulator output alone.

## 6. What Agent Two should send at each handoff

```text
Branch + commit:
Contract version/commit:
Completed A2 task IDs:
Working endpoints and deployment region/project:
Exact install/start/seed/reset/test commands:
Test summary and evidence paths (including rules tests):
Demo IDs and test-role/account setup:
Live vs emulator vs mocked features:
Human setup still required:
Known failures / deferred tasks / contract changes:
```

Full assigned backend completion means A2.1–A2.15 are implemented and verified, with C1–C3 integration results recorded. An explicit scope reduction can be agreed, but deferred items stay marked deferred. A status checkbox, successful deployment or list of function names by itself is not completion evidence.
