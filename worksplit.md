# Orma: work split (2 parallel agents + 4 humans)

## 0. Ground rules
1. **Separate folders, so no merge conflicts.**
   - Agent 1 changes only `app/` (Android, Kotlin).
   - Agent 2 changes only `backend/`, `ml/`, `contracts/`, `firebase.json` and `.firebaserc`.
   - Humans own `plan.md` and `worksplit.md`.
2. **Separate git worktrees and branches:**
   ```
   git worktree add ../orma-agent1 -b agent1/app
   git worktree add ../orma-agent2 -b agent2/backend
   ```
   Merge to `main` only at checkpoints C0–C3.
3. **Contracts first.** `contracts/` is frozen at 0:20. Any later change needs a `CONTRACT CHANGE:` entry in `STATUS.md`, and the other agent's human driver must acknowledge it.
4. **Never wait on the other agent.**
   - Agent 1 codes against `StubOrmaApi`, which returns the example JSON from `contracts/`. It switches to the real API with one Hilt binding at C1.
   - Agent 2 tests with curl, the emulator and Vitest.
5. **Update `STATUS.md` after every task.** Commit with `feat(app): …` / `feat(backend): …` / `feat(ml): …`.
6. **Done** = code + test (or a manual check written in STATUS.md) + commit.
7. **Secrets** (Vertex/Gemini, OpenAI, Twilio) go only in Firebase Secret Manager / a git-ignored `.env`. Never in the app, never committed.

## 1. Repository layout
```
orma/
├── plan.md · worksplit.md · STATUS.md
├── contracts/                      ← Agent 2 writes 0:00–0:20, Agent 1 reviews
│   ├── schema.md · api.md          Firestore schema + every endpoint with example JSON
│   ├── understand.schema.json      Gemini output schema (incl. evidence spans)
│   ├── replies.json                reply + "why" templates (ml/en)
│   ├── phrases.json                test phrases + expected intent/evidence
│   ├── risk-features.md            feature list, order, scaling (shared by app + ml)
│   └── demo-family.json            seed data (Anu, Rahul, Achan, Amma, Ammoomma, Mini, Farhan)
├── app/                            ← AGENT 1 (Android Studio project)
│   ├── app/src/main/java/in/orma/
│   │   ├── assistant/   OrmaVoiceInteractionService, SessionService, AssistActivity
│   │   ├── core/        theme(a11y), navigation, tier, di(Hilt), l10n
│   │   ├── data/        OrmaApi (+Stub, +Firebase), repositories, Firestore models
│   │   ├── audio/       recorder, tts, stt, haptics
│   │   ├── reminders/   AlarmScheduler, NotificationActions receiver, check-ins
│   │   ├── fl/          RiskModel (logistic reg.), FeatureBuilder, TrainWorker, Explainer
│   │   ├── widget/      Glance widget
│   │   └── feature/     onboarding · assisted · independent · caregiver · nurse · parayu · why
│   ├── app/src/main/res/values(-ml)/strings.xml
│   └── app/src/test · app/src/androidTest · baselineprofile/
├── backend/                        ← AGENT 2
│   ├── functions/src/  ai/ · doses/ · replies/ · explain/ · telephony/ · alerts/ ·
│   │                   messages/ · scheduler/ · fl/
│   ├── functions/test/
│   ├── firestore.rules · firestore.indexes.json · storage.rules
│   ├── seed/ · scripts/reset-demo.ts · audio/ (Malayalam MP3s)
└── ml/                             ← AGENT 2
    ├── fl_simulator.py · synth_families.py · requirements.txt
    └── out/ (initial_model.json, fl_vs_central.png)
```

## 2. Humans (4 people)
| Person | Role | Responsibilities |
|---|---|---|
| **H1** | Agent 1 driver | Starts and steers Agent 1, runs builds on the real phone through Android Studio, approves the `app/` merges |
| **H2** | Agent 2 driver + cloud admin | **Before 0:00:** sets up the Firebase project (asia-south1, Blaze plan with a budget alert), Vertex AI, Cloud TTS, Secret Manager, Cloud Tasks; **Twilio free trial**: get the trial number, **verify the keypad phone + the team's phones**, turn on **India Geo Permissions**; OpenAI key. During the build: steers Agent 2, deploys |
| **H3** | QA + devices | 3 phones (a modern Android for the power-button demo, a low-end/Go phone, a **keypad phone**) + scrcpy on the laptop. Sets up the default assistant on the demo phone. Runs the checklist at each checkpoint, plus the TalkBack, sound-off and airplane-mode runs |
| **H4** | Pitch + language | Native-speaker review of all Malayalam prompts, replies, "why" texts and call audio. Records 3 real voice clips for Agent 2's tests. Brings **3 sample prescriptions (at least 1 handwritten, with personal details removed)** and 2 medicine strips for G2/G6 testing. Builds the pitch on the BIA deck (including the FL chart and XAI screenshots). Rehearses the demo and records the **backup video** at C3 |

## 3. Timeline and checkpoints (4:00)
| Phase | Time | Agent 1 (Android app) | Agent 2 (Backend · AI · Telephony · FL) |
|---|---|---|---|
| **P0 Setup** | 0:00–0:20 | Project scaffold, Hilt, Compose theme, nav, Firebase SDK. **Test: power-button assistant on H3's phone** | Write `contracts/*`, `firebase init`, emulator, seed loader |
| **C0** | 0:20 | **Contracts frozen**; spike result recorded in STATUS.md | |
| **P1 Core** | 0:20–1:15 | Assisted `/speak` + logging + evidence highlighting; **prescription capture + confirm screen** (against the stub) | `understand` (+ evidence verification), `logDose`, **grounded answer engine**, rules + sharing, **prescription vision** |
| **C1** | 1:15 | **Merge.** Real API. H3 tests phrases 1–7, highlights, a grounded answer with citations, a handwritten prescription | |
| **P2 Family + Calls** | 1:15–2:15 | Caregiver tree, **citations UI**, **sharing controls**, "Why?" sheet, Independent mode, notification actions | **Twilio IVR + conversational turns**, `doseSweep`, retries, FCM alerts, `explain` |
| **C2** | 2:15 | **Merge.** Keypad call: *spoken* answer → ✅ + Malayalam reply; Independent ✓ → dashboard; sharing toggle; Why? works | |
| **P3 P1 features** | 2:15–3:15 | Nurse, Parayu, **strip/pill-box camera**, **summary + doctor report views**, snooze, refill, tiers + offline, check-ins, risk UI | Messages, **daily summary + doctor report**, **strip + pill-box check**, refill, snooze, roster, missed call, audio pre-generation, FL simulator + chart |
| **C3** | 3:15 | **Merge + FEATURE FREEZE.** Backup video recorded | |
| **P4 Polish** | 3:15–3:45 | Accessibility pass, Baseline Profile, release APK; *stretch:* FL TrainWorker + flSubmit | Rules, reset-demo; *stretch:* `flSubmit`/`flAggregate` live |
| **Rehearse** | 3:45–4:00 | Everyone: 2 full demo runs | |

---

## 4. AGENT 1: Android app (`app/`)
**Mission:** a native Kotlin/Compose app whose screens adapt to role, mode, accessibility needs and phone tier. It includes the power-button assistant, explainable "Why?" screens, and an on-phone FL client.

| # | Phase | Task | Details | Done when |
|---|---|---|---|---|
| A1.1 | P0 | Scaffold | Android Studio project `in.orma`, minSdk 26, target latest stable, Kotlin 2.x, Compose BOM, Material 3, Hilt, Navigation Compose, kotlinx.serialization, Firebase BoM (Auth, Firestore, Functions, Messaging, Remote Config, Crashlytics, App Check), version catalog, strings `values/` + `values-ml/` | Runs on H3's phone, connects to the emulator |
| A1.2 | P0 | Accessibility theme | High-contrast M3 colour scheme; respects font scale up to 2.0; `Modifier.semantics` helpers; minimum 64dp targets (Assisted: full-screen); 400 ms double-tap debounce; vibration patterns | TalkBack reads the home screen correctly; Compose UI accessibility checks pass |
| A1.3 | P0 | **Power-button assistant test** | `OrmaVoiceInteractionService` + `SessionService` + `AssistActivity` (`setShowWhenLocked`, `setTurnScreenOn`) → opens `/speak`; `RoleManager` request flow; fallbacks: launcher shortcut, persistent notification | Long-press on H3's phone opens `/speak` from the lock screen. **Result in STATUS.md by 0:20** |
| A1.4 | P1 | API layer | `OrmaApi` interface; `StubOrmaApi` (contract JSON from assets); `FirebaseOrmaApi` (callables); Hilt module switch | Same unit tests pass on both |
| A1.5 | P1 | Assisted `/speak` | Opens already listening → `AudioRecord`/`MediaRecorder` (16 kHz mono AAC, max 15 s, stops on silence) → `understand` → follow-up question if needed → `logDose`/`askStatus` → **large caption** + TTS `ml-IN` + vibration | Phrases 1–7 work against the stub |
| A1.6 | P1 | **Evidence highlighting (XAI)** | Highlight the `evidence[].span` words in the transcript caption (colour + underline + semantics description "heard: both of us → both members") | Highlights are correct for the test phrases; TalkBack reads them |
| A1.7 | P1 | Group / unclear-speaker UI | Several members ✅; if the speaker is unclear, 3 huge buttons + spoken question | Works against the stub |
| A1.8 | P1 | Assisted home | Huge Speak button + 3 slot icons (tap = log) + status colours | Fully usable by icons only |
| A1.9 | P2 | Onboarding + roles | Phone OTP; the 3 setup questions; role switcher; caregiver creates the family and adds Assisted / Independent / **Keypad (phone number)** members + schedules | Demo family can be built from the UI |
| A1.10 | P2 | **Caregiver dashboard** | Tree; a row per member with live Morning/Noon/Night status, counts, stock, source/by; alerts with acknowledge; log on behalf; call button | Updates live within 3 s |
| A1.10b | P1 | **Prescription capture + confirm (G2)** | CameraX capture → upload → `parsePrescription` → side-by-side screen: photo with boxes drawn around each line ↔ editable lines, confidence chips, per-line ✓/✗, "ask pharmacist" flag → `confirmPrescription` | Handwritten sample → confirmed schedule appears |
| A1.10c | P2 | **Citations UI (G3)** | Answer captions are split into sentences; tap a sentence → bottom sheet listing its cited records; TalkBack reads "source: you said at 8:15"; voice "Enthaa angane?" speaks the sources | Every answer sentence has tappable sources |
| A1.10d | P2 | **Sharing controls (elder-first)** | Elder settings screen (big toggles + voice command via `understand` intent `setSharing`); supporter views hide fields that aren't shared and show "Amma keeps this private" | Rahul's view changes live after Amma's voice command |
| A1.11 | P2 | **"Why?" sheet (XAI)** | ⓘ on every status, alert and risk → `explain` → reasons list + evidence trail + contribution bars; Assisted: answers the spoken "Enthaa angane?" | All 5 statuses explain correctly |
| A1.12 | P2 | Independent mode | Minimal UI; `AlarmManager` exact alarms (+ permission request flow); **silent** notifications with ✓ Taken / ⏰ Snooze → `BroadcastReceiver` → `logDose`; no voice | ✓ from the notification shade logs the dose |
| A1.13 | P3 | Nurse view | Assigned patients only, due list, "Given" (source = nurse), notes, suggest change | Mini sees only Achan and Amma |
| A1.14 | P3 | Parayu UI | Record a message to the nurse or family; replies spoken + captioned; urgent banner with a call-108 button | Message reaches the nurse |
| A1.15 | P3 | Snooze reasons + refill UI | Reason buttons / voice; stock bar | |
| A1.16 | P3 | **Tiers + offline** | Capability check (A §7) → T1/T2/T3 flags from Remote Config; `SpeechRecognizer` offline + keyword matcher (`phrases.json` keywords, numbers 1–9 in Malayalam/English); fixed dose IDs; local double-dose check from the cache | Airplane mode: logging + guard work, syncs when back online |
| A1.17 | P3 | Dose-time check-ins | Exact alarm → full-screen voice prompt → "aa"/"illa"/tap → asks again after 15 min | |
| A1.18 | P3 | **Risk model + explanation** | `RiskModel` (logistic regression, weights from `flModels/latest`, initially `ml/out/initial_model.json`); `FeatureBuilder` per `contracts/risk-features.md` (on-phone signals: response delay, repeated questions, snoozes); writes `risk/{date_slot}` with `contributions = wᵢ(xᵢ−x̄ᵢ)`; the high-risk slot gets an earlier reminder | Contributions add up to the logit (unit test); badge + top-2 reasons shown |
| A1.18b | P3 | **Strip check + pill-box check (G6)** | Camera screen "Ithu ethaa?" ("Which one is this?") / "show today's box" → `checkStrip` / `checkPillbox` → spoken + captioned grounded reply; status badge "photo-verified" | Demo strip matched; strip not on the list handled |
| A1.18c | P3 | **Summary + doctor report views (G4/G5)** | Supporter: daily summary card with ▶ voice note + cited sentences; "Doctor summary" button → PDF viewer + share sheet (WhatsApp) | Summary plays; PDF opens and shares |
| A1.19 | P4 | Polish | TalkBack labels, sound-off run, largest font, Accessibility Scanner clean, Baseline Profile, R8 release APK | H3's checklist is green |
| A1.20 | P4 (stretch) | **FL TrainWorker** | WorkManager (`requiresCharging`, `UNMETERED`, `requiresDeviceIdle`; plus a "Train now" debug button for the demo); local SGD for a few epochs; L2 clipping + Gaussian noise; `flSubmit`; only if `consent.fl` and the phone is T1 | One live round is visible on the dashboard as a new model version |
| A1.21 | stretch | Glance widget | 3 slots, tap to log | |

### Agent 1 kickoff prompt
> You are **Agent 1** building the **Orma** native Android app (Kotlin, Jetpack Compose, Material 3, Hilt, Navigation Compose, Coroutines/Flow, kotlinx.serialization, Firebase Android SDK) in `app/` only. Read `plan.md` §5–§13, §16–§19 and everything in `contracts/`. Never edit files outside `app/`. Work through tasks A1.1→A1.21 in `worksplit.md` in order. A1.3 (power-button assistant via VoiceInteractionService, opening on the lock screen) must report its result in `STATUS.md` by minute 20. Until checkpoint C1, use `StubOrmaApi`, which serves the example JSON from `contracts/api.md`. Accessibility is a hard requirement: semantics on every composable, 64dp minimum touch targets, support for font scale up to 2.0, captions for every spoken reply, vibration feedback, and double-tap debounce. The AI never decides facts: show only what the backend returns, and label risk as a "prediction". Commit after each task (`feat(app): …`) and update `STATUS.md`. If a contract looks wrong, write a `CONTRACT CHANGE:` request in STATUS.md, keep using the stub, and do not edit `contracts/` yourself.

---

## 5. AGENT 2: Backend, AI, telephony, FL (`backend/`, `ml/`, `contracts/`)
**Mission:** a Firebase backend that understands speech with Gemini (with verified evidence), enforces never-guess and the double-dose guard on the server, explains every decision, places keypad calls, routes alerts and messages, and runs FL aggregation and simulation.

| # | Phase | Task | Details | Done when |
|---|---|---|---|---|
| A2.1 | P0 | **Contracts** | `schema.md`, `api.md` (example request/response for every endpoint), `understand.schema.json` (with `evidence[]`), `replies.json` (reply + why templates in ml/en, reviewed by H4), `phrases.json`, `risk-features.md` (feature order, scaling, means), `demo-family.json` (with 30 days of history so risk and why have data) | Agent 1 acknowledges at 0:20 |
| A2.2 | P0 | Firebase setup | `firebase init` (Functions TS Node 22, Firestore, Storage, Emulators, Remote Config), asia-south1, seed loader, `reset-demo.ts` | `npm run seed` fills the emulator |
| A2.3 | P1 | `understand` | `@google/genai` on Vertex, Flash model, audio inline + system prompt (members, today's schedule, Manglish examples) + `responseSchema`; **zod**; **check that each evidence span is a substring of the transcript; drop invalid spans; a required field with no span → needsClarification**; 6 s timeout → OpenAI fallback → `unclear` | Vitest passes on all `phrases.json` rows; 3 audio clips from H4 pass |
| A2.4 | P1 | `logDose` + guard | Firestore **transaction** on `doses/{date_slot}`: duplicate → `duplicate_blocked` + alert; lower count → `partial`; decrement stock; append to `evidence[]` | Tests: new / duplicate / partial / group |
| A2.5 | P1 | **Grounded answer engine (G3)** | Fact-pack builder (only shared fields, each with a record ID) → Gemini `sentences[{text, cites}]` / `insufficient` → **validator**: every sentence is cited, cited IDs exist, numbers/times match, no medicine names outside the pack → drop invalid sentences → template fallback; Unknown → alert; save to `answers/` | Tests: no record ⇒ Unknown; an invented citation is dropped; a wrong time is dropped |
| A2.6 | P1 | `answer`/`askStatus` + rules + **sharing** | Role rules (member = data owner, supporters see only shared fields, nurse sees only assigned members, `flUpdates` server-only); `setSharing` (member/guardian only); rules unit tests | A supporter can't read a field that isn't shared; a nurse can't read an unassigned member |
| A2.5b | P1 | **Prescription vision (G2)** | `parsePrescription`: Gemini Pro vision → zod-checked lines with confidence + box coordinates; `confirmPrescription` writes the schedule + stock | 3 sample prescriptions from H4 (1 handwritten) extracted; low-confidence lines flagged |
| A2.7 | P2 | **Twilio IVR (free trial)** | `TelephonyProvider` interface (Twilio now, Exotel later). `/voice/start` (`<Play>` + `<Gather numDigits=1 timeout=10>`), `/voice/gather` (1 → count → `logDose(source=call, evidence.digits)`; 2 → retry; 3 → `<Record>` → message; 4 → explain medicine; 9 → repeat), `/voice/status` (no answer → retry). Validate Twilio signatures. **Deploy early** (Twilio can't reach the emulator). Works with the trial preamble (callee presses any key first) | H3's keypad phone rings; pressing 1 gives ✅ with evidence in Firestore |
| A2.7b | P2 | **Conversational call (G1)** | `<Gather>` with a prompt that says "just speak" → `<Record maxLength=8 timeout=2>` → `/voice/turn`: Gemini audio understand → logDose / answer / message → grounded reply → cached or live Cloud TTS MP3 → `<Play>` + next turn; "Shari…" filler; 2 unclear turns → keypad menu; 4 s budget per turn | H3 speaks "kazhichu randu ennam" on the keypad phone → 🟡/✅ + a Malayalam reply |
| A2.8 | P2 | `doseSweep` + task queues | Every 1 min: due slots → FCM backup push; keypad member → call **only if not already logged**; `retryCall` at +15 and +30 → Unknown → `escalate` | A scheduled demo dose triggers a call automatically |
| A2.9 | P2 | Alerts + FCM + `explain` | Alerts routed to the on-duty person by the roster, each storing its `rule`; escalation every 5 min; `explain` builds the reasons from the evidence trail / alert rule / risk contributions → template → (Gemini wording, fact-checked) | Why? gives correct text for all 5 statuses + alerts |
| A2.10 | P3 | Messages (Parayu) | Store the audio, transcribe, translate to the recipient's language, detect urgent words (keywords + Gemini) → 🔴 to everyone on duty | The headache message reaches Mini, translated |
| A2.11 | P3 | Refill, snooze, explainMedicine | Days-of-stock alerts at 7/4/2; snooze "not eaten" → reminder after the usual meal; medicine info only from entered data | Unit tests |
| A2.12 | P3 | Missed call + SMS | `/voice/incoming` → `<Reject>` → call back with the menu; `/sms/incoming` for "1"/"2"; SMS alerts when a caregiver has no FCM token | Missed call → callback works |
| A2.13 | P3 | Audio pre-generation | Cloud TTS → MP3 for every call prompt + common replies → Storage; H4 reviews them | All call prompts play in Malayalam |
| A2.13b | P3 | **Daily summary (G4) + doctor summary (G5)** | `dailyDigest` scheduled for 20:00 (+ callable for the demo): fact pack of the day (shared fields only) → cited sentences → TTS voice note in each supporter's language → FCM; `doctorReport`: cited sections → PDF (pdfkit) → Storage | Demo summary + PDF generated, every sentence cited |
| A2.13c | P3 | **Strip check (G6) + pill-box check** | `checkStrip`: vision reads the name/strength → fuzzy-match **only** against the member's schedule → grounded reply; `checkPillbox`: `{slotEmpty}` → status `confirmed(photo)` | A strip that's not on the list ⇒ "not on your list"; a pill-box photo upgrades the status |
| A2.14 | P3 | **FL simulator** (`ml/`) | `synth_families.py`: 30 families with different patterns (forgetful nights, weekend dips, nurse effect, memory-decline drift); `fl_simulator.py`: local SGD + clipping + noise + FedAvg for 10 rounds vs. centralised vs. local-only; writes `out/initial_model.json` (weights + feature means in `risk-features.md` order) and `out/fl_vs_central.png` | Chart + model ready for Agent 1 and H4 by C3 |
| A2.15 | P4 | Hardening + demo | Final rules, App Check, logs, `reset-demo.ts` sets "today" so dose times line up, deploy | One command resets the demo |
| A2.16 | P4 (stretch) | **`flSubmit` / `flAggregate`** | Validate version + clip norm; store in `flUpdates/{round}`; aggregate when there are ≥K updates (K=5; the demo seeds 4 simulated client updates + 1 live phone) → `flModels/{v+1}` | The live round produces a new model version |

### Agent 2 kickoff prompt
> You are **Agent 2** building the **Orma** backend in `backend/`, the ML simulator in `ml/`, and the shared `contracts/`. Read `plan.md` §5, §9–§13, §15–§20 first. Never edit `app/`. Your first job (by minute 20) is `contracts/` (A2.1); Agent 1 depends on it, so give an example request/response for every endpoint and a fixed feature order in `risk-features.md`. Then work through A2.2→A2.16 in `worksplit.md`. Stack: Cloud Functions 2nd gen, TypeScript, Node 22, asia-south1, `@google/genai` on Vertex AI (Flash for speech/text, Pro for vision), OpenAI as fallback, zod, Vitest, Firebase Emulator Suite, Twilio **free trial** behind a `TelephonyProvider` interface, Python 3.12 + NumPy + scikit-learn + matplotlib for `ml/`. Hard rules: the AI never decides facts (A2.5); every evidence span must be verified against the transcript (A2.3); the double-dose guard is a Firestore transaction; FL updates are clipped, noised, and aggregated only when there are ≥K clients; secrets go only in Secret Manager. Deploy the telephony functions to the real project as soon as A2.7 starts. Commit after each task (`feat(backend|ml): …`) and update `STATUS.md`. Write any contract change as `CONTRACT CHANGE:` in STATUS.md before applying it.

---

## 6. Integration checkpoints
| Checkpoint | Merge | H3 checklist |
|---|---|---|
| **C0 (0:20)** | contracts → main | Contracts acknowledged; power-button test result recorded |
| **C1 (1:15)** | both → main; app uses the real API | Phrases 1–7 on the real phone; evidence highlights correct; double log blocked; no record → Unknown |
| **C2 (2:15)** | both → main | Keypad call → press 1 → ✅; Independent ✓ → dashboard; group log; Why? for all statuses; missed-dose alert to Anu |
| **C3 (3:15)** | both → main, **freeze** | Full demo script; TalkBack run; sound-off run; airplane-mode run; risk badge with reasons; FL chart in the deck; backup video recorded |

## 7. Fallback decisions
| Situation | Decision |
|---|---|
| Power-button test fails at 0:20 | Use the Samsung side-key / corner-swipe gesture / widget instead; say so honestly in the pitch |
| Gemini slow or failing at C1 | Switch Remote Config to OpenAI as primary |
| Twilio not working by 2:15 | At most 20 more minutes; otherwise play a recorded call and write `source=call` from the console |
| Risk model not ready by C3 | Show precomputed risk documents from the seed (the explanations still use real weights from the simulator) |
| FL live round (stretch) not done | Show the simulator chart only, and say "live rounds run nightly while the phone charges" |
| An agent is behind at C2 | Drop P1 items in this order: missed call → snooze reasons → nurse notes → check-ins → risk model → doctor summary. **P0 is never dropped** |
| Conversational call too slow or unreliable | Keep the spoken greeting, fall back to key presses; show one pre-recorded spoken-turn call in the backup video |
| Handwritten prescription extraction is poor | Demo with a clearer handwritten sample chosen in advance (H4); still show the confidence flags |
| A merge conflict | Only possible in `contracts/`; Agent 2's version wins and Agent 1 adapts |

## 8. STATUS.md template
```
## Agent 1 — app
- [x] A1.1 Scaffold
- [~] A1.5 Assisted /speak (stub OK, real API pending C1)
- BLOCKED: —
## Agent 2 — backend / ml
- [x] A2.1 Contracts (frozen 0:20)
- [~] A2.7 Twilio IVR (deployed, gather OK, retry pending)
## CONTRACT CHANGES
- 1:40 A2: added `reply.audioUrl` to logDose response (ack: H1)
## Checkpoint results
- C1: phrases 1–7 ✅, highlights ✅, guard ✅, unknown ✅
```
