# API contract v1

Region `asia-south1`. Callable examples below are **data payloads**, without Firebase callable transport wrappers. Require Auth + App Check outside emulators, validate all inputs, reject unknown cross-family IDs. Errors use callable codes `unauthenticated`, `permission-denied`, `invalid-argument`, `not-found`, `failed-precondition`, `resource-exhausted`, `unavailable`; never return raw model/provider errors. No endpoint accepts a client-provided role as authority. `familyId` is mandatory for all family/member scoped calls, even if omitted in the plan's shorthand. `answer` is an alias of `askStatus`, not a second implementation.

All examples use 2026-11-07, Asia/Kolkata. Viewer-specific counts/sources may be absent when not shared. `textMl` and `textEn` are required for user-facing replies. Generated `sentences` have nonempty citations checked against the same viewer's fact pack; deterministic fallback may use `sentences:[]`. Every factual number/time/name must match its cited record in **both** translations; dropping everything produces a safe template, never a guess. Sources cannot be fetched by arbitrary path. Synthetic URL placeholders below are private authorized resources, not publicly readable Storage URLs.

## understand — G1 input / voice sharing

Exactly one of transcript or audioBase64; audio requires mimeType (audio/aac or audio/ogg), <=15 seconds and <=1 MiB decoded. Client time/zone are context, not audit authority. Device binding and all member IDs checked. Returns the complete `understand.schema.json` object. `count:null` means not spoken, not zero. Empty medicines means unspecified. A single bound member, explicit selected slot or active dose check-in may supply context without an evidence span. Every **inferred from speech** field must have a verified exact, case-sensitive substring span; missing required identity/slot/count context triggers clarification. Never infer identity on a shared device from “I”. All group members require individual authorization. Different per-member actions must use memberActions: `taken:false` never logs a dose. Understood intent is a proposal, never a database mutation. Null sharing values mean unchanged; broad “hide details” sets all five optional categories false for that supporter, never hides minimum dose status. A supporter speaking a sharing command cannot authorize it.

```json
{"request":{"familyId":"demo-family","deviceId":"home-phone","memberIds":["achan","amma"],"transcript":"Njangal randuperum raavile marunnu kazhichu","clientTime":"2026-11-07T02:45:00Z","tz":"Asia/Kolkata"},"response":{"transcript":"Njangal randuperum raavile marunnu kazhichu","intent":"log","members":["achan","amma"],"slot":"morning","count":null,"medicines":[],"snoozeReason":null,"messageTo":null,"messageText":null,"urgency":"normal","needsClarification":false,"clarifyQuestion":null,"evidence":[{"field":"members","span":"randuperum"},{"field":"slot","span":"raavile"},{"field":"intent","span":"kazhichu"}],"sharingChanges":null,"memberActions":[]}}
```

An unclear result sets `needsClarification:true`, nonempty `clarifyQuestion` and performs no action. Schema valid does not mean evidence/authorization valid. Provider adapters may simplify the JSON Schema for structured output, but must validate the full returned shape and semantics server-side.

## logDose — transaction and double-dose guard

Owner, active supporter or assigned nurse can log. `by` must match caller; telephony uses trusted server actor. `source:voice|tap|notification|widget|call|photo|nurse|family`. `date`, `slot`, `countTaken` and `medicinesTaken` required. Count must not exceed prescribed count without explicit error/escalation; cannot add an unprescribed medicine. If no count spoken and user explicitly confirms the full slot, caller uses confirmed schedule total, not AI-invented count. Ambiguous partial medicine identity requires clarification before stock mutation. Group logging is one authorized call per member; show each outcome, don't claim cross-member atomicity.

```json
{"request":{"familyId":"demo-family","memberId":"achan","date":"2026-11-07","slot":"morning","countTaken":3,"medicinesTaken":["achan-bp","achan-vitamin"],"source":"voice","by":"achan-uid","evidence":[{"type":"voice","at":"2026-11-07T02:45:00Z","by":"achan-uid","snippet":"Raavile 3 gulika kazhichu","spans":[{"field":"count","span":"3"}]}]},"response":{"result":"logged","status":"confirmed","reply":{"templateId":"confirmed_count","vars":{"n":3,"time":"08:15"},"textMl":"08:15-ന് 3 ഗുളിക കഴിച്ചതായി രേഖയുണ്ട്. വീണ്ടും കഴിക്കരുത്.","textEn":"You reported taking 3 tablets at 08:15. Do not take them again."}}}
```

`result:logged|partial|duplicate_blocked`. Nurse/family full log yields reported; smaller count yields partial. Existing confirmed/reported/partial ⇒ duplicate_blocked, no stock decrement, append attempted-log audit and double alert; status remains existing status. Retry same dose cannot create a second dose ID. Server validates evidence and stamps actor/time. Photo evidence is an observation, not proof of ingestion.

## askStatus / answer — G3

Accept either `{date,slot}` or `question`; unresolved question slot asks clarification rather than choosing silently. Pending only if not yet due; no confirmed facts after due ⇒ Unknown + wait/escalate.

```json
{"request":{"familyId":"demo-family","memberId":"achan","date":"2026-11-07","slot":"morning"},"response":{"status":"confirmed","sentences":[{"text":"You reported taking your medicine at 08:15.","cites":["D1"]}],"fallbackUsed":false,"textMl":"08:15-ന് മരുന്ന് കഴിച്ചതായി നിങ്ങൾ അറിയിച്ചു.","textEn":"You reported taking your medicine at 08:15."}}
```

```json
{"request":{"familyId":"demo-family","memberId":"amma","question":"Did I take my night tablet?"},"response":{"status":"unknown","sentences":[],"fallbackUsed":true,"textMl":"ഉറപ്പില്ല. വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് കാത്തിരിക്കുക. അനുവിനോട് വിളിക്കാൻ പറയാം.","textEn":"I am not sure. Please wait before taking another. I am asking Anu to call you."}}
```

## parsePrescription — G2 draft only

Lead/supporter or independent owner; assigned nurse may submit draft but never confirm schedule. photoUrl must resolve to a caller-authorized family/member upload, not arbitrary HTTP/SSRF. Same restriction for all image/audio endpoints. Confidence <0.8 flagged for review; no automatic acceptance.

```json
{"request":{"familyId":"demo-family","memberId":"achan","photoUrl":"gs://demo-private/demo-family/achan/rx.jpg"},"response":{"prescriptionId":"rx1","lines":[{"lineId":"l1","medicine":"Amlodipine","strength":"5 mg","dose":"1 tablet","frequency":"1-0-0","food":"after","duration":"30 days","confidence":0.94,"bbox":[0.1,0.2,0.8,0.3]}]}}
```

## confirmPrescription — G2 human confirmation

Every extracted line must appear once with accepted true/false; accepted fields explicitly corrected/confirmed by human. Requires existing draft and matching member/family; re-confirm idempotent, not duplicate stock. Supporters authorized to manage schedule, independent owner only (assisted member/nurse cannot edit). All accepted entries require complete timing/count/stock. Atomic schedule update, audit reviewer. Never silently delete unrelated existing medicines; conflict with existing slot returns failed-precondition for human resolution.

```json
{"request":{"familyId":"demo-family","memberId":"achan","prescriptionId":"rx1","lines":[{"lineId":"l1","accepted":true,"medicine":"Amlodipine","strength":"5 mg","dose":"1 tablet","frequency":"1-0-0","food":"after","duration":"30 days","medicineId":"achan-bp","count":1,"stock":30,"slots":[{"slot":"morning","time":"08:00"}]}]},"response":{"prescriptionId":"rx1","status":"confirmed","scheduleSlots":["morning"]}}
```

## checkStrip — G6 schedule-only matching

Do not identify unknown medicines from model knowledge. Require name+strength match against this member's confirmed schedule; ambiguous match is null. No ingestion log or schedule mutation.

```json
{"request":{"familyId":"demo-family","memberId":"achan","photoUrl":"gs://demo-private/demo-family/achan/strip.jpg"},"response":{"matchedMedicineId":"achan-bp","readName":"Amlodipine","readStrength":"5 mg","confidence":0.96,"sentences":[{"text":"This matches Amlodipine on your confirmed list.","cites":["S1"]}],"textMl":"ഇത് നിങ്ങളുടെ സ്ഥിരീകരിച്ച പട്ടികയിലെ Amlodipine-യുമായി പൊരുത്തപ്പെടുന്നു.","textEn":"This matches Amlodipine on your confirmed list."}}
```

No match: `matchedMedicineId:null`, `sentences:[]`, deterministic strip_no_match text; never a general medical description.

## checkPillbox — photo observation

Require member-local date and slot to avoid verifying another day's compartment. Empty compartment alone cannot prove swallowed medicine. Can attach photo evidence to existing self-report; cannot create confirmed ingestion from an empty image alone. This deliberately limits the plan's “photo-verified” badge to **photo-observed** corroboration, not a clinical guarantee. `slotEmpty` is true/false/"uncertain".

```json
{"request":{"familyId":"demo-family","memberId":"amma","date":"2026-11-07","slot":"morning","photoUrl":"gs://demo-private/demo-family/amma/box.jpg"},"response":{"slotEmpty":true,"status":"confirmed","photoObserved":true,"textMl":"ഫോട്ടോയിൽ ഈ ഭാഗം ഒഴിഞ്ഞതായി തോന്നുന്നു. മരുന്ന് കഴിച്ചതിന്റെ ഉറപ്പല്ല ഇത്.","textEn":"The compartment appears empty. This does not prove the medicine was swallowed."}}
```

## dailyDigest — G4 callable + scheduled

Callable generates only caller's permitted view (owner may request own view). Scheduled function at member-local 20:00 generates separate viewer/language documents for each authorized supporter, not one shared all-fields digest. Optional private fields excluded before generation; shared askedTwice text requires explicit opt-in source, never FL telemetry ingestion.

```json
{"request":{"familyId":"demo-family","memberId":"amma","date":"2026-11-07","language":"en"},"response":{"digestId":"2026-11-07_anu","sentences":[{"text":"Amma reported her morning dose taken.","cites":["D2"]}],"audioUrl":"gs://demo-private/views/anu/digest.mp3","textMl":"അമ്മ രാവിലത്തെ മരുന്ന് കഴിച്ചതായി അറിയിച്ചു.","textEn":"Amma reported her morning dose taken."}}
```

## doctorReport — G5

Inclusive range max 90 days; owner or authorized supporter can export only what they may view. Per-medicine adherence requires counts/medicine access; omit sections otherwise. Percent denominator is eligible scheduled opportunities, explicitly distinguish Unknown/partial from missed. Include sources and provenance; no diagnosis or treatment suggestions. Export private, viewer-scoped, revocable for future reads.

```json
{"request":{"familyId":"demo-family","memberId":"amma","from":"2026-10-08","to":"2026-11-06","language":"en"},"response":{"reportId":"report1","pdfUrl":"gs://demo-private/views/anu/report1.pdf","sections":[{"title":"Dose records","sentences":[{"text":"The morning dose on 6 November was reported taken.","cites":["D3"]}]}],"textMl":"ഡോക്ടറെ കാണാനുള്ള സംഗ്രഹം തയ്യാറായി.","textEn":"Your doctor-visit summary is ready."}}
```

## setSharing — owner or recorded guardian only

`changes` accepts any subset of five optional booleans plus optional `supporterId` (omit = family-wide defaults). `doseStatus:false` rejected. Unknown keys rejected. Per-supporter override can restrict or grant optional access only with owner's explicit command. Sharing doesn't grant membership. Confirmation from authenticated owner required for a voice-proposed change; no voice identification. Assisted shared-phone owner context requires explicit authenticated account selection; caregiver token cannot impersonate elder consent. Revoke optional projections/media before success, audit old/new settings without exposing them to other supporters.

```json
{"request":{"familyId":"demo-family","memberId":"amma","changes":{"supporterId":"rahul","counts":false,"messages":false,"risk":false,"askedTwice":false,"nurseNotes":false}},"response":{"saved":true,"sharing":{"doseStatus":true,"counts":false,"messages":false,"risk":false,"askedTwice":false,"nurseNotes":false},"textMl":"നിങ്ങളുടെ പങ്കിടൽ ക്രമീകരണം മാറ്റി.","textEn":"Your sharing settings were updated."}}
```

## explain — evidence, alert rule, prediction

`kind:status|alert|risk`; alert requires alertId, other kinds date/slot. Only currently visible facts; status-only viewers get safe status explanation, no hidden transcript/count/source. Risk denied if unshared. `reasons` is an array of `{text,cites[]}`. Server risk explanations use probability/level and coarse nonsensitive reasons only; exact private contribution bars are computed on-device, since delta with public weights could reveal raw telemetry.

```json
{"request":{"familyId":"demo-family","memberId":"achan","date":"2026-11-07","slot":"morning","kind":"status"},"response":{"reasons":[{"text":"At 08:15, you reported taking the dose.","cites":["D1"]}],"textMl":"08:15-ന് നിങ്ങൾ മരുന്ന് കഴിച്ചതായി അറിയിച്ചു.","textEn":"At 08:15, you reported taking the dose."}}
```

## snooze

`reason:not_eaten|not_home|later`. Owner/authorized helper; no dose status mutation. not_eaten uses confirmed usual meal time for after-food medicines; if already passed/missing use +30 min, never suggest changing prescribed timing for time-critical medicines. Others +30 min. Don't snooze an already recorded dose.

```json
{"request":{"familyId":"demo-family","memberId":"amma","date":"2026-11-07","slot":"noon","reason":"not_eaten"},"response":{"remindAt":"2026-11-07T07:30:00Z","textMl":"13:00-ന് വീണ്ടും ഓർമ്മിപ്പിക്കാം.","textEn":"I will remind you again at 13:00."}}
```

## sendMessage

`fromId` must belong to caller; `to` is member/supporter/nurse ID or onDuty. Resolve only active authorized recipients, nurse assignments and message sharing. Sender may explicitly authorize delivery of their own message without enabling everyone else's access. Urgent words trigger urgent routing even if model unavailable, with 108/not-emergency-service template. Retained message audio requires consent/private Storage. Translate without adding clinical facts.

```json
{"request":{"familyId":"demo-family","memberId":"amma","fromId":"amma","to":"mini","text":"Enikku thalavedana undu"},"response":{"messageId":"msg1","urgency":"normal","textMl":"മിനിക്ക് സന്ദേശം അയച്ചു.","textEn":"Your message was sent to Mini."}}
```

## explainMedicine

Only confirmed entered purpose/ifUnsure data. Multiple matches ⇒ clarify, missing purpose ⇒ found false, never fill from medical knowledge.

```json
{"request":{"familyId":"demo-family","memberId":"achan","medicineHint":"BP"},"response":{"found":true,"reply":{"templateId":"medicine_known","vars":{"medicine":"Amlodipine","purpose":"blood pressure"},"textMl":"നിങ്ങൾ സ്ഥിരീകരിച്ച രേഖയിൽ Amlodipine: രക്തസമ്മർദ്ദത്തിന്.","textEn":"Your confirmed record says Amlodipine: blood pressure."}}}
```

## flSubmit

Authenticated consented eligible T1 device; server derives family/consent and private round pseudonym from verified binding, not payload identity. No raw features. All constraints in risk-features.md.

```json
{"request":{"deviceId":"home-phone","modelVersion":"v0","delta":[0.01,0,0,0,0,0,0,0,0,0,0],"n":30},"response":{"accepted":true,"round":1}}
```

## Internal scheduled / task functions

These are **not public callables**. Scheduler/Cloud Tasks verified service identity; manual invocation only trusted admin tooling. Task redelivery must be idempotent. Counters below are diagnostic return values, not mobile API dependencies.

### doseSweep — every minute
```json
{"request":{"now":"2026-11-07T02:30:00Z"},"response":{"checked":5,"notificationsQueued":2,"callsQueued":1}}
```
Resolve member-local due times, skip confirmed/reported/partial, require call consent, quiet hours, verified trial numbers. Deterministic per-dose attempt task keys prevent duplicate calls.

### retryCall — task +15/+30 minutes
```json
{"request":{"familyId":"demo-family","memberId":"ammoomma","date":"2026-11-07","slot":"morning","attempt":2},"response":{"action":"call_queued"}}
```
Attempt 1 initial, 2 +15, 3 +30; re-read dose/consent before calling. After three unanswered attempts mark Unknown and escalate. `action:call_queued|skipped|escalated`.

### escalate — on-duty, then nurse, then all supporters
```json
{"request":{"familyId":"demo-family","memberId":"amma","alertId":"alert1","step":1},"response":{"sentTo":["anu"],"nextStepAt":"2026-11-07T03:05:00Z"}}
```
Stop if acknowledged; wait five minutes per step. First active on-duty supporter, then assigned on-shift nurse, then all active supporters. Urgent bypasses waiting and alerts all on duty. Filter alert payload per recipient.

### flAggregate — scheduled / trusted manual admin
```json
{"request":{"round":1},"response":{"aggregated":false,"clients":4,"requiredClients":5}}
```
At K>=5 return `{"aggregated":true,"clients":5,"modelVersion":"v1"}`; transaction/CAS ensures each update counted once and round base version unchanged.

## Signed provider HTTPS endpoints — G1

POST form-urlencoded, not callable JSON. Examples represent parsed form and query objects; responses are XML TwiML, except status callbacks acknowledge empty 204. Validate provider signature over exact external URL/form before reading session state. Never fetch arbitrary RecordingUrl: authenticated provider-host allowlist + bound recording SID. CallSid binds server session; caller number alone insufficient. No public endpoint accepts an arbitrary familyId/memberId to trigger calls. Do not return facts in error responses. All XML escaped. `call1` is a server call-session ID in the signed callback URL.

### /voice/start
```json
{"request":{"query":{"callId":"call1"},"form":{"CallSid":"CA_DEMO","From":"+15005550006","To":"+919000000003"}},"response":"<Response><Play>https://example.invalid/call-greeting.mp3</Play><Record action=\"/voice/turn?callId=call1\" maxLength=\"8\" timeout=\"2\"/></Response>"}
```
Consent flow instead plays consent prompt and Gather numDigits=1 timeout=10 to /voice/gather; no reminder schedule until consent. Trial preamble happens before Orma prompts. “Shari” filler may play while next turn prepares; provider timeout ⇒ deterministic menu.

### /voice/turn
```json
{"request":{"query":{"callId":"call1"},"form":{"CallSid":"CA_DEMO","RecordingSid":"RE_DEMO","RecordingUrl":"https://api.twilio.com/demo-recording","RecordingDuration":"4"}},"response":"<Response><Play>https://example.invalid/reply.mp3</Play><Record action=\"/voice/turn?callId=call1\" maxLength=\"8\" timeout=\"2\"/></Response>"}
```
Authenticated audio → understand → safe action → grounded reply → authorized temporary audio. After two unclear/silent turns return keypad Gather instead; four-second target isn't a correctness guarantee. Replayed recording callback must not mutate twice.

### /voice/gather
```json
{"request":{"query":{"callId":"call1"},"form":{"CallSid":"CA_DEMO","Digits":"1"}},"response":"<Response><Gather numDigits=\"1\" timeout=\"10\" action=\"/voice/gather?callId=call1\"><Play>https://example.invalid/count-prompt.mp3</Play></Gather></Response>"}
```
Session states distinguish menu, consent and count: 1 taken → ask count then log, 2 not yet → retry, 3 record message, 4 explainMedicine from confirmed list, 9 repeat. Callback menu: 1 log now, 2 ask status, 3 message, 4 explain; never reuse menu mapping without session state. Number keys say twice, wait ten seconds.

### /voice/status
```json
{"request":{"query":{"callId":"call1"},"form":{"CallSid":"CA_DEMO","CallStatus":"no-answer"}},"response":{"httpStatus":204}}
```
Retry only unanswered/failed eligible sessions; completed does not itself imply taken. Dedupe status updates and do not let out-of-order statuses undo a terminal state.

### /voice/incoming
```json
{"request":{"form":{"CallSid":"CA_INCOMING","From":"+919000000003","To":"+15005550006"}},"response":"<Response><Reject reason=\"rejected\"/></Response>"}
```
Verified known binding plus prior call consent ⇒ enqueue callback once, reject before answering. Unknown caller rejected without revealing membership; throttle callback abuse.

### /sms/incoming
```json
{"request":{"form":{"MessageSid":"SM_DEMO","From":"+919000000003","To":"+15005550006","Body":"1"}},"response":"<Response><Message>Received. We will check your current dose record.</Message></Response>"}
```
Known consented binding, exactly one unambiguous due slot: 1 confirm full expected count, 2 not yet; ambiguous slot ⇒ request clarification/callback, no log. SMS has no secure user identity; explicit enrollment/binding and minimal replies required. Dedupe MessageSid. Do not leak medicine names/counts in generic SMS acknowledgements.

### Example citation records

Within these independent scenarios: D1 = Achan 2026-11-07 morning self-report at 08:15; D2 = Amma 2026-11-07 morning self-report; D3 = Amma 2026-11-06 morning self-report (decoded from seed); S1 = Achan's confirmed morning Amlodipine 5 mg schedule entry. Resolve only viewer-authorized excerpts through the version-gated derived record or authorized callable; no separate readable citations collection exists. D1 time is visible to the owner in askStatus/explain examples, not automatically to a status-only supporter.

Provider shapes checked via current Twilio docs in Context7: <https://www.twilio.com/docs/voice/twiml>. Media URLs in TwiML are synthetic invalid placeholders; replace with short-lived provider-fetchable audio, not a private gs:// URL. Never disclose clinical media through a public permanent URL.
