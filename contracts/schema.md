# Shared data contract v1

All examples are synthetic. Dates are member-local `YYYY-MM-DD`, slots are `morning|noon|night`, times are `HH:mm`, instants are RFC3339 UTC strings on the wire (Firestore Timestamp in storage). Default zone: `Asia/Kolkata`. IDs are opaque strings; dose ID is exactly `{date}_{slot}`. Counts are nonnegative integers. Missing optional fields are omitted, not invented. Status is `confirmed|reported|partial|pending|unknown`; `missed` is a derived overdue outcome, not evidence of ingestion. `confirmed` means self-reported, not clinically proven.

## Identity and authorization

Every member-scoped callable requires `familyId` and `memberId`; `understand` requires `familyId`, `deviceId`, `memberIds`. Never infer a family by searching globally for a member ID. Resolve the family from the explicit request and verify the authenticated UID's active membership and member access. A device is bound to exactly one family and its member IDs must be a subset of that binding. Client `by`, `fromId`, roles, consent and device bindings cannot grant authority: validate them and use authenticated identity for audit. Keypad members have no Auth account; signed provider callbacks resolve a server-created call/verified phone binding to family/member. A bare phone number or webhook query argument is not authorization.

`families/{familyId}`: `{name, ownerId, timezone, roster:[{memberId,role,days,from,to}]}`. `ownerId` is lead supporter UID, not owner of every member's health data. Membership is `families/{familyId}/access/{uid}`: `{roles:[member|leadSupporter|supporter|nurse], memberIds:[], active:true}`; only trusted onboarding/admin writes it. Nurse assignments must also match `nurseIds` on the member. Independent Farhan has his own private family namespace, not a node in Anu's family.

## Canonical records (private)

Under `families/{familyId}/members/{memberId}`:

| Document/subcollection | Fields |
|---|---|
| member root | `name, ownerUid?, roles[], mode:assisted|independent|keypad, tier:T1|T2|T3|T4, accessibility:{vision,hearing,speech,motor,memory}, language:ml|en, phone?, deviceIds[], nurseIds[], consent:{calls,fl,at}, usualMealTimes:{breakfast,lunch,dinner}` |
| `schedule/{slot}` | `slot,time,afterFood,medicines:[{id,name,strength,dose,count,stock,purpose?,ifUnsure?}]` (only confirmed entries) |
| `doses/{date_slot}` | `date,slot,status,countTaken,countExpected,medicinesTaken[],source,by,at,attempts,evidence[]` |
| `risk/{date_slot}` | `p,level:low|med|high,modelVersion,reasons[]`; only publish with risk consent. Full `{baselineLogit,contributions:[{feature,value,delta}]}` stays on-device: delta and public weights can also reveal a private value, so stripping just `value` is insufficient |
| `messages/{id}` | `from,to[],audioUrl?,text,translated:{ml?,en?},urgency:normal|urgent,readAt?` |
| `settings/sharing` | `doseStatus:true,counts:false,messages:false,risk:false,askedTwice:false,nurseNotes:false,perSupporter:{uid:{optional overrides}},revision:integer,guardianId?,capacityNote?` |
| `prescriptions/{id}` | `photoUrl,extractedLines[],confirmedBy?,confirmedAt?,status:draft|confirmed` |
| `answers/{id}` | `question,factPackIds[],sentences[],fallbackUsed,at,viewerUid` |
| `digests/{date_viewerUid}` | `date,viewerUid,sentences[],audioUrl?,language,sentTo[]` |
| `reports/{id}` | `viewerUid,range:{from,to},sections:[{title,sentences[]}],pdfUrl?` |
| `notes/{id}` | `by,at,text,vitals?` |

Evidence is `{type:voice|tap|notification|widget|call|photo|nurse|family|checkin,at,by,snippet?,spans?:[{field,span}],digits?}`. Server stamps `at/by`. Attempts include failed check-ins; never turn absence of response into taken. Append provenance, never silently replace it. Transactions block a second log against confirmed/reported/partial; partial completion/correction needs a separate explicit audited workflow (not another `logDose`). Stock decrements once for actual medicines recorded; never guess which medicine a partial count represents. Optional audited `outcome:missed` is distinct from Unknown and needs `outcomeAudit:{by,reason}`. Stock is canonical per medicine ID even when that ID occurs in multiple slots; update all schedule snapshots consistently within the transaction, never maintain divergent independent stocks.

## Sharing without field leakage

Firestore reads return whole documents, so **do not put private counts, evidence, messages, risk or notes in a supporter-readable dose/member document**. Canonical health documents are owner/server-only. The guardian can manage consent only with a recorded capacity note; supporters cannot appoint themselves. Nurses and supporters read server-built projections, not canonical documents.

`families/{familyId}/views/{viewerUid}/members/{memberId}` contains safe display `{name,mode}` and subcollections `doses`, `alerts`, `schedule`, `messages`, `risk`, `notes`, `answers`, `digests`, `reports` with only permitted fields. Base dose projection: `{date,slot,status}`. Optional counts add `countTaken,countExpected,medicinesTaken`; optional risk adds only probability/level and approved coarse reasons, never private raw features. Schedule projection exposes only what the viewer is authorized to manage/read; a status-only supporter gets no medicine/stock details. Double-dose alerts remain shared but carry only `{type,rule,date,slot,at}` without transcript/count leakage. Recipient addressing does not make message bodies globally shared. Nurses see only active assigned members and only permitted content. Evidence snippets are not part of default status sharing.

Only the server writes projections. Security rules require `request.auth.uid == viewerUid` and current active membership/assignment; removal revokes access even to stale projections. Every projection document, including doses with optional fields, carries `sharingRevision` matching the member's current `settings/sharing.revision`; deny the entire stale document, not individual fields. `setSharing` atomically increments revision, invalidates old media access, then rebuilds safe projections before acknowledging. A revision mismatch fails closed while refresh runs. Cached copies already downloaded cannot be recalled: UI clears revoked caches, but no false promise of retroactive erasure. Recheck permissions at PDF/audio download; private Storage paths and short-lived access, never public bearer URLs. Fact packs, citations, answers and summary media are viewer-specific and filtered **before** generation. Citation resolution cannot bypass the same access checks. Safe source excerpts are stored as `views/{viewerUid}/members/{memberId}/citations/{recordId}` with the same revision gate; unshared canonical paths are never returned to clients.

## Global/server records

* `devices/{deviceId}`: `{familyId,memberIds[],tier,capabilities:{}}`; private bindings/tokens.
* `calls/{callId}`: `{familyId,memberId,date,slot,attempt,status,digits[],providerSid,consentAt?,unclearTurns}`; server-only. Provider recording deleted after processing unless explicitly retained as a message.
* `alerts/{id}`: `{familyId,memberId,type:missed|partial|double|unknown|stock|urgent|risk,rule,escalationStep,ackBy?,at}`; server-only; audience projections are filtered.
* `flModels/{version}`: see `risk-features.md`; authenticated model read, server-only write. `flModels/latest` contains the full latest model, not merely a pointer.
* `flUpdates/{round}/clients/{anonId}`: `{modelVersion,delta[],n,clipNorm,at}`; server-only read/write through callable. No family/member IDs, raw examples or behaviour fields. Pseudonymous updates are not guaranteed anonymous; secure aggregation/formal DP are not implemented.

## Shared value shapes

Reply: `{templateId,vars:{string:string|number},textMl,textEn,audioUrl?}`. Sentence: `{text,cites:[recordId]}` plus top-level bilingual `textMl,textEn`; both translations must be checked against the same facts. Deterministic safety templates are not generated factual sentences and may have empty `sentences` on insufficient evidence. Citation IDs are opaque allowlisted fact-pack IDs, resolved by an authorized lookup, not arbitrary Firestore paths.

Prescription line: `{lineId,medicine,strength,dose,frequency,food:before|after|any,duration,confidence,bbox:[xMin,yMin,xMax,yMax]}`. Coordinates normalized 0..1, top-left origin, xMin<xMax and yMin<yMax, confidence 0..1. Frequency uses `1-0-1` notation. Extraction is never a schedule until every accepted line is explicitly confirmed; uncertain lines require correction/pharmacist review.

## Demo seed mapping and checks

Run `python contracts/check.py` from the repository root. This validates JSON, example XML, current schema-keyword fixture shapes, bilingual placeholder parity, real evidence substrings, consecutive dates, unique dose IDs, feature order and contribution identity. It does not validate deployed API/rules behavior or Malayalam fluency.

`demo-family.json` is an intentionally compact seed, not an Admin SDK import dump. Merge each member with matching `people` entry (`name,roles,language`), retaining `ownerUid`; familyId/id are path selectors, not stored authority. Build `access/{uid}` from people roles: Anu/Rahul active supporters of demo-family, Mini only Achan/Amma, each member only self, Farhan only farhan-private. Install device bindings and sharing defaults plus explicit per-supporter overrides, revision 1. ISO roster days are Monday=1 through Sunday=7. **Do not seed real phone/Auth verification or call consent** from this file: placeholder keypad phone has calls=false.

History strings encode morning/noon/night with `historyEncoding`; `check.py:expand_history` is the reference decoder producing 240 records from 30 dates (2026-10-08..2026-11-06). '-' creates no record. R is a nurse report; P is Amma's 2-of-3 noon dose with explicit medicine identity; U is unlabeled Unknown; M is explicit synthetic retrospective missed audit, never treating all Unknown as missed. Stocks are today's snapshot and must not be decremented again on historical import. Historical C on keypad is synthetic only, not evidence of live call consent. Today starts without dose documents for the stage logging demo. API examples are independent scenarios and may show records after an action, not the seed's initial state.

Firestore field separation was checked against current Firebase documentation via Context7: <https://firebase.google.com/docs/firestore/security/rules-fields>. Rules cannot grant a partial document read; keep private data in separately protected documents.
