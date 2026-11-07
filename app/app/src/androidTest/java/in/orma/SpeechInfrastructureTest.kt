package `in`.orma

import android.content.ComponentName
import android.provider.Settings
import androidx.test.platform.app.InstrumentationRegistry
import `in`.orma.audio.externalRecognizer
import org.junit.Assert.*
import org.junit.Test

class SpeechInfrastructureTest {
    @Test fun configuredDictationEngineIsSelectedInsteadOfFirstListedService() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val selected = externalRecognizer(context)
        assertNotNull("An external speech recognizer must be available on the QA device", selected)
        assertNotEquals(context.packageName, selected?.packageName)
        val configured = Settings.Secure.getString(context.contentResolver, "voice_recognition_service")
            ?.let(ComponentName::unflattenFromString)
        if (configured != null && configured.packageName != context.packageName) assertEquals(configured, selected)
    }
}
