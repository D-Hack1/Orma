package `in`.orma.data

import com.google.firebase.functions.FirebaseFunctions
import kotlinx.coroutines.tasks.await
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull

/** Callable transport, deliberately unbound until Agent 2 freezes the contracts at C1. */
class FirebaseCallableTransport(private val functions: FirebaseFunctions) {
    suspend fun call(endpoint: String, payload: JsonObject): JsonElement {
        val result = functions.getHttpsCallable(endpoint).call(payload.toNative()).await()
        return result.getData().toJson()
    }

    private fun JsonElement.toNative(): Any? = when (this) {
        JsonNull -> null
        is JsonObject -> mapValues { it.value.toNative() }
        is JsonArray -> map { it.toNative() }
        else -> jsonPrimitive.let { if (it.isString) it.content else it.content.toBooleanStrictOrNull() ?: it.content.toDoubleOrNull() ?: it.content }
    }
    private fun Any?.toJson(): JsonElement = when (this) {
        null -> JsonNull
        is Map<*, *> -> JsonObject(entries.associate { it.key.toString() to it.value.toJson() })
        is List<*> -> JsonArray(map { it.toJson() })
        is Number -> kotlinx.serialization.json.JsonPrimitive(this)
        is Boolean -> kotlinx.serialization.json.JsonPrimitive(this)
        else -> kotlinx.serialization.json.JsonPrimitive(toString())
    }
}
