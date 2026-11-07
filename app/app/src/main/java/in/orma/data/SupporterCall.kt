package `in`.orma.data

import android.util.Log
import `in`.orma.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URL

/** Asks the laptop bridge to place an automated phone call to the on-duty supporter. */
object SupporterCall {
    private val needsHelp = Regex(
        "supporter|contact|call (your|anu|family)|not sure|unsure|no record|wait before|check with|" +
            "ഉറപ്പില്ല|കാത്തിരിക്ക|വിളിക്ക|സഹായി|ബന്ധപ്പെട|രേഖയില്ല",
        RegexOption.IGNORE_CASE
    )

    fun shouldCall(reply: String) = needsHelp.containsMatchIn(reply)

    /** Returns null on success, otherwise a short reason. */
    suspend fun call(memberName: String, question: String): String? = withContext(Dispatchers.IO) {
        val base = BuildConfig.ORMA_API_URL.ifBlank { "http://127.0.0.1:8787" }.trimEnd('/')
        try {
            val conn = URL("$base/call/supporter").openConnection() as HttpURLConnection
            conn.requestMethod = "POST"; conn.connectTimeout = 5000; conn.readTimeout = 20000; conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            val body = buildJsonObject { put("memberName", memberName); put("question", question) }.toString()
            conn.outputStream.use { it.write(body.toByteArray()) }
            val ok = conn.responseCode == 200
            val text = (if (ok) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            conn.disconnect()
            Log.i("OrmaCall", "supporter call ok=$ok")
            if (ok) null else text.ifBlank { "Call failed" }
        } catch (e: Exception) {
            Log.w("OrmaCall", "supporter call failed: ${e.javaClass.simpleName}")
            "Could not reach the calling service"
        }
    }
}
