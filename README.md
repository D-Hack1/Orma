# Orma (ഓർമ)
> **An AI medicine companion for every member of a Kerala family — on whatever phone they own.**  
> *BIA GenAI Hackathon 2026 · Challenge: AI for Inclusive Kerala*

[![Platform: Android](https://img.shields.io/badge/Platform-Android%208.0%2B%20(API%2026%2B)-3DDC84?logo=android&logoColor=white)](app/)
[![Backend: Firebase Node 22](https://img.shields.io/badge/Backend-Firebase%20%7C%20Node%2022%20%7C%20TS-FFCA28?logo=firebase&logoColor=black)](backend/)
[![AI: Gemini on Vertex AI](https://img.shields.io/badge/GenAI-Gemini%20Flash%20%26%20Pro-4285F4?logo=google&logoColor=white)](contracts/)
[![ML: Federated Learning](https://img.shields.io/badge/Privacy-Federated%20Learning%20(FedAvg)-9C27B0)](ml/)
[![Language: Malayalam & Manglish](https://img.shields.io/badge/Language-Malayalam%20%2B%20Manglish-E91E63)](contracts/phrases.json)

---

## 💡 The Problem & The Vision

In Kerala, millions of elderly parents live at home while their children work in the Gulf, in other states, or overseas. Every day brings the same worried question: **"Did you take your medicine?"**
* **The Danger:** Forgetting leads to missed doses or hazardous **accidental double doses** of blood pressure and diabetic medications.
* **The Digital Divide:** Existing apps demand English fluency, small screen taps, and modern smartphones. Many rural elders only own a **₹1,000 keypad phone** or have vision, hearing, motor, or memory limitations.
* **The Privacy Risk:** Cloud health apps centralize sensitive cognitive decline indicators (like hesitation and repeated "did I take it?" questions).

**Orma** eliminates all these barriers:
1. **Zero-Friction Access:** Long-press the phone's physical power button and speak Malayalam—even on the lock screen. On a basic keypad phone, simply answer an automated phone call and speak naturally.
2. **"Never-Guess" Safety Engine:** Every generated answer is grounded in factual records and must cite verified sources. If records are absent or unclear, Orma never hallucinates—it falls back to a deterministic safety response and alerts the on-duty caregiver.
3. **Dignity & Privacy First:** Elders own their data and control sharing by voice. Sensitive behavioural signals stay on-device via **Federated Learning**.
4. **Explainable AI throughout:** Every answer, alert, and risk prediction includes a clear **"Why?"** showing exact evidence spans and model contributions.

---

## 👥 Personas & Adaptive Roles

Orma dynamically adapts its UI, audio, and alerts across 4 specialized account modes:

| Persona | Role & Mode | Device | Core Experience |
|---|---|---|---|
| **Achan** (78, Kottayam) | 🧓 **Assisted Member** | Android Go / Shared | Physical power button trigger, huge high-contrast buttons, slow Malayalam voice replies, double-dose protection. |
| **Amma** (72, Kottayam) | 🧓 **Assisted Member** | Shared Android | Spoken reassurance to *"Did I take it?"*, group logging (*"Both of us took morning medicines"*), voice-controlled privacy. |
| **Ammoomma** (90, Idukki) | 📞 **Keypad Phone** | Feature Phone (T4) | Conversational IVR phone calls at dose times; press-or-speak responses; missed-call free callback service. |
| **Anu** (38, Dubai) | 👨‍👩‍👧 **Lead Supporter** | Android | Remote live family tree, smart duty roster, prescription camera scanner, alerts only when doses are missed or double-dosed. |
| **Rahul** (34, Bangalore) | 👨‍👩‍👧 **Co-Caregiver / Self** | Android | Shares caregiver duty with Anu; manages his own quiet reminders as an independent user via the header role-switcher. |
| **Sister Mini** | 🩺 **Home Nurse** | Android | Shift-scoped patient view (Achan & Amma only), "Given by nurse" logging, vitals recording (e.g. BP), Malayalam ↔ English notes. |
| **Farhan** (29, Kochi) | 🙋 **Independent** | Android | Deaf, Type-1 diabetic; silent actionable notifications, Glance widgets, completely unlinked private health namespace. |

---

## 🚀 Core Features

```
┌───────────────── LOG OR ASK ─────────────────┐      ┌───────────── ACTIONABLE VIEWS ────────────┐
│ • Power button hold → speak Malayalam        │      │ • Live Family Tree & Duty Escalation      │
│ • Lock screen / Glance widget / Quick Actions│      │ • Assigned Nurse Roster & Vitals Log      │
│ • Conversational Keypad Call (Twilio/Exotel) │ ───► │ • Grounded Answers with Evidence "Why?"   │
│ • Handwritten Prescription Scan (Gemini OCR) │      │ • Cited Doctor PDF & Family Daily Digests │
│ • Nurse / Caregiver proxy logging            │      │ • Low Stock & Refill Alerts (7/4/2 days)  │
└──────────────────────────────────────────────┘      └───────────────────────────────────────────┘
```

* **Long-Press Power Button Assistant:** Registers as Android's default digital assistant (`ROLE_ASSISTANT` + `VoiceInteractionService`) with `setShowWhenLocked`, launching instantly without unlocking the phone.
* **Bilingual Malayalam/Manglish Understanding:** Vertex AI Gemini Flash extracts structured intent, dose slots, counts, and exact substring **evidence spans** from speech. Conservative on-device keyword matcher serves as an instant offline fallback.
* **Handwritten Prescription & Strip Scanner (Gemini Vision):** Caregivers photograph handwritten doctor scripts or printed discharge sheets. Gemini extracts medications, strengths, dosages (e.g., `1-0-1`), and timings with bounding boxes on the image for human verification. Medicine-strip checks match only against confirmed prescriptions.
* **Conversational Phone Calls for Keypad Devices:** Keypad users receive automated calls at dose times that speak in Malayalam, listen to spoken replies, verify dose status, and support DTMF backup (e.g., Press 1 = Taken).
* **"Parayu" (Tell) Family Messaging & Emergency Triage:** Spoken notes to caregivers or nurses. If critical distress keywords appear (e.g., chest pain, fall, breathing trouble), Orma immediately triggers high-priority alerts with an emergency 108 ambulance prompt.
* **Explainable Missed-Dose Risk:** An interpretable linear model calculates missed-dose risk using exact SHAP-equivalent contributions ($w_i \cdot (x_i - \bar{x}_i)$), highlighting factors such as missed weekend doses or nurse shift changes.
* **Federated Learning (FedAvg):** On-device training runs via `WorkManager` (only when idle, charging, and on Wi-Fi). Raw cognitive signals remain strictly on the phone; only clipped and noised weight deltas ($\Delta w$) are aggregated.

---

## 🛡️ The "Never-Guess" Safety Architecture

Health companions must never hallucinate. Orma enforces a strict, multi-tiered safety rule:

1. **Fact Pack Compilation:** Cloud Functions assemble an allowlisted fact pack containing only relevant, authorized records.
2. **Constrained Generation:** Gemini is constrained to answer solely from these facts and return citations (`sentences[{text, cites: [id]}]`).
3. **Server-Side Verification:** Cloud Functions validate that every sentence cites valid facts, numbers/times match records, and no unapproved medications appear.
4. **Deterministic Fail-Closed Fallback:** If citations are invalid or facts are missing, Orma returns a fixed, deterministic bilingual template (e.g., *"I'm not sure. Please wait before taking another dose."*) and escalates to the on-duty caregiver.

```
       Member asks: "Did I take my morning tablet?"
                            │
               Fact Pack Compiled (Firestore)
                            │
              Gemini Generates Cited Answer
                            │
            ┌───────────────┴───────────────┐
      [Valid Citations]             [Missing / Mismatch]
            │                               │
  "Yes, 2 tablets at 8:15 AM."     FAIL-CLOSED DETERMINISTIC TEMPLATE:
  (Cites: D1 | Why: Voice log)      "I'm not sure. Please wait..."
                                   + Alert sent to Anu on duty
```

---

## 🏗️ Repository Architecture

The monorepo is cleanly separated into specialized modules:

```
Orma/
├── app/                   # Native Android Application (Kotlin, Jetpack Compose)
│   ├── app/src/main/      # UI, Navigation, Assistant Service, Hilt DI, Data layer
│   ├── tools/             # Emulator check and build validation scripts
│   └── README.md          # Android setup, APK build instructions & demo guide
│
├── backend/               # Cloud Functions (Firebase 2nd Gen, Node 22, TypeScript)
│   ├── functions/src/     # Gemini AI adapters, telephony, doses, rules, FL aggregator
│   ├── firestore.rules    # Strict zero-leakage security rules & viewer projections
│   ├── storage.rules      # Authenticated media and upload storage rules
│   ├── seed/              # Deterministic synthetic test family seed fixtures
│   └── README.md          # Local emulator setup, testing, and deployment guide
│
├── contracts/             # Shared API & Data Specifications
│   ├── schema.md          # Canonical Firestore schema & viewer-projection rules
│   ├── api.md             # Complete callable endpoints and request/response examples
│   ├── understand.schema  # Gemini structured JSON output schema with evidence spans
│   ├── phrases.json       # 16 standard Malayalam/Manglish test phrases & intents
│   ├── replies.json       # 31 deterministic bilingual safety templates
│   └── risk-features.md   # Ordered 10-feature definitions for risk & FL model
│
├── ml/                    # Federated Learning Simulator & Python Artifacts
│   ├── fl_simulator.py    # 30-family, 10-round reproducible FedAvg simulation
│   ├── synth_families.py  # Realistic adherence & habit generation engine
│   ├── out/               # Initial model (initial_model.json) & FL benchmark plot
│   └── README.md          # Experiment methodology and benchmark analysis
│
├── plan.md                # Master engineering specification & domain deep-dive
├── STATUS.md              # Global project progress and verification ledger
└── worksplit.md           # Team roles and parallel agent coordination protocol
```

---

## 💻 Tech Stack

| Layer | Technologies | Justification |
|---|---|---|
| **Android Client** | Kotlin 2.x, Jetpack Compose, Material 3, Hilt, Coroutines & Flow | Google-standard architecture; native accessibility semantics; smallest footprint on Android Go phones. |
| **System Integration** | `VoiceInteractionService`, `RoleManager` (`ROLE_ASSISTANT`), `AlarmManager`, Jetpack Glance | True lock-screen hardware assistant invocation and battery-efficient exact alarms. |
| **Backend & Cloud** | Firebase Cloud Functions (Node 22, TypeScript), Firestore, Storage, Cloud Tasks | Native offline synchronization, low-latency Mumbai deployment (`asia-south1`), and real-time security rules. |
| **Generative AI** | Google Gemini Flash & Gemini Pro on Vertex AI (`@google/genai`) | Direct audio understanding, strong Malayalam code-mix support, image OCR for prescriptions, and schema-constrained JSON outputs. |
| **Telephony & Speech** | Twilio TwiML / Exotel interface, Google Cloud TTS (Malayalam `ml-IN`), Android `SpeechRecognizer` | Keypad phone accessibility, reliable IVR turn handling, and offline-capable on-device speech fallback. |
| **On-Device ML** | Pure Kotlin Logistic Regression + Python 3.12 ML Simulator (NumPy, Scikit-learn) | Ultra-lightweight on-device training via FedAvg without heavyweight native binary bloat. |

---

## ⚡ Quick Start

### 1. Android Application
* **Prerequisites:** Android Studio Ladybug/Meerkat, JDK 17+, Android SDK Platform 36.
```powershell
cd app
# Assemble debug APK and run unit tests
./gradlew.bat :app:assembleDebug :app:testDebugUnitTest

# Install to connected device or emulator
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
*To test assistant invocation from lock screen:*
```powershell
adb shell am start -a android.intent.action.ASSIST -n in.orma/.assistant.AssistActivity
```

### 2. Backend & Emulators
* **Prerequisites:** Node.js 22+, Java 21+ (for Firestore/Storage emulators).
```bash
cd backend/functions
npm ci
npm run build
npm test              # Run 370+ unit & integration tests
npm run test:rules    # Run Firestore & Storage security rules tests

# Start emulators on loopback (Auth: 9099, Firestore: 8080, Functions: 5001)
npm run emulators

# In a separate terminal, seed the synthetic demo family:
export GCLOUD_PROJECT=demo-orma
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
npm run seed
```

### 3. Federated Learning Simulator
* **Prerequisites:** Python 3.12+.
```bash
cd ml
python -m venv .venv
source .venv/bin/activate   # On Windows: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python fl_simulator.py      # Generates model artifacts in ml/out/
python -m unittest discover -s . -p "test_*.py" -v
```

---

## 🧪 Current Verification Status

* **Android Client (`app/`):** Debug APK builds with zero lint errors; tested and verified on physical **Google Pixel 6a** (Android 15) and Android API 37 emulators. Hardware power-button long-press from locked state launches the Malayalam Speak UI.
* **Backend Platform (`backend/`):** 372 unit tests and 16 security rules tests passing. Deterministic seed/reset writes 1,046 Firestore documents. Transactional stock tracking, caller authentication, and projection filtering verified against unauthorized field leakage.
* **Contracts & Safety (`contracts/`):** Contract check script (`python contracts/check.py`) passes 100% across all 28 API examples, phrase fixtures, and bilingual templates.
* **Federated Learning (`ml/`):** 10-round benchmark simulation completed across 30 families; initial model exported to `ml/out/initial_model.json`.

---

## 🔒 Privacy & Ethical Commitments

* **Dignity Over Surveillance:** Orma's UI explicitly uses the term *"supporters"*, never *"monitors"*. Summaries state what was taken, never patronizing failure language.
* **Elder-Controlled Visibility:** Medication counts, risk scores, and message logs remain private by default unless the elder explicitly enables them by voice.
* **Zero Medical Hallucination:** Orma never prescribes or changes dosages. All prescription schedules require explicit human confirmation.
* **Data Locality:** Cloud services are hosted within India (`asia-south1` Mumbai) to comply with Indian data protection norms.

---

## 📜 License & Acknowledgments

Developed for the **BIA GenAI Hackathon 2026** under the theme **AI for Inclusive Kerala**.  
Built with Kotlin, Jetpack Compose, Firebase, Google Vertex AI, and Gemini.
