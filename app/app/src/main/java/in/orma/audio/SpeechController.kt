package `in`.orma.audio

import android.content.Context
import android.content.Intent
import android.content.ComponentName
import android.speech.RecognitionService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import java.util.Locale

class SpeechController(private val context: Context) {
    private var recognizer: SpeechRecognizer? = null
    private var ready = false
    private var generation = 0
    private val handler = Handler(Looper.getMainLooper())
    private val tts = TextToSpeech(context) { ready = it == TextToSpeech.SUCCESS }

    fun listen(onResult: (String) -> Unit, onError: (String) -> Unit, onListening: () -> Unit) {
        val attempt = ++generation
        handler.removeCallbacksAndMessages(null)
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            onError("Speech recognition is unavailable on this phone. Use the large buttons or type below.")
            return
        }
        recognizer?.destroy()
        val component = externalRecognizer(context)
        if (component == null) {
            onError("No speech engine is installed. You can use the buttons below.")
            return
        }
        recognizer = SpeechRecognizer.createSpeechRecognizer(context, component).also { speech ->
            speech.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { if (attempt == generation) onListening() }
                override fun onResults(results: Bundle?) {
                    if (attempt != generation) return
                    generation++
                    handler.removeCallbacksAndMessages(null)
                    val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                    if (text.isNullOrBlank()) onError("I didn't hear that. Please try again or use the buttons.") else onResult(text)
                }
                override fun onError(error: Int) {
                    if (attempt != generation) return
                    generation++
                    handler.removeCallbacksAndMessages(null)
                    onError(when (error) {
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission is needed. You can still use the buttons."
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Speech needs a connection on this phone. You can use the buttons offline."
                    else -> "I couldn't hear clearly. Please try again or use the buttons."
                    })
                }
                override fun onBeginningOfSpeech() {}
                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}
                override fun onEndOfSpeech() {}
                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })
            speech.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ml-IN")
                putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            })
            handler.postDelayed({
                if (attempt == generation) {
                    generation++
                    speech.cancel()
                    onError("Listening stopped after 15 seconds. Please try again or use the buttons.")
                }
            }, 15_000)
        }
    }

    fun speak(malayalam: String, english: String) {
        if (!ready) return
        val language = tts.setLanguage(Locale.forLanguageTag("ml-IN"))
        val mlAvailable = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED
        if (!mlAvailable) tts.language = Locale.ENGLISH
        tts.setSpeechRate(0.8f)
        tts.speak(if (mlAvailable && malayalam.isNotBlank()) malayalam else english, TextToSpeech.QUEUE_FLUSH, null, "orma-reply")
    }

    fun stop() { generation++; handler.removeCallbacksAndMessages(null); recognizer?.cancel(); tts.stop() }
    fun close() { stop(); recognizer?.destroy(); tts.shutdown() }
}

/** Exclude our assistant adapter so it can never recursively bind to itself. */
fun externalRecognizer(context: Context): ComponentName? =
    context.packageManager.queryIntentServices(Intent(RecognitionService.SERVICE_INTERFACE), 0)
        .firstOrNull { it.serviceInfo.packageName != context.packageName }?.serviceInfo?.let {
            ComponentName(it.packageName, it.name)
        }
