# Orma Android

Open this directory in Android Studio. The application ID is `in.orma`, minimum Android 8 (API 26), compile/target API 36. Java 17 is required.

```powershell
./gradlew.bat :app:assembleDebug :app:testDebugUnitTest
adb devices -l
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n in.orma/.MainActivity
./gradlew.bat :app:connectedDebugAndroidTest
```

On another machine, install SDK Platform 36 and set `ANDROID_HOME` or create an untracked `local.properties` with `sdk.dir=C:/path/to/Android/Sdk`.

## Current build

This is an explicitly labelled **local demo**, using `StubOrmaApi`. It does not send alerts, place calls, authenticate people, or synchronise between devices. Demo tablet counts are sample values, not a real prescription. Records persist on this emulator/phone; reinstalling with `-r` preserves them.

Try the Supporter, Assisted, Independent, and Nurse roles using the header. The family dashboard excludes Farhan, who has no family link. The nurse list includes only Achan and Amma. Sharing controls are shown only in the Assisted role; role switching is a demo facility, not authentication.

The Speak screen tries Android Malayalam speech recognition, with text/tap fallback if the service or language is missing. Only the exact sample phrases in `app/src/main/assets/demo-fixture.json` are understood in this version. A recognised log asks for confirmation; incomplete or unfamiliar text does not log anything. Use the large member, slot and count controls for arbitrary entries.

Local dose writes are serialised and persisted before success is reported. A partial record also blocks a subsequent log until an explicit reconciliation workflow exists. No record produces an explicit unknown answer. Every positive status answer cites its saved record ID. Sharing defaults hide counts in supporter/nurse cards and explanations.

## Assistant check

Use Settings → Set Orma as digital assistant. Test the phone's assistant gesture and long-press power while locked. `AssistActivity` also provides an `ACTION_ASSIST` fallback. OEM power-button behaviour needs a real phone test; an emulator invocation alone does not prove it.

```powershell
adb shell am start -a android.intent.action.ASSIST -n in.orma/.assistant.AssistActivity
```

Microphone permission is requested when the Speak screen first opens. Captions and taps remain usable if it is denied. Malayalam TTS is attempted, with English fallback where the voice is missing. A native Malayalam speaker still needs to review the wording and audio.

## Backend handoff

`contracts/` is currently empty. The local models and fixtures follow the summary in `plan.md` §18–19 and must be reconciled with Agent Two's published contracts. `FirebaseCallableTransport` is an unbound transport helper; a complete Firebase `OrmaApi` adapter, authenticated listeners, Firebase options, App Check configuration and endpoint contract tests remain pending. Firebase SDKs are included without a `google-services.json`, so the local demo starts without cloud configuration. Do not enable a live binding until these pieces are ready.

Progress, verification results and remaining tasks are in [STATUS.md](STATUS.md). Shared plans, contracts and backend files are owned by the other work streams.
