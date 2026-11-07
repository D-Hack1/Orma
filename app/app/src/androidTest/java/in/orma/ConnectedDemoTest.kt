package `in`.orma

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.*
import `in`.orma.data.SupabaseOrmaApi
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConnectedDemoTest {
    @Test fun signInToPreparedDemo() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val config = context.getFileStreamPath("demo-login.json")
        assumeTrue("A private demo fixture must be supplied through adb run-as", config.exists())
        val data = Json.parseToJsonElement(config.readText()).jsonObject
        fun value(name: String) = data.getValue(name).jsonPrimitive.content
        val api = SupabaseOrmaApi(context)
        api.authenticate(value("email"), value("password"), "", "", "en", false)
        api.selectFamily(value("familyId"))
        api.configureDevice(listOf(value("memberId")))
        assertTrue(api.session.value.signedIn)
        assertTrue(api.session.value.deviceConfigured)
        assertEquals(3, api.state.value.schedules.size)
        assertEquals(2, api.state.value.schedules.first().expected)
        val heard = api.understand("I took two tablets at noon.")
        assertEquals("log", heard.intent)
        assertEquals(2, heard.countTaken)
        assertFalse(heard.needsClarification)
        assertTrue(config.delete())
    }
}
