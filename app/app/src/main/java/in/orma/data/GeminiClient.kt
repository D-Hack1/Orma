package `in`.orma.data

import android.util.Log
import `in`.orma.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URL

/**
 * Demo bridge: sends what the user said (plus today's records as the only allowed facts)
 * to Gemini and returns a short reply in the requested language.
 * Falls back across models because the newest model is often overloaded.
 */
object GeminiClient {
    private val models = listOf("gemini-3.5-flash-lite", "gemini-flash-lite-latest", "gemini-3.1-flash-lite")
    private val json = Json { ignoreUnknownKeys = true }

    val enabled get() = BuildConfig.GEMINI_API_KEY.isNotBlank()

    suspend fun reply(transcript: String, languageTag: String, facts: String): String? = withContext(Dispatchers.IO) {
        if (!enabled || transcript.isBlank()) return@withContext null
        val malayalam = languageTag.startsWith("ml")
        val language = if (malayalam) "Malayalam (Malayalam script only)" else "simple English"
        val prompt = """
            You are Orma, a calm, kind medicine companion for elderly people in Kerala.
            The user just said: "$transcript"
            FACTS (the ONLY things you may state about medicines or doses taken today):
            $facts
            Rules:
            - Reply in $language, at most 2 short sentences, warm and simple, for an elderly listener.
            - "Eaten/kazhichu/had/taken" medicine all mean the same thing: taking the dose.
            - If the facts say TAKEN for the person and time asked about, confirm clearly that it was taken (mention which medicines) and tell them not to take it again.
            - If the time is not said, answer for each dose time of that person today (taken or not recorded).
            - Only if the facts say NOT RECORDED: say you are not sure, ask them to wait before taking another, and say you will contact their supporter.
            - If the user says they took medicine, acknowledge it kindly; do not invent times or counts not in the facts or their words.
            - Never give new medical advice or change doses.
            - Plain text only, no markdown.
        """.trimIndent()
        val body = buildJsonObject {
            put("contents", buildJsonArray { add(buildJsonObject {
                put("role", "user")
                put("parts", buildJsonArray { add(buildJsonObject { put("text", prompt) }) })
            }) })
        }.toString()
        for (model in models) {
            try {
                val conn = URL("https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent").openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.connectTimeout = 5000
                conn.readTimeout = 5000
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.setRequestProperty("x-goog-api-key", BuildConfig.GEMINI_API_KEY)
                conn.outputStream.use { it.write(body.toByteArray()) }
                val code = conn.responseCode
                if (code != 200) { Log.w("OrmaGemini", "$model http $code"); conn.disconnect(); continue }
                val text = conn.inputStream.bufferedReader().use { it.readText() }
                conn.disconnect()
                val parts = json.parseToJsonElement(text).jsonObject["candidates"]?.jsonArray?.firstOrNull()
                    ?.jsonObject?.get("content")?.jsonObject?.get("parts")?.jsonArray ?: continue
                val answer = parts.mapNotNull { (it as? JsonObject)?.get("text")?.jsonPrimitive?.content }.lastOrNull()?.trim()
                if (!answer.isNullOrBlank()) { Log.i("OrmaGemini", "reply from $model"); return@withContext answer.replace("*", "") }
            } catch (e: Exception) {
                Log.w("OrmaGemini", "$model failed: ${e.javaClass.simpleName}")
            }
        }
        null
    }
}
