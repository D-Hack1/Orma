# Orma (ഓർമ, "memory")
### An AI medicine companion for every member of a Kerala family, on whatever phone they own

**BIA GenAI Hackathon 2026 · Challenge: AI for Inclusive Kerala**
**Team:** 4 people + 2 parallel coding agents (see `worksplit.md`) · **Platform:** native Android (Kotlin) + Firebase + Gemini

---

## Contents
1. Executive summary · 2. Problem · 3. Personas · 4. Solution overview · 5. Roles and family tree · 6. Account modes · 7. Device tiers · 8. Core features · 9. Keypad phones: automated calls · 10. "Parayu" messaging · 11. Never-guess safety rule · 12. **Explainable AI** · 13. **Federated Learning** · 14. Accessibility matrix · 15. How AI is used · 16. **Tech stack and reasons for each choice** · 17. Architecture · 18. Data model · 19. API contracts · 20. Priorities · 21. Execution overview · 22. Demo script · 23. Testing · 24. Privacy and ethics · 25. Risks · 26. Impact measures · 27. Roadmap · Appendix: Malayalam phrases

---

## 1. Executive summary
In Kerala, many elderly parents live at home while their children work in the Gulf, in other states, or abroad. Every day the same worried question comes up: **"Did you take your medicine?"** Elders forget whether they took a dose, and some take it twice. People with vision, hearing, speech, motor or memory difficulties can't use normal reminder apps. Many rural elders own only a **keypad phone**.

**Orma** is built on five ideas:
1. **No app to open.** Long-press the power button and speak Malayalam. On a keypad phone, just answer the call and **talk**. Gemini understands the reply, even on a ₹1,000 phone.
2. **Generative AI throughout, grounded in records.** Gemini covers six jobs:
   - understands Malayalam/Manglish speech
   - reads **handwritten prescriptions** and medicine strips
   - holds spoken conversations on keypad calls
   - writes natural answers in Malayalam
   - writes daily family summaries
   - writes doctor-visit summaries

   Every generated sentence must **cite a real record**. Sentences without a citation are rejected, so Orma never guesses.
3. **The elder comes first; the whole family supports.** The elder owns their own data and decides what is shared. Children, nurses and co-caregivers are *supporters*, not supervisors. Each person gets a screen that suits their abilities and their phone.
4. **Explainable.** Every answer, alert and prediction has a **"Why?"** that shows exactly what Orma heard, which records support each sentence, who logged what, and which factors raised a risk.
5. **Private by design (federated learning).** Orma learns which doses are likely to be missed **on each phone**. Sensitive behaviour signals (such as how often someone asks "did I take it?") never leave the phone. Only anonymised model updates are combined across families.

## 2. Problem
| Problem today | Who it affects | What it leads to |
|---|---|---|
| "Did I already take it?" uncertainty | Elders, people with memory decline | **Double doses** (dangerous with BP or diabetes medicine) or skipped doses |
| Reminder apps only remind; they can't answer "did I?" | Everyone | Reminders get ignored and nothing is recorded |
| Apps need reading, typing, small buttons and English | Low-literacy, blind, motor-impaired and rural users | They can't use them |
| Many elders have only keypad phones | Rural and very old users | Smartphone-only solutions leave them out |
| Children abroad can't see what's happening | Families with members working away | Anxious repeated calls, guilt, help that comes too late |
| Home nurses keep paper notes, or nothing | Families with paid carers | Doses repeated or missed when shifts change |
| AI makes decisions nobody can check | Families, doctors | Low trust; mistakes nobody notices |
| Health apps upload everything | Everyone | Privacy fears, especially around memory and cognitive signals |

### 2.1 Why Orma is different from what already exists
| Existing solution | What it does | What Orma adds |
|---|---|---|
| Medisafe, MyTherapy, phone reminders | Reminders + tick boxes in English; needs reading and tapping | Malayalam speech, power-button access, answers "did I already take it?", blocks double doses, accessibility modes |
| Alexa / Google Assistant reminders | Voice reminders on smart speakers | Works on keypad phones and cheap Androids; understands Malayalam code-mix; grounded answers with citations; family + nurse in one record |
| **99DOTS** (India, TB) | Missed-call adherence for one disease | **Conversational GenAI** on the call (she speaks, doesn't just dial); any medicine; prescription vision; family/nurse loop; double-dose guard |
| Paper charts kept by home nurses | Manual notes | A shared, live, explainable record kept by the nurse, family and elder together |

**Orma's one-line difference:** *the only medicine companion that lets anyone, on any phone, simply say what they did in their own Malayalam and get a truthful, cited answer later.*

## 3. Personas
| Persona | Profile | Phone | What they need |
|---|---|---|---|
| **Achan** (father), 78, Kottayam | Low vision; BP and cholesterol medicine | Shares an old Android Go phone | Talk instead of read; a physical button; spoken replies |
| **Amma** (mother), 72, Kottayam | Diabetic; early memory decline | Same shared phone | A calm answer to "did I take it?"; protection from double doses |
| **Ammoomma** (grandmother), 90, Idukki | Can't read; hard of hearing | **Keypad phone** | Calls she can answer by pressing one key |
| **Anu** (daughter), 38, Dubai | Main caregiver | Android | Live status, alerts only when something is wrong, can manage remotely, can see why an alert happened |
| **Rahul** (son), 34, Bangalore | Backup caregiver; takes thyroid medicine himself | Android | Shares duty with Anu; quiet reminders for his own medicine |
| **Sister Mini** (home nurse) | Visits Mon–Fri, 9–5 | Android | Log the doses she gives; see schedules; get messages from the parents |
| **Farhan**, 29, Kochi | Deaf; Type-1 diabetic; manages his own care | Android | Silent, visual-only reminders; refill alerts; not linked to any family |

## 4. Solution overview
```
 ┌──────────────── WAYS TO LOG OR ASK ──────────────┐      ┌────────── WHO SEES IT ──────────┐
 │ Long-press power → speak (Assisted)              │      │ Caregiver family tree (live)    │
 │ App asks at dose time → "aa" / tap (Assisted)    │      │ Nurse view (assigned patients)  │
 │ ✓ Taken on notification / widget (Independent)   │ ───► │ Alerts (push / SMS)             │
 │ Automated call → press 1 (Keypad)                │      │ "Why?" explanation on everything│
 │ Nurse / family logs on their behalf              │      └─────────────────────────────────┘
 └──────────────────────────────────────────────────┘
          │                                   ▲
          ▼                                   │
 Gemini understands speech → code applies safety rules → Firestore (live, works offline)
          │
 On-phone risk model (federated learning) → explainable risk + earlier nudges
```

## 5. Roles and family tree
### 5.1 Roles and permissions
| Role | Can | Cannot |
|---|---|---|
| **Elder / member (data owner)**, e.g. Achan, Amma | **Owns their own record.** Decides what supporters can see (§5.5). Can remove any supporter. Logs doses, asks questions, sends messages | — |
| **Lead supporter**, e.g. Anu | Sets up the family *with the elder's consent*, adds members, enters schedules (from prescription photos), assigns nurses, sees what the elder shares, logs on someone's behalf, sets the duty roster | See anything the elder has not shared; stay on as supporter if the elder removes them |
| **Supporter**, e.g. Rahul | Same as the lead supporter, except deleting the family | Remove the lead supporter |
| **Home nurse**, e.g. Mini | See **only the patients assigned to her**; log "given by nurse"; add notes; get messages; *suggest* schedule changes | Edit schedules; see unassigned members; access anything once removed |
| **Assisted member** | Log doses, ask questions, send messages | Edit their own schedule |
| **Keypad member** | Answer calls, press keys, give a missed call to get a callback | — (has no app) |
| **Independent member** | Manage their own schedule, stock and reminders; linking to a family is optional | — |

One person can hold more than one role (e.g. Rahul is both co-caregiver and an independent member). A **role switcher** in the app header changes between them.

### 5.2 Example family tree
```
                    Anu (Owner, Dubai) ⇄ Rahul (Co-caregiver, Bangalore)
                                   │
     ┌───────────────┬─────────────┴──────┬──────────────────────┐
 Achan (Assisted) Amma (Assisted)  Ammoomma (Keypad)    Rahul (Independent, self)
     └── shared "Home phone" ──┘     📞 +91 9xxxx
                 │
       Sister Mini (Nurse) → Achan + Amma, Mon–Fri 9:00–17:00
```

### 5.3 Shared phones and logging for a group
- A household phone can be linked to several members.
- *"Njangal randuperum raavile marunnu kazhichu"* ("Both of us took our morning medicine") → logs Morning ✅ for **everyone linked to that phone**.
- *"Achan kazhichu, Amma kazhichilla"* ("Father took it, Mother didn't") → Achan ✅, Amma stays ⏳ and gets a reminder.
- A bare *"Kazhichu"* ("Took it") on a shared phone → Orma **asks**: "Who took it: Amma, Achan, or both?"
- No voice identification. It is unreliable for elderly voices and raises privacy concerns.

### 5.4 Duty roster, handover and escalation
- The roster says who is on duty, e.g. "Anu: weekends · Rahul: weekdays · Nurse: Mon–Fri 9–5". Alerts go only to the person on duty.
- Escalation: the on-duty person gets 5 minutes, then the nurse (if on shift), then all caregivers.
- Handover takes one tap, e.g. "Hand over to Rahul until Monday".

### 5.5 The elder controls what is shared (dignity first)
- **Shared by default** (the minimum needed for safety): dose status (taken / missed / unknown) and double-dose alerts.
- **Shared only if the elder turns it on:**
  - tablet counts
  - message content
  - risk score
  - "asked twice" signals in the daily summary
  - nurse notes
- Elders change these settings **by voice**, e.g. *"Ente marunnu vivaram Rahul-nu kaanikkanda"* ("Don't show my medicine details to Rahul"). The caregiver can't override this.
- **Capacity:** if a doctor says the elder can't consent (advanced dementia), a named legal guardian can manage sharing. This is shown on the screen and recorded.
- **Language rules:** the UI always says "supporters", never "monitoring". The summary says "Amma took…", never "Amma failed…".

## 6. Account modes (the app's screens change per user)
Setup asks 3 questions, by voice or tap (or the caregiver answers them):
1. Who manages this phone?
2. Should reminders be spoken out loud?
3. Any difficulty seeing, hearing, speaking, moving or remembering?

| | 🧓 Assisted | 🙋 Independent | 👨‍👩‍👧 Caregiver | 🩺 Nurse |
|---|---|---|---|---|
| Home screen | One huge **Speak** button + 3 dose-slot icons | Simple list: today's doses, stock, next dose | Family tree with live status + risk badges | Today's patients and due doses |
| Reminders | Spoken out loud + screen flash + vibration; repeats; then tells family | **Silent notification** with ✓ Taken / ⏰ Snooze (with reason) | Only when something's wrong: missed / partial / double / unknown / low stock / urgent / high risk | Due list during her shift |
| Logging | Power button, app asking at dose time, big icons | Notification buttons, widget, quiet voice log | On behalf of a member | "Given by nurse" |
| Voice replies | On (slow, clear Malayalam) | Off | Off | Off |
| "Why?" | Asked by voice ("Enthaa angane?", "Why is that?") → spoken explanation | Tap ⓘ | Tap ⓘ on every status, alert or risk | Tap ⓘ |
| Refill alerts go to | Caregiver | Self | Caregiver | Nurse (copy) |
| Family link | Required | Optional, off by default | Owns the tree | Assigned by caregiver |

**Accessibility layers apply on top of any mode:**
- **Vision:** biggest text, high contrast, TalkBack, everything spoken.
- **Hearing:** captions, flash + vibration.
- **Speech:** icons and taps instead of voice.
- **Motor:** the whole screen is the tap target, no swipes, accidental double taps ignored.
- **Memory:** no menus, the same calm wording every time.

## 7. Device tiers (features matched to the phone)
Orma checks the phone on first launch and keeps checking while it runs. It picks the richest tier the phone can run smoothly. **The core features work on every tier:** reminder, logging, double-dose guard, never-guess, family visibility.

| Tier | Phone | How we detect it | Enabled | Reduced or off |
|---|---|---|---|---|
| **T1 Full** | Android 10+, ≥3 GB RAM, good network | `Build.VERSION`, `ActivityManager.isLowRamDevice()`, `memoryClass`, `ConnectivityManager` network capabilities, `RoleManager.isRoleAvailable(ROLE_ASSISTANT)`, whether the Malayalam TTS voice is installed | Everything, including on-phone federated learning training | — |
| **T2 Lite** | Android Go, 1–2 GB RAM, Android 8–9, slow network | Low-RAM flag, API level, network bandwidth estimate | Power button, short compressed voice clips, notifications, big icons, risk shown (from the shared global model) | Photo features, animations, frequent sync, **on-phone FL training** (Lite phones don't train; they only use the shared model) |
| **T3 Offline-first** | Any phone with patchy internet | Network callbacks, failed requests | Tap/icon logging, on-phone `SpeechRecognizer` (offline when possible) + keyword matching, local reminders, double-dose guard from the local cache | Gemini understanding (queued until online); alerts sent by SMS |
| **T4 Keypad** | Feature phone | Caregiver chooses "Keypad phone" | Automated calls, keypad replies, missed-call callback, SMS | No app |

- **Automatic fallback:** Gemini fails or is slow → on-phone keyword matching → big icons. The user never gets stuck.
- The caregiver can override the tier.
- **Thresholds** live in Firebase Remote Config, so they can change without a new app release.

## 8. Core features
1. **Long-press power to speak.** Orma registers as Android's **default digital assistant** (`VoiceInteractionService` + `ROLE_ASSISTANT`). It opens already listening, **even on the lock screen** (`setShowWhenLocked`, `setTurnScreenOn`). The caregiver sets this up once. Power-button behaviour differs by phone brand, so there are fallbacks: Samsung side-key double-press → open app, the corner-swipe assistant gesture, a Glance widget, and a persistent notification button.
2. **Tablet counts.** *"Ravile 3 gulika kazhichu"* ("Took 3 tablets this morning") is checked against the prescription. Fewer tablets than prescribed → Orma asks "Is the vitamin one left?" and marks the dose 🟡 Partial. Naming a tablet works too: *"BP-de mathram"* ("Only the BP one").
3. **Double-dose guard.** If the slot is already logged: "You took it at 8:15, after breakfast. Don't take it again." plus a long vibration. If the person insists, the on-duty person is alerted.
4. **App asks at dose time (Assisted).** "Amma, raavile ulla gulika kazhicho?" ("Amma, did you take your morning tablets?") → she answers "aa" (yes) / "illa" (no), or taps. No answer → asks again after 15 minutes. After 2 tries the dose becomes ❓ Unknown and escalation starts.
5. **Quiet mode (Independent).** Silent notification with ✓ Taken / ⏰ Snooze (NotificationCompat actions → BroadcastReceiver, no need to open the app). Notifies only for: dose due, one overdue nudge, low stock.
6. **Snooze with a reason.** "Not eaten yet" → reminds after the person's usual meal time (for after-food medicines). Also "Not at home" and "Later (30 min)". Works by voice too: *"Chorunnittilla"* ("I haven't eaten yet").
7. **Refill warning.** Stock goes down with each logged dose. Alerts at 7, 4 and 2 days left, sent to the right person.
8. **Home-screen widget** (Jetpack Glance). Shows today's 3 slots; tap a slot to log it. Different versions for Assisted, Independent and Caregiver.
9. **Travel / time-zone mode.** Dose times are stored in the member's local time. The caregiver sees both times, e.g. "8:15 AM IST (6:45 AM Dubai)". When an independent user travels, Orma asks whether to keep the same gaps between doses or switch to local times. For insulin and other time-critical medicines it says "check with your doctor".
10. **"Ee gulika enthinaa?" ("What is this tablet for?")** Answered **only from data the family entered or confirmed**; otherwise "I'll ask Anu." Also available on keypad calls (press 4).
11. **Prescription → schedule with Gemini vision (G2, P0).** The caregiver or nurse photographs the prescription. It can be **handwritten**, or a printed hospital discharge sheet.
    - Gemini extracts medicine, strength, dose, frequency (e.g. 1-0-1), before/after food, and duration. Each line gets a confidence level and a **box drawn on the photo** around the exact text it came from.
    - The caregiver confirms **every line** on a side-by-side screen. Unclear lines are flagged "ask pharmacist/doctor" and are never auto-added.
    - Confirmed lines become the schedule, and the strip count sets the starting stock.
12. **Medicine-strip check (G6, P1).** "Ithu ethaa?" ("Which one is this?") while showing a strip → Gemini reads the strip's name and strength and **matches it only against this member's confirmed schedule**: "This is your BP tablet. You take it in the morning." If there's no match: "This is not on your list. Please ask Anu or the pharmacist." It **never** identifies medicines from general knowledge.
13. **Pill-box photo check (P1, previously a stretch goal).** If the status is Unknown, or she says "taken" but she's at high risk, Orma asks her to show today's pill-box compartment. Gemini vision checks it → **✅ photo-verified**, which is a stronger record than a self-report (answers the "she might misremember" criticism).
14. **Daily family summary (G4, P1).** Every evening Gemini writes a short **voice note + text**, in the language each supporter chooses, using only what the elder shares:
    - *"Amma took morning and night. At noon she took 2 of 3 and is checking about the vitamin. She asked about the night tablet twice (shared with her permission). Sister Mini noted BP 140/90."*
    - Every sentence cites its records, and tapping a sentence shows its sources.
15. **Doctor-visit summary (G5, P1).** One tap → Gemini writes a one-page clinical summary covering adherence % per medicine, missed and partial patterns, side effects mentioned in messages, nurse vitals, and refill gaps. Each line is cited. It can be exported as PDF or shared on WhatsApp for the next appointment.
16. **Reminders in a family member's real recorded voice (stretch).** Never AI-cloned.

## 9. Keypad phones: automated calls (T4), must have
**Setup by the caregiver:**
1. Add member → Keypad → name, number, language, schedule, retries, quiet hours, call voice (Anu's own recording, or the standard voice).
2. A **consent call** first: "Press 1 to agree." No calls are scheduled without consent.
3. Save the Orma number on her phone as **"Anu Marunnu"** ("Anu Medicine").

**The call at dose time is a conversation (G1). Key presses stay as a backup:**
```
📞 "Namaskaram Ammoomma. Anu-nte marunnu orma. Raavile ulla gulika kazhicho?
    Paranjal mathi — allenkil 1 amarthuka."
   ("Hello Ammoomma. Your medicine reminder from Anu. Did you take your morning tablets?
     Just tell me — or press 1.")
  🗣 She speaks: "Kazhichu, randu ennam, BP-de baakki undu"
     ("Took them, two of them, the BP one is still left")
     → <Record> (stops on silence) → Gemini (audio → intent JSON with evidence spans)
     → logDose (partial: BP pending)
     → grounded Malayalam reply generated → Cloud TTS → <Play>:
       "Shari, randu kazhichu. BP gulika koodi kazhikkane." ("Okay, you took two. Please take the BP tablet too.")
  🗣 She asks: "Njan raavile kazhicho?" ("Did I take it this morning?")
     → grounded answer from her records, with citations
  🗣 She says: "Anu-vodu parayu, kaal vedana undu" ("Tell Anu my leg hurts")
     → Parayu message to Anu
  Unclear speech twice / silence → falls back to key presses:
     1 Taken → count · 2 Not yet · 3 Talk to Anu · 4 What is this tablet for? · 9 Repeat
No answer → retry at +15 and +30 minutes → ❓ Unknown → escalate
```
- **Speed target:** under 4 s per turn. A short "Shari…" ("Okay…") filler plays while Gemini is thinking. Common replies are pre-generated audio; only new ones are generated live.
- Turn-based for the hackathon (`<Record>` → reply). The production upgrade is real-time two-way streaming (Twilio Media Streams + Gemini Live API).
- **No call is placed if the dose is already logged** (e.g. by the nurse).
- Prompts are slow, every option is said twice, and there's a long wait for key presses.
- **Missed-call service:** she calls the Orma number. The server declines the call without answering (`<Reject>`), so it costs her nothing, then calls her back with the menu: 1 = I took it now · 2 = did I take it? · 3 = message Anu · 4 = what is this tablet for?
- **SMS:** replying "1" or "2" also works. Caregivers without internet get SMS alerts.
- **Hackathon: Twilio free trial only (no paid account):**
  - Calls go only to **verified numbers**. H2 verifies the keypad phone and the team's phones in advance.
  - The trial plays a short **"trial account" message and asks for a key press** before our prompts. In the demo we say this out loud; in production it goes away.
  - Turn on **Geo Permissions → India** for outgoing calls.
  - The free trial credit is enough for demo calls.
- **Production:** Exotel (Indian numbers, TRAI DLT compliance, lower cost). The phone-call code is written behind a common interface, so switching providers is a configuration change.

## 10. "Parayu" ("tell") messaging
- *"Nurse-nodu parayu, enikku thalavedana undu"* ("Tell the nurse I have a headache") → the nurse gets the audio, the Malayalam text, and a translation into her language.
- *"Anu-ve vilikkan parayu"* ("Ask Anu to call me") → Anu gets a "Call Amma" alert. Saying "someone" sends it to whoever is on duty.
- **Urgent words** (nenju vedana "chest pain", veenu "fell", swasam muttal "can't breathe", thala karakkam "dizzy") → a 🔴 alert to everyone on duty at once, plus a suggestion to call 108 (ambulance). Orma clearly says it is **not** an emergency service.
- Replies are played out loud and shown as captions. The nurse can mark "Visit done", add notes ("BP 140/90"), and suggest schedule changes.

## 11. Never-guess safety rule: grounded generation with citations (G3)
**Gemini writes every answer, but each factual claim must cite a real record. The server rejects anything without a citation.**

**How a grounded answer is built:**
1. The code builds a **fact pack**: only the records relevant to the question, each with an ID, e.g. `D1 = dose 2026-11-07_morning confirmed 08:15 voice "raavile kazhichu"`, `S2 = schedule night: Metformin 500, Atorva 10`, `N3 = nurse note 11:00 BP 140/90`. Fields the elder hasn't shared are left out.
2. Gemini is told: *"Answer in simple Malayalam using ONLY these facts. Return `sentences[{text, cites:[ids]}]`. If the facts don't answer the question, return `{insufficient: true}`."*
3. **Server checks:**
   - every sentence has at least one citation
   - every cited ID exists in the fact pack
   - times and numbers in the text match the cited records (regex + compare)
   - no medicine names appear that aren't in the fact pack
   - any failure → that sentence is dropped. If nothing valid remains → the deterministic template below.
4. `insufficient` → the ❓ Unknown reply + alert. **Orma never guesses.**

The table below still sets the meaning of each status. These templates are what Orma falls back to whenever generation fails the checks:

| Status | Source | Reply |
|---|---|---|
| ✅ Confirmed | The member's own voice / tap / notification / keypad / photo | "Yes, {n} tablets at {time}, {anchor}. Don't take again." |
| 👥 Reported | Logged by the nurse or family | "Sister Mini gave it at {time}." |
| 🟡 Partial | Count lower than prescribed | "{n} of {total}. {missing} is left." |
| ⏳ Pending | Not due yet | "Not time yet. I'll remind you at {time}." |
| ❓ Unknown | No record | "I'm not sure. **Please wait before taking another.** I'm asking {on-duty} to call you." + alert |

How it works:
1. The AI only produces the intent (log / ask / message / snooze / explain / why / unclear).
2. **Code** looks up the record, chooses a template, and checks that the facts in the final wording match the record. If they don't, the plain template is used.
3. If the request is unclear, Orma asks a follow-up question.
4. The caregiver can set a per-medicine "if unsure" instruction from the doctor. The default is *wait and escalate*.
5. **Risk predictions (§13) are never used as dose facts.** They only change reminder timing and alerts, and they're always labelled "prediction".

## 12. Explainable AI ("Why?" for everything)
Explainability here means three things people can check. It doesn't only explain the model.

### 12.1 Why did Orma understand it this way? (input explanation)
- `understand` returns **evidence spans**: the exact words in the transcript behind each field, e.g. `"randuperum"` → members = both, `"3"` → count = 3, `"raavile"` → slot = morning.
- **The server checks that each span really appears in the transcript.** Made-up spans are dropped. If a required field has no span, Orma asks a follow-up question instead.
- The app **highlights those words in the caption** (colour + underline, read out by TalkBack), so the elder, nurse or caregiver can see what Orma heard. On the dashboard: "Logged from: '*njangal **randuperum** **raavile** marunnu kazhichu*'".

### 12.1b Why does the answer say this? (citations)
- Every generated sentence (answers, daily summaries, doctor summaries) carries the IDs of the records it cites. Tap a sentence (or ask "Enthaa angane?" / "Why?") → see or hear the source records.
- Prescription extraction shows a **box drawn on the photo** for each extracted line, so the caregiver can see exactly where on the prescription it was read.

### 12.2 Why is this the status? (decision provenance)
- Every dose record has an **evidence trail** `evidence[]`: who logged it, how, when, transcript snippet or keypad digits, number of attempts.
- **"Why?"** (tap ⓘ or ask *"Enthaa angane?"*) shows or speaks the trail:
  - ✅ "Because at 8:15 you said '*raavile kazhichu*' on the home phone."
  - ❓ "No log. Check-ins at 8:00 and 8:15 weren't answered. Call at 8:30 wasn't answered."
- Every alert includes the rule that fired it: "Escalated to Rahul because Anu didn't respond within 5 minutes."

### 12.3 Why is this dose at risk? (prediction explanation)
- A small **missed-dose risk model** predicts, for each member and slot, the chance the dose will be missed today.
- It is a **logistic regression** model, so it is interpretable by design. Each factor's contribution is calculated exactly as **wᵢ·(xᵢ − x̄ᵢ)** (for a linear model this equals the standard SHAP value, a common measure of feature contribution), so no approximation is needed.
- The dashboard badge shows the **top 2 reasons** in plain language, e.g. "Night dose risk: **High** · missed 3 of the last 7 night doses (+28%) · nurse off today (+12%)".
- What the risk does: gives an **earlier, gentler reminder** for high-risk slots and an optional heads-up to the caregiver. It never changes a dose status.

**Model features (≈10):** slot (morning/noon/night) · weekend · nurse on shift · miss rate for this slot over the last 7 days · average time to respond to reminders · snoozes in the last 7 days · repeated "did I take it?" questions in the last 7 days · days since the last logged dose · stock running low · Unknown events in the last 7 days.

## 13. Federated Learning (private, on-phone learning)
**Why FL here:** the most predictive signals are also the most sensitive. How often someone asks "did I take it?", how slowly they respond to reminders, and how often they snooze are **early signs of memory decline**. Families, and Orma's servers, don't need to see these raw signals. FL lets the model learn from them **without them leaving the phone**.

**What stays on the phone:** response delays, repeated-question counts, snooze patterns, failed voice attempts.
**What leaves the phone:** only clipped, noise-added **model weight updates** (about 11 numbers), sent to the server for averaging.
**Already shared (not part of FL):** dose statuses that the family can see in the tree.

**Protocol (FedAvg, a standard federated-learning algorithm):**
1. The server publishes global model `flModels/{version}` (weights + feature means).
2. Each eligible T1 phone runs a **WorkManager** job overnight, only when **charging + on Wi-Fi + idle** (the standard FL practice, as used by Google's Gboard keyboard). It trains locally for a few epochs on its own last-30-day examples (one row = member × slot × day, label = missed?).
3. The phone sends `Δw` (weight change) + sample count. Before sending, it **clips the L2 norm** (caps the size of the update) and **adds Gaussian noise** (a lightweight form of differential privacy).
4. The server waits for at least **K = 5** clients per round (so no single family's update can be isolated), then combines them with a **sample-weighted FedAvg** to produce the new global version.
5. Phones download the new model. T2 phones only use it for predictions; they don't train.

**Hackathon reality:**
- An **FL simulator** (`ml/fl_simulator.py`) runs 30 synthetic families with different habits for 10 rounds.
- It produces **(a)** the starting global model and **(b)** a chart of accuracy/AUC by round, comparing FL with centralised training and with local-only training. The chart goes on the pitch slide.
- The real demo phone **takes part in one live round** (a training job triggered manually), and the dashboard shows the model version update.
- We're honest about limits: secure aggregation and formal differential-privacy accounting come later (production path: **Flower** framework).

## 14. Accessibility matrix
| User group | Barrier today | How Orma removes it |
|---|---|---|
| Seniors / low literacy / rural | Reading, English, small buttons, finding apps | Physical button, natural Malayalam, Orma asks *them*, nothing to read |
| Blind / low vision | Visual-only interfaces | Button trigger, everything spoken (including "Why?"), vibration patterns (2 short = saved, 1 long = warning), TalkBack labels, huge high-contrast captions |
| Deaf / hard of hearing | Sound-only reminders and assistants | Captions everywhere, highlighted evidence words, flash + vibration, icon and notification logging, text alerts; slow, repeated call prompts |
| Speech impaired | Voice-only assistants | Icons, tap to confirm, notification ✓, keypad |
| Motor / tremor / wheelchair | Small targets, swipes | One physical press, whole screen is the tap target, accidental double taps ignored |
| Cognitive decline | Menus, changing wording, being told "you forgot" | No menus, the same calm wording, never-guess, time anchors ("after breakfast"), risk-based earlier nudges |
| Keypad-phone owners | Left out completely | Calls, keypad, missed-call callback, SMS |
| Low-end smartphones | Heavy apps lag | Native Kotlin, Baseline Profiles, T2 Lite tier |
| Poor connectivity | Cloud-only apps fail | Offline-first, on-phone speech recognition + keyword matching, SMS |
| Independent adults | Loud, patronising apps | Quiet mode, minimal UI, family link only if they choose |
| Nurses / carers who speak another language | Paper notes, language gap | Shared record, "given by nurse", auto-translation |
| Everyone | Distrust of black-box AI and uploaded data | "Why?" on everything; federated learning keeps sensitive signals on the phone |

## 15. How AI is used
| Task | Engine | Output |
|---|---|---|
| Understanding speech | **Gemini Flash-class** (audio in, schema-constrained JSON out) | `{transcript, intent, members[], slot, count, medicines[], snoozeReason, messageTo, messageText, urgency, needsClarification, clarifyQuestion, evidence[{field, span}]}` |
| **Grounded answers (G3)** | Gemini Flash | `sentences[{text, cites[]}]` or `{insufficient}` → checked by the server (§11) |
| **Conversational keypad call (G1)** | Gemini Flash (audio in) + Cloud TTS | Each spoken turn → intent + grounded reply → audio played back on the call |
| **Prescription → schedule (G2)** | Gemini Pro-class vision | `lines[{medicine, strength, dose, frequency, food, duration, confidence, bbox}]` → **caregiver confirms every line** |
| **Medicine-strip check (G6)** | Gemini Pro vision | `{readName, readStrength, matchedMedicineId \| null, confidence}`. Only matched against the member's own schedule |
| **Daily family summary (G4)** | Gemini Flash | Cited sentences → text + TTS voice note, in each supporter's language |
| **Doctor summary (G5)** | Gemini Pro | Cited clinical summary → PDF |
| "Why?" wording | Gemini Flash | Evidence trail / risk contributions → simple sentence (facts checked) |
| Translating messages | Gemini Flash | Malayalam ↔ the nurse's language |
| Pill-box check (P1) | Gemini Pro vision | `{slotEmpty: true \| false \| uncertain}` |
| Missed-dose risk | **On-phone logistic regression** (trained with FL) | Probability + per-factor contributions |
| Fallback | **OpenAI** (speech-to-text + mini model with Structured Outputs) | Same structured output |
| Offline | Android `SpeechRecognizer` (offline when possible) + keyword matching | Basic intent |

Model IDs are pinned to the **latest stable** Flash and Pro versions at build time, and kept in Remote Config.

---

## 16. Tech stack: what we chose and why
Rule for every choice: **industry standard + the best fit for low-end Android phones and Indian users + fast to build with AI agents in 4 hours.** The demo, and all target users, are on Android, so we go **fully native**.

| Layer | Choice | Why this | Why not the alternatives |
|---|---|---|---|
| **Language** | **Kotlin 2.x** | Google's official, recommended Android language. Null-safe, with coroutines. Every Android API is available directly. | **Flutter:** iOS support isn't needed for the demo. It needs platform channels for the assistant, lock screen, alarms, widget and notification actions, which are exactly our core features. It also adds about 4–6 MB of engine and more memory use on Go phones. **React Native:** a JS runtime is heavier on 1–2 GB phones. **Java:** legacy. |
| **UI** | **Jetpack Compose + Material 3** | Google's modern UI toolkit. **Semantics** for accessibility are built in. Easy to adapt the UI for each role, tier and accessibility layer. Supports dynamic text scaling. | XML Views: slower to build; more boilerplate for adaptive UI. |
| **Architecture** | **MVVM + single activity**, **Navigation Compose**, **Hilt** (dependency injection), **Coroutines + Flow**, **DataStore** (settings) | This is Google's "Guide to app architecture" standard stack. Hilt makes swapping the stub API for the real one a single binding. | Koin: fine, but Hilt is Google's standard. Manual DI: error-prone. |
| **Serialization** | **kotlinx.serialization** | Kotlin-native, fast, works with the JSON contracts. | Gson: reflection-based and slower; has issues with Kotlin null-safety. |
| **Assistant / lock screen** | `VoiceInteractionService` + `VoiceInteractionSessionService` + `RoleManager` (`ROLE_ASSISTANT`); `Activity.setShowWhenLocked/TurnScreenOn` | The only official way to take over the power-button / assist gesture. | Accessibility-service shortcut: kept only as a fallback; Google Play restricts that API. |
| **Reminders** | **AlarmManager** `setExactAndAllowWhileIdle` (+ `SCHEDULE_EXACT_ALARM` permission request on Android 14+), **NotificationCompat** with action buttons → **BroadcastReceiver** | Exact medicine times even in Doze (Android's battery saver), works offline, buttons work without opening the app. | WorkManager alone: not exact enough for dose times. |
| **Background jobs** | **WorkManager** | The standard for deferrable work: sync retries and **FL training (only when charging + on Wi-Fi + idle)**. | Bare services: get killed by Android and by phone-maker battery savers. |
| **Widget** | **Jetpack Glance** | Google's Compose-style widget API. | RemoteViews XML: legacy. |
| **Audio / speech on the phone** | `AudioRecord`/`MediaRecorder` (AAC/Opus 16 kHz mono); Android **TextToSpeech** (`ml-IN`); **SpeechRecognizer** (`EXTRA_PREFER_OFFLINE`) for T3 | Built into Android, free, works offline; small audio files suit 2G/3G. | Third-party SDKs: bigger app size, and they cost money. |
| **On-phone ML (FL client)** | **Pure-Kotlin logistic regression** (≈11 weights, SGD) | Tiny, fast and fully interpretable. Runs fine even on low-end phones. Nothing to install. | TFLite on-device training: powerful, but overkill for 11 weights and makes the app bigger. Planned for production once the model grows. |
| **Performance** | **Baseline Profiles**, **R8** shrinking, `minSdk 26` (Android 8), ABI splits | Faster startup and smaller APK, which matters on Android Go phones. | — |
| **Backend platform** | **Firebase** (Google Cloud) in **asia-south1 (Mumbai)** | Firestore **offline cache built in** (needed for T3 and for the double-dose guard offline). Live listeners. Auth, FCM push, Functions, Storage and Remote Config all in one product. Data stays in India with low latency. Same Google Cloud project as Gemini. | **Supabase:** no built-in offline sync or push on Android. **Custom Node + Postgres:** too much to build in 4 hours. **AWS Amplify:** heavier setup. |
| **Database** | **Cloud Firestore** | Live + offline + per-role security rules. **One fixed document ID per dose** (`{date}_{slot}`), so a duplicate log can't create a second record. | Realtime Database: weaker queries and security rules. |
| **Auth** | **Firebase Auth phone OTP** | Indians identify by phone number; keypad members are just phone numbers. | Email/password: wrong fit for elders. |
| **Server logic** | **Cloud Functions for Firebase 2nd gen · TypeScript · Node 22** | Runs on Cloud Run with autoscaling and public HTTPS URLs (needed for Twilio webhooks). **Scheduled functions + task queues (Cloud Tasks)** handle call retries and escalation. TypeScript is the industry standard. | A self-managed VM: we'd have to run it ourselves. |
| **Validation** | **zod** | Checks every AI output and API input at runtime; anything invalid triggers the fallback. | Trusting raw LLM JSON is unsafe. |
| **GenAI (primary)** | **Gemini on Vertex AI** via the **Google Gen AI SDK** (`@google/genai`) | Takes **audio directly** (understands speech in one call, good with Malayalam–English mixing). Strong in Indian languages. Supports schema-constrained JSON output. Enterprise terms (customer data not used for training). The team has Gemini Pro access. | OpenAI as primary: needs a separate speech-to-text step and a separate vendor. On-device LLM: too heavy for Go phones. |
| **GenAI (fallback)** | **OpenAI API** | The team has access; protects against an outage during the live demo. | No fallback = a single point of failure on stage. |
| **Call/reply audio** | **Google Cloud Text-to-Speech** (Malayalam voices), pre-generated MP3s in Storage | Consistent Malayalam for call prompts; cached, so no delay. | Built-in TTS from phone-call providers: Malayalam support is inconsistent. |
| **Phone calls + SMS** | **Twilio free trial** (TwiML `<Gather>` keypad input, `<Play>`, `<Record>`, `<Reject>`) → **Exotel** in production | Twilio has the best documentation and is quickest to get working; the free trial is enough for verified demo numbers. Exotel is India's standard (local numbers, DLT compliance, cost). Both sit behind a `TelephonyProvider` interface. | Exotel for the hackathon: KYC approval takes days. |
| **Push** | **FCM** | Android's standard push service; free. | Extra vendors add nothing. |
| **FL aggregation** | Cloud Function `flSubmit` + scheduled `flAggregate` (FedAvg + clipping + noise) | A few dozen lines; uses the same backend; easy to show live. | **Flower** (industry-standard open-source FL framework) needs a separate Python gRPC server: that's our **production path**, too heavy for 4 hours. TensorFlow Federated: research/simulation only. |
| **FL simulation** | **Python 3.12 + NumPy + scikit-learn + matplotlib** | Python is the standard for ML experiments. It produces the starting model, the comparison against centralised training, and the pitch chart. | — |
| **Explainability** | Exact linear SHAP (wᵢ·(xᵢ−x̄ᵢ)) + evidence spans checked by the server | Exact and cheap; no approximation needed. | KernelSHAP/LIME: approximate and slow; not needed for a linear model. |
| **Quality** | **Crashlytics**, **App Check (Play Integrity)**, Firestore rules unit tests | Production-grade monitoring and abuse protection. | — |
| **Testing** | JUnit + **Robolectric**, **Compose UI tests** with accessibility checks, **Vitest** (functions), `@firebase/rules-unit-testing`, **Accessibility Scanner** | The standard tools for each layer. | — |
| **Dev tooling** | **Android Studio**, Gradle version catalogs, **Firebase Emulator Suite**, GitHub monorepo, **one git worktree per agent**, **scrcpy** to show phones on the projector | Agents work in parallel without conflicts; the real phones are shown live on screen. | — |

---

## 17. Architecture
```
┌──────────────── Android app (Kotlin, Compose) ─────────────────────┐
│ Role UIs: Assisted · Independent · Caregiver · Nurse               │
│ Tier detection → feature flags · Firestore offline cache           │
│ VoiceInteractionService (power button, lock screen)                │
│ AlarmManager + notification actions · Glance widget · TTS · STT    │
│ FL client: logistic regression + WorkManager trainer + "Why?" UI   │
└──────────┬────────────────────────────────────────▲───────────────┘
           │ callables / Firestore writes / Δw       │ live listeners + FCM + model
           ▼                                         │
┌──────────── Firebase (asia-south1) ────────────────────────────────┐
│ Auth · Firestore · Storage · Remote Config · FCM · App Check       │
│ Functions: understand · logDose · askStatus · explain · snooze ·   │
│   sendMessage · explainMedicine · doseSweep · retryCall/escalate · │
│   voice webhooks · sms · flSubmit · flAggregate                    │
└──────────┬─────────────────────────────────────────────────────────┘
           ▼
 Vertex AI Gemini · OpenAI (fallback) · Cloud TTS · Twilio trial (→ Exotel)
 ml/ (offline): FL simulator → initial global model + charts
```

## 18. Data model (Firestore)
```
families/{familyId}: name, ownerId, timezone, roster[{memberId, role, days, from, to}]
  members/{memberId}: name, roles[], mode: assisted|independent|keypad, tier,
      accessibility{vision,hearing,speech,motor,memory}, language, phone, deviceIds[],
      nurseIds[], consent{calls, fl, at}, usualMealTimes{breakfast,lunch,dinner}
    schedule/{slotId}: slot: morning|noon|night, time, afterFood,
      medicines[{id, name, purpose, dose, count, stock, ifUnsure}]
    doses/{YYYY-MM-DD_slot}: status: confirmed|reported|partial|pending|unknown,
      countTaken, countExpected, medicinesTaken[], source, by, at, attempts,
      evidence[{type: voice|tap|notification|widget|call|photo|nurse|family|checkin,
                at, by, snippet?, spans?[{field, span}], digits?}]
    risk/{YYYY-MM-DD_slot}: p, level: low|med|high, modelVersion,
      contributions[{feature, value, delta}]          ← written by the phone
    messages/{id}: from, to, audioUrl, text, translated, urgency, readAt
    sharing: {doseStatus: true(locked), counts, messages, risk, askedTwice, nurseNotes,
              perSupporter{supporterId: {...overrides}}, guardianId?, capacityNote?}
    prescriptions/{id}: photoUrl, extractedLines[{medicine, strength, dose, frequency,
              food, duration, confidence, bbox}], confirmedBy, confirmedAt, status
    answers/{id}: question, factPackIds[], sentences[{text, cites[]}], fallbackUsed, at
    digests/{YYYY-MM-DD}: sentences[{text, cites[]}], audioUrl per language, sentTo[]
    reports/{id}: range, sections[{title, sentences[{text, cites[]}]}], pdfUrl
devices/{deviceId}: familyId, memberIds[], tier, capabilities{}
calls/{callId}: memberId, slot, date, attempt, status, digits[], providerSid
alerts/{id}: familyId, memberId, type: missed|partial|double|unknown|stock|urgent|risk,
      rule, escalationStep, ackBy, at
flModels/{version}: weights[], featureMeans[], featureNames[], round, clients, createdAt
flUpdates/{round}/clients/{anonId}: delta[], n, clipNorm, at   ← server-only access
```

## 19. API contracts (summary; full version in `contracts/api.md`)
| Endpoint | Type | Input → Output |
|---|---|---|
| `understand` | callable | `{deviceId, memberIds[], audioBase64? \| transcript?, clientTime, tz}` → understanding JSON incl. verified `evidence[]` |
| `logDose` | callable | `{memberId, date, slot, countTaken, medicinesTaken[], source, by, evidence}` → `{result: logged\|partial\|duplicate_blocked, status, reply{templateId, vars, textMl, textEn}}` |
| `askStatus` / `answer` | callable | `{memberId, question \| {date, slot}}` → `{status, sentences[{text, cites[]}], fallbackUsed, textMl, textEn}` (grounded, G3) |
| `parsePrescription` | callable | `{memberId, photoUrl}` → `{prescriptionId, lines[…with bbox, confidence]}` |
| `confirmPrescription` | callable | `{prescriptionId, lines[{…, accepted}]}` → schedule written |
| `checkStrip` | callable | `{memberId, photoUrl}` → `{matchedMedicineId?, readName, sentences[]}` |
| `checkPillbox` | callable | `{memberId, slot, photoUrl}` → `{slotEmpty, status}` |
| `dailyDigest` | scheduled 20:00 + callable | → `digests/{date}` + FCM to supporters |
| `doctorReport` | callable | `{memberId, from, to}` → `{reportId, pdfUrl}` |
| `setSharing` | callable | `{memberId, changes}` (only the member or their guardian may call it) |
| `explain` | callable | `{memberId, date, slot, kind: status\|alert\|risk}` → `{reasons[], textMl, textEn}` |
| `snooze` | callable | `{memberId, slot, reason}` → `{remindAt}` |
| `sendMessage` | callable | `{fromId, to, audioUrl?, text}` → `{messageId, urgency}` |
| `explainMedicine` | callable | `{memberId, medicineHint}` → `{found, reply}` |
| `flSubmit` | callable | `{modelVersion, delta[], n}` → `{accepted, round}` |
| `/voice/start`, `/voice/gather`, `/voice/status`, `/voice/incoming`, `/sms/incoming` | HTTPS (Twilio) | TwiML |
| `doseSweep` | scheduled, every 1 min | due slots → FCM backup / call |
| `retryCall`, `escalate` | task queues | scheduled retries and escalation steps |
| `flAggregate` | scheduled / manual | ≥K updates → new `flModels/{version}` |

Reply and "why" templates are in **`contracts/replies.json`** (Malayalam + English), so they also work offline.

## 20. Priorities
| Priority | Scope |
|---|---|
| **P0: must work on stage** | Power-button voice logging · tablet counts / partial · double-dose guard · **grounded answers with citations (G3)** · family tree + live dashboard · group logging · **conversational keypad call (G1)** · **prescription vision → schedule (G2)** · elder sharing controls (default + voice toggle) · Independent quiet notification ✓ · "Why?" evidence trail + highlighted words |
| **P1: should have** | Nurse role + Parayu · **daily family summary (G4)** · **doctor summary (G5)** · **strip check (G6)** · **pill-box photo check** · refill warning · snooze with a reason · tier detection + offline fallback · dose-time check-ins · missed-call callback · risk model + explanations · FL simulator + pitch chart |
| **P2: stretch** | Live on-phone FL round · widget · duty roster/handover · explain medicine · recorded-voice reminders · SMS · time-zone mode · real-time streaming call (Media Streams + Gemini Live) |
| **P3: roadmap** | iOS caregiver app (Kotlin Multiplatform) · Flower-based FL + secure aggregation · doctor report · beyond medicine · Exotel + DLT |

## 21. Execution overview
Two coding agents work **in parallel**:
- **Agent 1:** the Android app plus the on-phone FL client.
- **Agent 2:** backend, AI, telephony, FL aggregation and the simulator.

They use separate folders and separate git worktrees, freeze the contracts at minute 20, and merge at 3 checkpoints. 4 humans supervise:
- one per agent
- one for QA and devices
- one for the pitch, Malayalam and the demo

**Details: `worksplit.md`.**

## 22. Demo script (3:00)
Phones are shown on the projector with **scrcpy**. Anu's caregiver app runs on a second phone or the Android Emulator on the laptop.

| Time | Scene | Judges see |
|---|---|---|
| 0:00–0:15 | The problem: Achan & Amma (Kottayam), Anu (Dubai), Ammoomma on a keypad phone (Idukki), Farhan (deaf). "Amma decides what's shared." | Persona slide |
| 0:15–0:35 | Anu photographs a **handwritten prescription** → Gemini extracts the lines with boxes drawn on the photo → she confirms → schedule appears | **GenAI vision (G2)** |
| 0:35–0:55 | Locked phone → long-press power → *"Njangal randuperum raavile marunnu kazhichu"* ("Both of us took our morning medicine") | **Both** turn ✅ live; *randuperum* / *raavile* **highlighted** |
| 0:55–1:10 | *"Uchakku 2 gulika"* ("2 tablets at noon") → "Is the vitamin left?" · Achan tries to log the morning dose again → **double-dose guard** | 🟡 Partial + guard |
| 1:10–1:30 | *"Njan raathri gulika kazhicho?"* ("Did I take my night tablet?") → grounded "not sure, wait, asking Anu" · *"Raavile?"* ("And this morning?") → "Yes, 8:15 after breakfast" → tap → **citation D1** | **Grounded GenAI with citations (G3)** |
| 1:30–2:00 | **The keypad phone rings on stage** → (trial preamble) → Ammoomma **speaks** "kazhichu, randu ennam" ("took them, two") → Orma replies in Malayalam | **Conversational GenAI on a keypad phone (G1)** + ✅ live |
| 2:00–2:15 | Farhan (deaf), sound off: silent notification → ✓ → captions → strip check "ithu ethaa?" ("which one is this?") → "Your insulin pen needle? Not on your list, ask your pharmacist" | **Disability scene + G6** |
| 2:15–2:30 | Amma: *"Ente marunnu vivaram Rahul-nu kaanikkanda"* ("Don't show my medicine details to Rahul") → Rahul's view now shows status only | **Dignity: elder controls sharing** |
| 2:30–2:45 | Anu gets the **daily voice summary** (cited) · one tap → **doctor summary PDF** · risk badge with its reasons | G4 / G5 / XAI |
| 2:45–3:00 | FL slide ("memory signals never leave the phone") + impact + accessibility matrix | Closing |

## 23. Testing
- **Device:** set Orma as the default assistant → long-press power while locked → speak → dashboard updates in under 3 s.
- **Phrases:** every row in the appendix. An unclear speaker must trigger a question, a double log must be blocked, and a question with no record must give the Unknown reply.
- **XAI:** every highlighted span appears in the transcript, and an invented span is dropped (unit test). "Why?" on each of the 5 statuses gives the correct trail. Risk contributions add up to the logit (unit test).
- **FL:** the simulator shows FL within a few % of centralised training and better than local-only. `flSubmit` rejects updates that are too large or for the wrong version. Aggregation waits for at least K clients.
- **Calls:** press 1 / press 2 → retry; no answer → 2 retries → Unknown; dose already logged → no call; missed call → rejected → callback.
- **Independent mode:** no sound or voice; ✓ from the notification logs the dose; refill alert fires.
- **Offline:** airplane mode → log by icon → guard still works → syncs when back online.
- **Accessibility:** a full run with only TalkBack, with sound off, with icons only, and at the largest font. Fast double taps must be ignored. Accessibility Scanner must show no errors.
- **Tiers:** on a 1–2 GB emulator, T2 is chosen and the core flow is smooth.

## 24. Privacy and ethics
- **The elder owns the data:** the elder controls sharing (§5.5). A guardian takes over only with a recorded capacity note.
- **Consent:**
  - In the app at setup; for keypad members, through the consent call.
  - **Taking part in FL is opt-in** (`consent.fl`).
  - Nurses see only their assigned patients, and access can be revoked at any time.
- **Data minimisation:**
  - Raw audio is deleted after processing, unless it's a message.
  - No location tracking.
  - Sensitive behaviour signals stay on the phone; only weight updates with noise added leave it.
  - FL update documents are readable by the server only.
- **Not a medical device:** Orma never changes doses or recommends medicines. Medicine information comes only from what the family entered. Urgent messages point to 108 and the family; Orma is not an emergency service. Risk is labelled "prediction" and never used as a fact.
- **Explainable by default:** every automated decision (status, alert, risk) has a reason the user can view.
- **Security:** Firestore rules per role, API keys only on the server, App Check, encryption in transit and at rest.
- **Regulation (production):** DPDP Act 2023 (India's data protection law); TRAI DLT registration for automated calls and SMS.

## 25. Risks
| Risk | Mitigation |
|---|---|
| Power-button assistant behaves differently by brand | **Test the demo phone in the first 20 minutes.** Fallbacks: Samsung side-key double-press, corner-swipe gesture, Glance widget, persistent notification |
| Gemini misreads dialect | Schema + evidence-span check + follow-up question + OpenAI fallback + icon mode |
| Network fails during the demo | Offline tier + backup video + mobile hotspot |
| **Twilio trial:** verified numbers only, a "trial" message + key press before every call, India geo permission needed | Verify all demo numbers in advance; turn on India Geo Permissions; mention the trial message on stage ("production uses Exotel") |
| Twilio webhooks need a public URL | Agent 2 deploys the telephony functions to the real project early |
| Android 14+ blocks exact alarms by default | Request permission during setup; FCM push from the server as a backup |
| No Malayalam TTS voice on the phone | Captions + pre-generated MP3s |
| Too little real data for FL | Simulator with 30 synthetic families; we say clearly that it's a simulation + one live round |
| **Self-report may be wrong** (memory decline) | Records are labelled with how strong the evidence is: photo-verified > nurse > self-report. Pill-box photo check for high-risk slots. The answer says *how* we know ("you told me at 8:15") |
| **"Already exists" (Medisafe, 99DOTS)** | §2.1 comparison table; lead the pitch with what only Orma does: conversational GenAI on keypad phones + grounded cited answers |
| **GenAI hallucination** in answers, prescriptions or summaries | Citation check on every sentence; no medicine names that aren't in the fact pack; caregiver confirms every prescription line; template fallback |
| **Handwritten prescription misread** | Confidence per line + box drawn on the photo + mandatory confirmation; low-confidence lines are never added |
| **Call turns too slow** | "Shari…" ("Okay…") filler, pre-generated common replies, Flash model, 4 s budget → fall back to key presses |
| **Surveillance / dignity** | The elder owns the data, can toggle sharing by voice, supporter wording, guardian only with a recorded capacity note |
| **Scope is very large (team chose to keep everything)** | Strict P0 → P1 → P2 order; feature freeze at C3; fallback table in worksplit §7; backup video |
| Caregivers get too many alerts | Duty roster, alerts only for problems, risk alerts optional |
| A wrong "taken" log | The caregiver can correct it with a reason; the evidence trail shows who logged it and how |

## 26. Impact measures
- Doses with a known status above 95% (Unknown below 5%).
- Number of double-dose attempts blocked.
- Time from alert to acknowledgement.
- Fewer "did you take it?" calls (caregivers report this themselves).
- How doses are logged: voice / tap / call (shows that every group is included).
- How often "Why?" is opened, and how often a log is corrected after viewing it (trust and correctness).
- Missed-dose rate before vs. after risk-based nudges.
- Pilot: 20 families in one panchayat (village council area), onboarded through Akshaya centres (Kerala's government e-service centres).

## 27. Roadmap
1. Pilot with Akshaya centres and ASHA workers (community health workers).
2. Exotel + DLT for production calls and SMS.
3. FL in production with **Flower**, secure aggregation, and formal differential-privacy accounting.
4. iOS caregiver app using **Kotlin Multiplatform** (shares the domain logic).
5. Monthly adherence report for the doctor.
6. Beyond medicine: gate, gas, meals.
7. Partnerships: pharmacies (refill → home delivery), PHCs (primary health centres), palliative care networks.
8. More languages: Tamil, Kannada, Hindi.

## Appendix: Malayalam phrases
| Phrase | Meaning | Action |
|---|---|---|
| Raavile marunnu kazhichu | Took my morning medicine | Log morning ✅ |
| Raavile 3 gulika kazhichu | Took 3 tablets this morning | Log with count; check against prescription |
| BP-de mathram kazhichu | Took only the BP one | Log that one; 🟡 |
| Njangal randuperum kazhichu | Both of us took it | Log for all members on this phone |
| Achan kazhichu, Amma kazhichilla | Father took it, Mother didn't | Log separately for each |
| Kazhichu (shared phone) | Took it | **Ask** who |
| Njan gulika kazhicho? | Did I take my tablet? | Never-guess answer |
| Enthaa angane? | Why is that? | Spoken "Why?" explanation |
| Kazhichittilla, chorunnittilla | Haven't taken it, haven't eaten yet | Snooze until after the meal |
| Ee gulika enthinaa? | What is this tablet for? | Answer only from entered data |
| Nurse-nodu parayu… | Tell the nurse… | Message + translation |
| Anu-ve vilikkan parayu | Ask Anu to call me | Callback alert |
| Nenju vedana / veenu | Chest pain / I fell | 🔴 Urgent + suggest 108 |
