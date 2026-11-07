package `in`.orma.assistant

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognitionService
import android.speech.SpeechRecognizer
import `in`.orma.audio.externalRecognizer

/** Assistant registration requires a real recognition service; delegate to an installed engine. */
class OrmaRecognitionService : RecognitionService() {
    private var delegate: SpeechRecognizer? = null
    override fun onStartListening(intent: Intent, callback: Callback) {
        val component = externalRecognizer(this)
        if (component == null) { callback.error(SpeechRecognizer.ERROR_CLIENT); return }
        delegate?.destroy()
        delegate = SpeechRecognizer.createSpeechRecognizer(this, component).also { speech ->
            speech.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) { callback.readyForSpeech(params ?: Bundle()) }
                override fun onBeginningOfSpeech() { callback.beginningOfSpeech() }
                override fun onRmsChanged(rmsdB: Float) { callback.rmsChanged(rmsdB) }
                override fun onBufferReceived(buffer: ByteArray?) { if (buffer != null) callback.bufferReceived(buffer) }
                override fun onEndOfSpeech() { callback.endOfSpeech() }
                override fun onError(error: Int) { callback.error(error) }
                override fun onResults(results: Bundle?) { callback.results(results ?: Bundle()) }
                override fun onPartialResults(partialResults: Bundle?) { callback.partialResults(partialResults ?: Bundle()) }
                override fun onEvent(eventType: Int, params: Bundle?) { }
            })
            speech.startListening(intent)
        }
    }
    override fun onStopListening(callback: Callback) { delegate?.stopListening() }
    override fun onCancel(callback: Callback) { delegate?.cancel() }
    override fun onDestroy() { delegate?.destroy(); super.onDestroy() }
}
