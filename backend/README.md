# Orma backend

Cloud Functions 2nd gen, TypeScript, **Node 22**, region **asia-south1**. `.firebaserc` deliberately names only `demo-orma`; it is not a deployable production project. No cloud resource has been provisioned or deployed.

## Local setup

Install Node 22 and Java 21+ (Firebase's Firestore/Storage emulators require Java), then:

```sh
cd backend/functions
npm ci
npm run build
npm test
npm run test:rules
npm run emulators
```

Emulators listen only on loopback: Auth 9099, Functions 5001, Firestore 8080, Storage 9199, UI 4000. For an Android emulator use `10.0.2.2` as the client host; for a physical phone use `adb reverse` rather than exposing unauthenticated emulators to a network. Functions callables use `asia-south1`.

In a second terminal, from `backend/functions`:

```sh
export GCLOUD_PROJECT=demo-orma
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
npm run seed
npm run reset-demo -- --date=2026-11-07
```

Both commands refuse non-loopback endpoints, missing emulator variables, or any project other than `demo-orma`. `seed` upserts the synthetic contract fixture; `reset-demo` first removes only its family namespaces (including projections), their calls/alerts, and its device bindings. It does not wipe unrelated families, Auth users, Storage objects or arbitrary FL rounds. `--date` defaults to today's **Asia/Kolkata** date; the 30-day history shifts relative to it. Schedule times remain 07:00/08:00/13:00/20:00 local, so choose a corresponding demo time; no fake history for today is inserted. Historical records do not decrement the fixture's current stock a second time. All seeded call consent is false, so placeholder numbers are never authorized for calls.

The fixture supplies the Auth UIDs (`achan-uid`, `amma-uid`, `anu`, `rahul`, `mini`, `farhan`), membership, schedules, sharing overrides, viewer projections and initial model. Users have display names but no password/phone credentials. Emulator clients/tests can use a trusted local custom-token bootstrap; do not add production authentication bypasses. Independent Farhan has a separate family namespace. The seed uses current snapshot stock; medicine data is fictional, not prescribing advice.

## Authorization / integration

`src/platform/firebase.ts` exports singleton `app`, `db`.
`src/platform/auth.ts` exports:

* `requireAuth(request): uid` — rejects unauthenticated callers.
* `documentId(value, name)` — rejects missing/slashed IDs.
* `resolveMemberAccess(uid, familyId, memberId)` — verifies active `access/{uid}` membership plus owner/supporter/assigned-nurse or recorded-guardian authority. Returns `{uid,familyId,memberId,memberRef,member,access,sharing,isOwner,isGuardian,isNurse,isSupporter}`. It **does not** grant access to every canonical field; use `sharingAllowed(context, field)` when building fact packs/projections for nonowners.
* `sharingAllowed(context, counts|messages|risk|askedTwice|nurseNotes)` — member ownership bypasses optional sharing; other callers use per-supporter override then global default. Guardian authority manages consent, not an automatic health-data read bypass.

The entry point exports `understand`, `logDose`, `askStatus`, `answer`, `explain`, and `setSharing`. Production callables require App Check. Sharing input is `{familyId,memberId,changes:{supporterId?,counts?,messages?,risk?,askedTwice?,nurseNotes?}}`. Only the member or an already-recorded guardian with nonempty capacity note can call it; neither supporters nor clients can appoint guardians. It increments `settings/sharing.version`, then synchronously deletes the member's viewer projection trees before acknowledging. `askStatus` and `logDose` repopulate safe status views on subsequent use. Deleted content already downloaded to a client cannot be recalled; clear revoked client caches too.

`askStatus`/`answer` currently require explicit `date` and `slot`; resolve question-only requests through `understand` and ask for clarification when ambiguous. Replies use conservative, bilingual fact templates. The optional grounded generator hook is not connected to live Gemini wording. Telephony, vision, messaging, summaries/reports and live FL aggregation contracts are authored but their endpoints are not implemented in this checkpoint.

Canonical member roots and health subcollections are owner-only client reads, all writes server-only. Nurses/supporters read `families/{familyId}/views/{theirUid}/members/{memberId}` with current active membership and nurse assignment. Server code is trusted and must sanitize everything it publishes:

| Projection | Allowed shape / gate |
|---|---|
| Member root | `{name,mode}` only |
| `doses/{date_slot}` | `{date,slot,status}` only by default; counts-enabled adds only `countTaken,countExpected,medicinesTaken` |
| `alerts/{id}` | `{type,rule,date,slot,at}` only; no count/transcript in text |
| `schedule/{slot}` | `counts` sharing |
| `messages/{id}` | `messages` sharing |
| `risk/{id}` | `risk` sharing; never publish raw private features |
| `notes/{id}` | `nurseNotes` sharing |
| `answers`, `digests`, `reports` | `sharingVersion` must equal current settings version (default 0); generation must use viewer-filtered facts |

Do not add `sharingVersion`, evidence, source snippets, or arbitrary extra fields to dose projections: the rules intentionally deny the entire read. Firestore cannot redact individual fields. Removing membership/assignment immediately blocks stale projections. Model reads require Auth; `flUpdates`, devices/calls/global alerts and all mutations remain server-only.

Storage accepts only new owner uploads at `families/{familyId}/members/{memberId}/uploads/{filename}` (JPEG/PNG/WebP or supported audio, ≤10 MiB). It denies updates/deletes and **all direct export/report/audio reads**; a future download callable must reauthorize current sharing before streaming. Do not issue persistent download tokens/public URLs. Supporter/nurse upload flows are not enabled by these rules.

## Cloud setup is a human checkpoint

Select an actual Firebase project explicitly, provision Firestore/Storage in Mumbai, enable billing/budget alerts, Auth phone sign-in, APIs and Secret Manager, and configure App Check before deploying. Never replace the demo placeholder with credentials. `firebase.json` includes a small Remote Config tier/FL template under `backend/scripts`; Remote Config has no local emulator. Model/provider configuration and cloud deployment are separate integration work.

## Verification / limitations

Rules tests start Auth + Firestore + Storage and cover whole-document privacy, optional-count gating, current assignment, revoked generated content, server-only writes, owner uploads, member/guardian-only sharing, guarded seed/date/reset behavior. The loader is not a production migration tool. No live Firebase project, phone OTP, physical device, deployment, provider call, or Remote Config fetch was tested here.

Dependency install currently reports transitive advisories in Firebase SDK/CLI trees; do not apply forced major/downgrade audit fixes blindly. Vitest is pinned to a patched major to avoid critical worker-pool advisories. Review remaining advisories and cloud App Check/quotas before production.
