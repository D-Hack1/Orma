# Orma Android

Open this directory in Android Studio. The application ID is `in.orma`, minimum Android 8 (API 26), compile/target API 36. Java 17 is required.

```powershell
./gradlew.bat :app:assembleDebug :app:testDebugUnitTest
adb devices -l
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n in.orma/.MainActivity
./gradlew.bat :app:connectedDebugAndroidTest
```

For a repeatable install, device smoke test and screenshot, run `./tools/check-emulator.ps1 -Build -DeviceTests`. On this machine, use `./tools/check-emulator.ps1 -Build -DeviceTests -BuildRoot U:/orma-build-cache/build -GradleHome U:/orma-build-cache` to keep generated output, Gradle caches and process-local temporary files on U:. The script restores temporary-directory environment variables when it finishes; no global settings change. Device tests grant this demo app microphone permission and create sample dose records.

If Windows blocks local scripts, invoke it with a process-only policy: `powershell -NoProfile -ExecutionPolicy Bypass -File ./tools/check-emulator.ps1 -Build -DeviceTests -BuildRoot U:/orma-build-cache/build -GradleHome U:/orma-build-cache`. This leaves the machine's execution policy unchanged.

On another machine, install SDK Platform 36 and set `ANDROID_HOME` or create an untracked `local.properties` with `sdk.dir=C\:/path/to/Android/Sdk`.

## Current build

This is an explicitly labelled **local demo**, using `StubOrmaApi`. It does not send alerts, place calls, authenticate people, or synchronise between devices. Demo tablet counts are sample values, not a real prescription. Records persist on this emulator/phone; reinstalling with `-r` preserves them.

Try the Supporter, Assisted, Independent, and Nurse roles using the header. The family dashboard excludes Farhan, who has no family link. The nurse list includes only Achan and Amma. Sharing controls are shown only in the Assisted role; role switching is a demo facility, not authentication.

Use the header language button to switch between English and Malayalam. The selection persists across restarts and applies to interface text, local record replies, new notifications, speech recognition and spoken replies. A missing Malayalam voice produces captions rather than an automatic English spoken reply. Original user transcripts and canonical record IDs retain their original content.

Both language resource sets are included in bundles (`enableSplit = false`), so interface switching does not require downloading another language pack. Android's speech engine may separately require a language model or network access. The Pixel speech-to-caption test has been confirmed by the user in both languages; native-speaker review of all authored Malayalam UI/TTS remains pending.

Primary and choice buttons are at least 88dp high; the microphone is 184dp high and dose targets are at least 112dp. Member/slot choices and confirmation actions use full-width layouts. Assistant setup shows the actual selected service, rechecks it when returning from Android and exposes a direct settings fallback. It does not claim success merely because the picker opened.

The Speak screen uses Android speech recognition in the selected language, with text/tap fallback if the service or language is missing. It prefers Android's configured dictation engine and excludes Orma itself. Starting/listening/processing states, partial captions and a sound-level indicator make recording visible. Tapping the listening button finalizes captured speech; leaving the screen cancels it. Sample phrases are localized; provisional fixtures live in `app/src/main/assets/demo-fixture.json`. The conservative offline matcher requires explicit member/slot/count/taken words, rejects negative/conflicting statements and asks for missing details. A recognised log requires confirmation; unfamiliar text never writes a record. Speech has a 15-second timeout and ignores callbacks from older attempts.

Local dose writes are serialised and persisted before success is reported. A partial record also blocks a subsequent log until an explicit reconciliation workflow exists. No record produces an explicit unknown answer. Every positive status answer cites its saved record ID. Sharing defaults hide counts in supporter/nurse cards and explanations.

Independent mode includes a silent sample notification with Taken and Later (30 minutes) actions. The Taken action persists the sample dose without opening an activity and applies the same duplicate guard. There is also a one-minute sample alarm and Android's exact-alarm permission setup; without permission Android may delay the alarm. These are demo controls, not a configured daily prescription schedule. Reboot restoration, due-dose scheduling from confirmed prescriptions and reason-specific snoozes remain pending.

## Assistant check

Use Settings → Set Orma as digital assistant. Test the phone's assistant gesture and long-press power while locked. `AssistActivity` also provides an `ACTION_ASSIST` fallback. OEM power-button behaviour needs a real phone test; an emulator invocation alone does not prove it.

```powershell
adb shell am start -a android.intent.action.ASSIST -n in.orma/.assistant.AssistActivity
```

Microphone permission is requested when the Speak screen first opens. Captions and taps remain usable if it is denied. Malayalam TTS is attempted, with English fallback where the voice is missing. A native Malayalam speaker still needs to review the wording and audio.

## Backend handoff

Contracts v1 and `backend/AGENT1_HANDOFF.md` are now available. The Android local models/fixtures still need reconciliation: mandatory familyId, members/count/clarifyQuestion names, nested evidence, authenticated actors and privacy-filtered listener paths differ from the stub. `FirebaseCallableTransport` remains unbound. The real `OrmaApi` adapter, authenticated listeners and cross-device contract tests are pending. The backend handoff documents local emulator configuration; live Firebase options, phone OTP and App Check still require project setup. The current local demo starts without cloud configuration. Do not enable a live binding until these pieces are ready.

Progress, verification results and remaining tasks are in [STATUS.md](STATUS.md). Shared plans, contracts and backend files are owned by the other work streams.
