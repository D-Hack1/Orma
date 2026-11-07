# Agent 1 progress

Updated: 2026-11-07 13:22 IST (Asia/Kolkata). Local demo runs on emulator and Pixel; real Pixel power-button test confirmed; live integration pending.

## Scope and coordination
- Agent 1 owns `app/` only. Shared plans, backend and contracts are untouched.
- Branch: `agent1/app` in the existing checkout; no sibling worktree is created outside the writable workspace.
- `contracts/` currently contains placeholders only. Local fixtures follow `plan.md` §18–19 and will need reconciliation when Agent 2 publishes contracts.
- Connected devices: `emulator-5554` (API 37) and Pixel 6a `35111JEGR07225` (Android 17 / API 37). App installed on both. Pixel power-button behavior confirmed by the user.
- Agent Two delivery requirements and acceptance evidence are tracked in `app/AGENT2_HANDOFF.md`. Its other branch/worktree must be handed off before implementation can be assessed from this checkout.
- This file is the app-local status/progress log; update after every implementation or verification milestone.

## Tasks
| Task | State | Evidence / remaining work |
|---|---|---|
| A1.1 Android scaffold | Verified | Debug APK builds, installs and launches on API 37 emulator and physical Pixel 6a; min 26 / target 36. Kotlin, Compose, Hilt, navigation, serialization, Firebase SDKs |
| A1.2 Accessibility | Partly verified | 64dp actions, wrapping text, semantics, captions, 400ms button debounce, haptics; 200% font visually checked; full TalkBack/Scanner QA pending |
| A1.3 Assistant spike | Pixel + emulator verified | Active voice service on both; user confirms physical Pixel long-press power from locked phone opens Speak. Launcher and persistent-notification fallbacks available |
| A1.4 API layer | Partial | Persistent local stub and callable transport; no FirebaseOrmaApi adapter until contracts exist |
| A1.5 Assisted speech | Partial | Android Malayalam SpeechRecognizer + TTS and tap fallback; raw AAC/backend audio processing not yet implemented |
| A1.6–A1.8 Assisted flow | Local demo verified | Evidence highlighting, clarification, explicit confirmation, group logging, partial and duplicate guard; group flow passes Compose device test |
| A1.9 Onboarding | Pending | Demo role switcher works; OTP and real family setup require backend/config |
| A1.10 Family dashboard | Local demo | StateFlow updates; family and assigned-patient views; counts private by default; live server listeners pending |
| A1.10b Prescription | Pending | Requires published extraction/confirmation contract; no fabricated prescription output |
| A1.10c–d Citations / sharing | Local demo | Cited saved record IDs, member-local sharing toggles; account verification pending |
| A1.11 Why sheet | Local demo | Actual local record provenance or explicit no-record reply |
| A1.12 Independent mode | Local demo verified; schedule partial | Silent notification Taken action saves without activity, repeated action blocked; one-minute alarm and 30-min snooze implemented; daily schedule and reboot restoration pending |
| A1.13 Nurse | Partial local demo | Assigned Achan/Amma list and nurse-attributed logging; notes and change suggestions pending |
| A1.14 Parayu | Pending | Message/audio/translation contract and real backend required |
| A1.15 Snooze / refill | Partial | 30-minute notification snooze; reason-specific snoozes, stock decrement and refill UI pending |
| A1.16 Tiers / offline | Partial; local logging verified offline | Malayalam/Manglish fallback and persistent duplicate guard work in airplane mode; capability tiers, sync queue and Remote Config pending |
| A1.17 Check-ins | Pending | Daily confirmed schedules, retry and escalation integration required |
| A1.18 Risk | Pending | Await feature contract and model from Agent 2; no invented predictions shown |
| A1.18b Strip / pill-box | Pending | Vision contracts and real samples required |
| A1.18c Summaries / reports | Pending | Cited summary / PDF contracts and backend required |
| A1.19 Polish | Partial | Debug build, 19 unit tests, four device tests, 0 lint errors, font scale and offline checks pass; native-language/TalkBack QA, Baseline Profile and release APK pending |
| A1.20 FL training | Pending stretch | Requires model, feature contract, consent and server aggregation |
| A1.21 Widget | Pending stretch | Launcher and notification Speak shortcuts available in the meantime |

## Assistance needed
- Agent 2: publish contracts and Firebase project configuration before live integration.
- Human QA: Malayalam speech/TTS review, phrases 1–7 spoken on the Pixel, TalkBack and Accessibility Scanner review. The real Pixel locked-phone power-button check has passed.
- C: remains nearly full. Current builds use `U:/orma-build-cache` (roughly 8GB still free). Free space on C: before switching back to Android Studio's default cache location.

## Change log
- Initial inspection: read plans and task split; found no source or contracts; connected to the running emulator.
- 12:39–12:43: created Gradle wrapper, build catalog, application, theme, assistant entry point and Firebase dependencies.
- 12:43–12:46: implemented persistent demo API, safety rules, role-based Compose screens, speech fallback, evidence and citations. Added 12 safety unit tests and two device smoke tests; execution pending.
- Build issue: Firebase BoM 34.15.0 requires Kotlin 2.3 metadata; pinned BoM 33.7.0 to match Kotlin 2.1.0.
- Build issue: JVM native-memory allocation failed while using a 3GB heap. Reduced heap to 1536MB, workers to two, SerialGC, Kotlin in-process; rebuilding.
- 12:49: debug APK and test APK built successfully; all 12 safety unit tests pass. Installed APK on emulator and visually inspected dashboard screenshot.
- 12:49: direct ACTION_ASSIST launches the Speak activity successfully (433ms warm launch). Default-role inspection caught missing RecognitionService metadata; implemented an adapter to an installed recognizer, excluding itself to prevent recursion.
- Initial device tests blocked by old Espresso reflecting removed InputManager.getInstance on API 37. Upgrading to AndroidX Test runner 1.7 / JUnit extension 1.3 / Espresso 3.7 (official release notes identify this fix), then rerunning.
- 12:53: C: reached **0 bytes free** during dependency transforms. Preserved the installed APK, unit-test reports and source; removed only this project's generated intermediates/tmp and wrapper-bootstrap directory (about 188MB now available). No user files or global caches were deleted.
- Added optional `-PormaBuildRoot=...` support so subsequent build artifacts can use a scratch drive. U: has roughly 10GB free; attempting an isolated Gradle home and build directory there.
- 12:58: added silent demo notifications with Taken/Snooze PendingIntent actions, AlarmManager exact/inexact fallback and permission setup, plus launcher and notification Speak shortcuts. Daily schedule wiring and reboot restoration remain pending. Added on-device notification action / duplicate test; not yet run.
- 12:58: strengthened local-storage failure handling: unreadable saved records disable logging, preserving a fail-closed duplicate guard. Added the corresponding unit test (13 total now).
- Visually checked 200% font scale on the running first APK; labels wrap and screen content scrolls. Restored font scale to 1.0. Full TalkBack/Scanner review still pending.
- Added `tools/check-emulator.ps1` for repeatable build/install/smoke-test/screenshot checks.
- 13:01: added conservative Malayalam/Manglish offline keyword understanding (explicit member, slot, count, taken verb; rejects negatives/conflicts), and generation-guarded speech callbacks with a 15-second limit. Five more keyword safety tests added (18 unit tests total), awaiting this build.
- First app milestone committed as `e9c3c8a` (`feat(app): build accessible local demo and assistant scaffold`). Subsequent changes will be committed after current checks.
- 13:04: corrected APK installed; Android reports `in.orma/.assistant.OrmaVoiceInteractionService` as active. System KEYCODE_ASSIST opens `AssistActivity`. All 18 then-current unit tests pass.
- 13:04: device tests: family dashboard, nurse assignment filter and silent notification action pass. Group-flow test executed the first save, then failed on an ambiguous test selector (caption/input/button had identical text); added a unique test tag and rerunning.
- Lint found notification permission race handling plus unescaped colon in local SDK properties. Added SecurityException handling around posting and corrected local properties; rerunning lint.
- Added explicit clarification for unsupported yesterday/tomorrow/date inputs, to prevent logging a past statement as today's dose; 19 unit tests now.
- 13:06: simulated emulator screen-off → long-press power opens Speak. This does not replace H3's physical/OEM/secure-lock test.
- 13:08: latest build succeeds, **19/19 unit tests** pass, **4/4 device tests** pass, and lint reports **0 errors / 31 warnings** (mostly pinned dependency updates, resource usage and backup metadata). No lint baseline or error suppression was used to force a pass.
- 13:10: airplane-mode + Wi-Fi-off run: saved Farhan's noon dose through the UI, checked one persisted record, repeated the log and saw the duplicate warning. Restored airplane mode off and Wi-Fi on. Cloud resynchronisation is not implemented yet.
- Packaged the tested debug APK at `app/artifacts/orma-debug.apk`; test/lint evidence and screenshots are in `app/artifacts/` (ignored generated files).
- Final launch/screenshot helper verified with exit code 0. Emulator is online, font scale is restored to 1.0, and the Supporter home screen is open. This milestone is committed as `feat(app): add offline speech and silent reminder actions`.
- 13:17–13:18: detected authorized USB Pixel 6a (Android 17 / API 37); installed current app and test APK. Physical dashboard and nurse-assignment smoke tests both pass (**2/2**); screenshot at `artifacts/pixel-home.png`, runner output at `artifacts/pixel-smoke-test-output.log`.
- Pixel initially retained Google's default assistant after the user's setup attempt. Switched the assistant role to Orma; Android reports `in.orma/.assistant.OrmaVoiceInteractionService`, bound to its session service.
- User then confirmed: locked Pixel + physical power-button hold opens **Orma's Speak screen**. No automated synthetic key event was used as a substitute for this human result.
- Added `AGENT2_HANDOFF.md`: seven contract files, Firebase/Auth/client setup and APK certificate fingerprints, core endpoint acceptance tests, call/alert delivery, remaining A2.10–A2.15 requirements and separately identified A2.16 stretch. No backend or shared contract files changed.

## Latest verification commands / evidence
- Scratch build: Gradle 8.13 with `-g U:/orma-build-cache --project-cache-dir U:/orma-build-cache/project-cache -PormaBuildRoot=U:/orma-build-cache/build :app:assembleDebug :app:testDebugUnitTest :app:assembleDebugAndroidTest :app:lintDebug --no-daemon`.
- Device suite: `tools/check-emulator.ps1 -DeviceTests -BuildRoot U:/orma-build-cache/build`; **OK (4 tests)**. App: `in.orma`, emulator: `emulator-5554` (API 37).
- Assistant: active voice service is `in.orma/.assistant.OrmaVoiceInteractionService`; KEYCODE_ASSIST and simulated long-press power from screen off both open Speak.
- Local demo records include QA entries for Achan/Amma morning and Farhan morning/noon. These are sample records, not real medicine events.
- C1 is **not reached**: contracts, Firebase options, OTP, authenticated listeners and real callable adapters are missing. Telephony, prescription recognition, messaging, summaries and FL are pending.

## Checkpoint C0 / assistant result
- **Historical C0 result at 12:54 (within 20 minutes):** first APK builds/installs/launches; direct ACTION_ASSIST → Speak passes. Default-service invocation was not yet passed because the corrected build was blocked by full C: storage.
- **Follow-up at 13:04–13:06:** corrected build installed using U: scratch space; default voice service, system assistant invocation and simulated emulator power-button invocation **PASS**.
- **Physical Pixel follow-up:** user confirms long-press power from the locked Pixel 6a opens Speak. Device-specific assistant entry check **PASS**; Malayalam speech quality and other OEMs are separate QA work.
- Contracts: unavailable (`contracts/` contains only `.gitkeep`). Local fixtures are provisional and are not a contract acknowledgement.

## Contract changes
- None. No shared contract files were changed.
