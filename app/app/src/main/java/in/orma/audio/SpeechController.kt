package `in`.orma.audio

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.core.content.ContextCompat
import java.util.Locale

enum class SpeechState { Idle, Starting, Listening, Processing }
enum class SpeechIssue { Permission, Unavailable, Language, Network, NoSpeech, Busy, Muted, Timeout }

class SpeechController(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null
    private var ready = false
    private var generation = 0
    private var pendingFinish: (() -> Unit)? = null
    private var speechFinished: (() -> Unit)? = null
    private val handler = Handler(Looper.getMainLooper())
    private val tts = TextToSpeech(context) { ready = it == TextToSpeech.SUCCESS }

    fun listen(languageTag: String, onResult: (String) -> Unit, onError: (SpeechIssue) -> Unit,
        onState: (SpeechState) -> Unit, onLevel: (Float) -> Unit, onPartial: (String) -> Unit) {
        stop()
        val attempt = ++generation
        fun fail(issue: SpeechIssue) {
            if (attempt != generation) return
            generation++
            handler.removeCallbacksAndMessages(null)
            pendingFinish = null
            recognizer?.cancel()
            onState(SpeechState.Idle)
            onError(issue)
            Log.i("OrmaSpeech", "ended issue=$issue language=$languageTag")
        }
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            fail(SpeechIssue.Permission); return
        }
        if (context.getSystemService(AudioManager::class.java).isMicrophoneMute) {
            fail(SpeechIssue.Muted); return
        }
        val component = externalRecognizer(context)
        if (component == null) { fail(SpeechIssue.Unavailable); return }
        onState(SpeechState.Starting)
        try {
            recognizer = SpeechRecognizer.createSpeechRecognizer(context, component).also { speech ->
                speech.setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        if (attempt == generation) {
                            onState(SpeechState.Listening)
                            Log.i("OrmaSpeech", "ready engine=${component.flattenToShortString()} language=$languageTag")
                        }
                    }
                    override fun onResults(results: Bundle?) {
                        if (attempt != generation) return
                        generation++
                        pendingFinish = null
                        handler.removeCallbacksAndMessages(null)
                        onState(SpeechState.Idle)
                        val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                        Log.i("OrmaSpeech", "result characters=${text?.length ?: 0} language=$languageTag")
                        if (text.isNullOrBlank()) onError(SpeechIssue.NoSpeech) else onResult(text)
                    }
                    override fun onError(error: Int) = fail(when (error) {
                        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> SpeechIssue.Permission
                        SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> SpeechIssue.Network
                        SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE -> SpeechIssue.Language
                        SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_AUDIO -> SpeechIssue.Busy
                        else -> SpeechIssue.NoSpeech
                    })
                    override fun onBeginningOfSpeech() { if (attempt == generation) onState(SpeechState.Listening) }
                    override fun onRmsChanged(rmsdB: Float) { if (attempt == generation) onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f)) }
                    override fun onBufferReceived(buffer: ByteArray?) {}
                    override fun onEndOfSpeech() { if (attempt == generation) onState(SpeechState.Processing) }
                    override fun onPartialResults(partialResults: Bundle?) {
                        if (attempt == generation) onPartial(partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty())
                    }
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
                pendingFinish = { if (attempt == generation) { onState(SpeechState.Processing); speech.stopListening() } }
                speech.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, languageTag)
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    // Let the configured engine use its available online/offline language model.
                })
                handler.postDelayed({ if (attempt == generation) fail(SpeechIssue.Timeout) }, 15_000)
            }
        } catch (_: SecurityException) { fail(SpeechIssue.Permission) }
        catch (_: RuntimeException) { fail(SpeechIssue.Unavailable) }
    }

    /** Finish captured words; cancellation is reserved for leaving the screen. */
    fun finishListening() { pendingFinish?.invoke() }

    fun speak(languageTag: String, malayalam: String, english: String, onDone: (() -> Unit)? = null): Boolean {
        if (!ready) return false
        val text = if (languageTag.startsWith("ml")) malayalam else english
        if (text.isBlank()) return false
        val language = tts.setLanguage(Locale.forLanguageTag(languageTag))
        if (language == TextToSpeech.LANG_MISSING_DATA || language == TextToSpeech.LANG_NOT_SUPPORTED) return false
        tts.setSpeechRate(0.8f)
        speechFinished = onDone
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String?) { Log.i("OrmaSpeech", "spoken prompt started language=$languageTag") }
            override fun onDone(utteranceId: String?) { handler.post { val callback = speechFinished; speechFinished = null; callback?.invoke() } }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String?) { handler.post { val callback = speechFinished; speechFinished = null; callback?.invoke() } }
        })
        return tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "orma-reply") == TextToSpeech.SUCCESS
    }

    fun stop() {
        speechFinished = null
        generation++
        pendingFinish = null
        handler.removeCallbacksAndMessages(null)
        recognizer?.cancel()
        recognizer?.destroy()
        recognizer = null
        tts.stop()
    }
    fun close() { stop(); tts.shutdown() }
}

/** Prefer the phone's configured dictation engine, never another assistant or ourselves. */
fun externalRecognizer(context: Context): ComponentName? {
    val services = context.packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
        .filter { it.serviceInfo.packageName != context.packageName && it.serviceInfo.exported }
        .map { ComponentName(it.serviceInfo.packageName, it.serviceInfo.name) }
    val preferred = Settings.Secure.getString(context.contentResolver, "voice_recognition_service")
        ?.let(ComponentName::unflattenFromString)
    return preferred?.takeIf { it in services }
        ?: services.firstOrNull { it.packageName == "com.google.android.tts" }
        ?: services.firstOrNull { it.packageName == "com.google.android.googlequicksearchbox" }
        ?: services.firstOrNull { component -> context.packageManager.getApplicationInfo(component.packageName, 0).flags and android.content.pm.ApplicationInfo.FLAG_SYSTEM != 0 }
}
