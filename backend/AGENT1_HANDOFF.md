# Agent 2 → Agent 1 handoff

Response to `app/AGENT2_HANDOFF.md`, read from remote commit `b50742a` and merged into branch **agent2**. Android files were not edited by Agent 2. This is a backend implementation handoff, **not** a claim that C0–C3 cross-device acceptance has passed.

## Delivered

`contracts/` contains contract v1: API examples, Firestore/sharing schema, understanding JSON Schema, bilingual templates, phrase fixtures, fixed risk vector and synthetic family/history. Run `python contracts/check.py`. Agent 1 acknowledgement and native Malayalam review remain required before freezing.

Implemented callable exports in `asia-south1`:

`understand`, `logDose`, `askStatus`, `answer`, `explain`, `setSharing`, `parsePrescription`, `confirmPrescription`, `checkStrip`, `checkPillbox`, `sendMessage`, `snooze`, `explainMedicine`, `dailyDigest`, `doctorReport`, `downloadMedia`, `ackAlert`, `flSubmit`.

Provider HTTPS routers: `voice/{start,gather,turn,status,incoming}`, `sms/incoming`. Internal handlers: `doseSweep`, `retryCall`, `escalate`, `alertCreated`, `dailyDigestScheduled`, `flAggregate`, `recordingCleanup`. Internal tasks/aggregation helpers are not public mobile APIs.

## Start, seed, authenticate, reset

Prerequisites: Node 22, Java 21+, Python with dependencies from `ml/requirements.txt` for ML reruns. From repository root:

```sh
cd backend/functions
npm ci
npm run build
npm test
npm run test:rules
npm run emulators
```

Second terminal, same directory:

```sh
export GCLOUD_PROJECT=demo-orma
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
npm run seed
npm run reset-demo                         # Asia/Kolkata today
npm run demo-token -- achan-uid            # local Auth Emulator custom token
```

Use `FirebaseAuth.signInWithCustomToken` against Auth Emulator to sign in. Tokens are local-only; do not commit/cache them in assets. Seeded UIDs: `achan-uid`, `amma-uid`, `anu`, `rahul`, `mini`, `farhan`. The first two own their member records; Anu/Rahul are supporters, Mini is assigned only Achan/Amma, Farhan is in `farhan-private`. Synthetic numbers have no call consent; the seed never grants live phone enrollment.

Loopback ports: Auth **9099**, Functions **5001**, Firestore **8080**, Storage **9199**, UI **4000**. Android Emulator host is `10.0.2.2`; USB Pixel can use `adb reverse tcp:PORT tcp:PORT` for the four service ports, then connect clients to `127.0.0.1`. Configure all four Firebase emulators **before first SDK use**, and Functions region `asia-south1`. Emulator FirebaseOptions must identify `demo-orma`; there is no production `google-services.json` supplied. H2 must register `in.orma` and the certificate fingerprints from the app handoff for real Auth/App Check.

## Android model reconciliation needed

The pulled app intentionally uses a local stub. `FirebaseCallableTransport` is unbound; do not switch DI before mapping the real wire format.

| Current Android local model | Backend contract |
|---|---|
| `Understanding.memberIds`, `countTaken`, `question` | `members`, nullable `count`, `clarifyQuestion`; preserve the full schema including `memberActions` and sharing proposals |
| `LogRequest` without family | Include `familyId`, member/date/slot; `by` must match signed-in UID if supplied |
| Flat evidence spans + top-level transcript | `evidence:[{snippet:transcript,spans:[{field,span}]}]`; server stamps source/actor/time |
| Status reply object | `askStatus`/`answer` return top-level `textEn,textMl,sentences,status,sources,answerId`; `logDose` returns nested `reply` |
| Every record has counts/source/evidence | Supporter status-only projections deliberately omit these; don't replace missing data with invented counts |
| ISO-string `at` | Firestore records use Timestamp; convert via SDK. Callable fact excerpts use serialized values |

Use `{familyId,memberId,date,slot}` for a resolved status lookup. An unresolved question returns `needsClarification`, not a guessed dose. Group logging is one authorized call per member; retain partial successes. Unknown means wait/contact supporter, never missed or permission to take another dose. A pillbox photo corroborates an existing report only; no image independently proves ingestion.

## Live listeners and private media

Canonical member: `families/{familyId}/members/{memberId}`; schedule `schedule/{slot}`; doses `doses/{YYYY-MM-DD_slot}`. Only the member owner reads canonical health documents. Supporters/nurses use `families/{familyId}/views/{uid}/members/{memberId}` and its `doses`, `alerts`, and explicitly shared optional subcollections. Membership is `families/{familyId}/access/{uid}`. Use per-member listeners or constrained member-ID queries; an unrestricted family query is not an authorization bypass. See `contracts/schema.md` and `backend/README.md` for exact allowed fields.

`setSharing` deletes the member's viewer projections; subsequent log/status queries rebuild safe dose views. Clear revoked client caches. Generated answers/digests/reports/messages are version-gated. Owner-authored messages addressed directly to a recipient can be read only by that authorized recipient at the current sharing version, even with global message sharing off.

Owner uploads are immutable `families/{familyId}/members/{memberId}/uploads/{filename}`, ≤10 MiB, JPEG/PNG/WebP or supported audio including OGG. All media inputs must be `gs://` URLs in the configured bucket and member upload namespace. Supporter/nurse direct uploads remain disabled. For derived `gs://` media use `downloadMedia({gsUrl})` → `{bytesBase64,mimeType}` (≤6 MiB); direct report/audio Storage reads and public download tokens are forbidden. Authorization is checked again on each download. Call audio URLs expire within 30 seconds but cannot revoke bytes already downloaded.

## FCM, telephony and FL enrollment

Client writes to access/device/phone binding collections are denied. H2 must enroll trusted test devices via Admin SDK, not loosen rules. FCM registration is currently an **admin enrollment contract**, not a public device-registration callable: `devices/{id}` needs `uid`, `active:true`, `familyId`, `memberIds[]`, `fcmToken`; the caller must have current access. Add only authorized members, and rotate/remove tokens on sign-out. Pushes contain a generic inbox signal; fetch clinical content under current rules.

Telephony additionally needs current member consent, verified trial number, quiet hours and `phoneBindings/{sha256(E164)}` with `verified:true,calls:true,sms:true,familyId,memberId,deviceId`, matching member phone/device arrays. `placeConsentCall` is trusted admin-only tooling, not a mobile callable. Caregiver SMS bindings instead identify `uid` and require access `phone,smsConsent:true`. No paid calls were placed by tests.

FL requires a bound T1 device with `ownerUid`/`registeredUid`, all member reverse bindings and FL consent, 11 finite clipped/noised deltas, current model version and K≥5 distinct eligible clients. The default synthetic device fixture deliberately lacks trusted ownership enrollment. Four simulated updates are available only through trusted tooling and are explicitly labelled. Simulator output is not a live round.

## Evidence and remaining acceptance

- Node 22 build; backend/provider/security/unit tests; real Auth/Firestore/Storage emulator rules tests. `rules.integration.test.ts` exercises real concurrent duplicate/cross-slot stock transactions, idempotent prescription confirmation and one-time FL aggregation. Test output totals are recorded in `STATUS.md`.
- Model/chart/metrics in `ml/out/`; reproduction and eight ML checks in `ml/README.md`. Synthetic FL did **not** beat local-only training; no clinical or formal differential-privacy claim.
- Live vs mocked: transactions/rules above ran locally against emulators. Gemini/OpenAI/vision/TTS/Twilio/FCM tests use mocks. No real Firebase deployment, Pixel listener, OTP, audio clip, handwriting sample, call, delivered push or native-language review is claimed.
- Limits: Malayalam PDF explicitly rejected because PDFKit/fontkit failed real shaping tests; English report marks unsupported text omissions. Arbitrary message translations preserve originals; only reviewed phrase translations are accepted. Historical adherence uses labelled current-schedule opportunities, not reconstructed historical prescriptions. Some prompts fall back explicitly to English when Malayalam audio is unavailable. Generic notification redelivery is possible after a provider-acceptance/server-crash boundary.
- H2 setup and exact secret/env/IAM checklist: `backend/DEPLOYMENT.md`. C0 acknowledgement and C1–C3 device/provider tests in the app checklist remain open. Do not mark all A2 acceptance complete on the basis of endpoint exports alone.
