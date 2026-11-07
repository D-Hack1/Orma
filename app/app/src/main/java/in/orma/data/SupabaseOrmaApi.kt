package `in`.orma.data

import android.content.Context
import android.os.Build
import `in`.orma.BuildConfig
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.serialization.json.*
import java.time.Instant
import java.util.UUID

/** Supabase Auth and authorized family RPCs through the configured backend. */
class SupabaseOrmaApi(private val context: Context) : OrmaApi {
    private val prefs = context.getSharedPreferences("orma-supabase-account", Context.MODE_PRIVATE)
    private val tokens = SessionTokens(context)
    private var accessToken = tokens.read("access")
    private var refreshToken = tokens.read("refresh")
    private var uid = prefs.getString("uid", "").orEmpty()
    private val baseUrl = BuildConfig.ORMA_API_URL.ifBlank {
        "http://127.0.0.1:8787"
    }.trimEnd('/')
    private val authMutex = Mutex()
    private val mutableState = MutableStateFlow(LocalState())
    override val state = mutableState.asStateFlow()
    private val mutableSession = MutableStateFlow(AccountSession())
    override val session = mutableSession.asStateFlow()
    override val members get() = state.value.members
    private val refreshMutex = Mutex()
    var selectedSlot: Slot? = null
    private val deviceRoot = prefs.getString("deviceId", null) ?: UUID.randomUUID().toString().also { prefs.edit().putString("deviceId", it).apply() }
    private val deviceId get() = "${deviceRoot.take(36)}-${uid.take(24)}"

    private suspend fun request(path: String, payload: Map<String, Any?>, token: String = ""): Map<String, Any?> = withContext(Dispatchers.IO) {
        val connection = URL(baseUrl + path).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"; connection.connectTimeout = 12_000; connection.readTimeout = 25_000
            connection.setRequestProperty("Content-Type", "application/json")
            if (token.isNotBlank()) connection.setRequestProperty("Authorization", "Bearer $token")
            connection.doOutput = true
            connection.outputStream.use { it.write(payload.toJson().toString().toByteArray(Charsets.UTF_8)) }
            val code = connection.responseCode
            val raw = (if (code in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
            @Suppress("UNCHECKED_CAST") val result = Json.parseToJsonElement(raw.ifBlank { "{}" }).toNative() as? Map<String, Any?> ?: error("Invalid server response")
            if (code !in 200..299) throw ApiFailure(code, result.str("error", "Unable to connect. Please try again."))
            result
        } finally { connection.disconnect() }
    }
    private suspend fun acceptTokens(result: Map<String, Any?>) {
        accessToken = result.str("access_token")
        if (accessToken.isBlank()) error("Check your email to confirm your account, then sign in.")
        refreshToken = result.str("refresh_token")
        @Suppress("UNCHECKED_CAST") val user = result["user"] as? Map<String, Any?> ?: emptyMap()
        uid = user.str("id", uid)
        tokens.write("access", accessToken); tokens.write("refresh", refreshToken)
        prefs.edit().putString("uid", uid).putLong("expires", System.currentTimeMillis() + ((result["expires_in"] as? Number)?.toLong() ?: 3600) * 1000).apply()
    }
    private suspend fun renew(force: Boolean = false) = authMutex.withLock {
        if (refreshToken.isNotBlank() && (force || System.currentTimeMillis() > prefs.getLong("expires", 0) - 60_000)) {
            acceptTokens(request("/auth/refresh", mapOf("refresh_token" to refreshToken)))
        }
    }
    private suspend fun call(name: String, payload: Map<String, Any?> = emptyMap()): Map<String, Any?> {
        renew()
        return try { request("/rpc/$name", payload, accessToken) }
        catch (e: ApiFailure) {
            if (e.status != 401) throw e
            renew(true); request("/rpc/$name", payload, accessToken)
        }
    }
    private fun familyPayload(memberId: String? = null) = mutableMapOf<String, Any?>("familyId" to session.value.familyId).apply { if (memberId != null) put("memberId", memberId) }

    override suspend fun initialize() {
        if (accessToken.isBlank()) { mutableSession.value = AccountSession(loading = false); return }
        mutableSession.value = AccountSession(loading = true, signedIn = true, uid = uid)
        try {
            val response = call("listMyFamilies")
            val families = response.maps("families").map { FamilyChoice(it.str("familyId"), it.str("name"), it.str("role")) }
            mutableSession.value = session.value.copy(loading = false, families = families)
            val preferred = prefs.getString("family-${uid}", null)
            val family = families.firstOrNull { it.familyId == preferred } ?: families.singleOrNull()
            if (family != null) selectFamily(family.familyId)
        } catch (_: Exception) { mutableSession.value = session.value.copy(loading = false, problem = "connection") }
    }
    override suspend fun authenticate(email: String, password: String, name: String, phone: String, language: String, create: Boolean) {
        val result = request(if (create) "/auth/signup" else "/auth/signin", mapOf("email" to email.trim(), "password" to password, "name" to name.trim(), "phone" to phone.trim(), "language" to language))
        acceptTokens(result)
        @Suppress("UNCHECKED_CAST") val user = result["user"] as? Map<String, Any?> ?: emptyMap()
        @Suppress("UNCHECKED_CAST") val metadata = user["user_metadata"] as? Map<String, Any?> ?: emptyMap()
        val profileName = if (create) name.trim() else metadata.str("name")
        if (profileName.isNotBlank()) call("saveProfile", mapOf("name" to profileName, "phone" to if (create) phone.trim() else metadata.str("phone"), "language" to if (create) language else metadata.str("language", "en")))
        initialize()
    }
    override suspend fun logout() {
        `in`.orma.reminders.ScheduleStore.clear(context)
        tokens.write("access", ""); tokens.write("refresh", "")
        accessToken = ""; refreshToken = ""; uid = ""
        prefs.edit().remove("uid").apply()
        mutableState.value = LocalState(); mutableSession.value = AccountSession(loading = false)
    }
    override suspend fun createFamily(name: String, independent: Boolean): String {
        val result = call("createFamily", mapOf("name" to name.trim(), "independent" to independent))
        val id = result.str("familyId"); selectFamily(id); return id
    }
    override suspend fun joinFamily(code: String, shareDetails: Boolean) {
        val result = call("joinFamily", mapOf("code" to code.trim(), "shareMedicineDetails" to shareDetails))
        selectFamily(result.str("familyId"))
    }
    override suspend fun selectFamily(familyId: String) {
        mutableState.value = LocalState()
        mutableSession.value = session.value.copy(familyId = familyId, loading = true)
        prefs.edit().putString("family-${uid}", familyId).apply()
        refresh()
    }
    override suspend fun refresh() = refreshMutex.withLock {
        if (session.value.familyId.isBlank()) return@withLock
        val result = call("getFamily", familyPayload())
        val memberMaps = result.maps("members")
        val parsed = memberMaps.map { m -> Member(m.str("id"), m.str("name"), "", m.str("mode"), m.str("name").take(2), expected = 0,
            nurseAssigned = result.str("role") == "nurse", isOwner = m.bool("isOwner"), canManage = m.bool("canManage"), awaitingAccount = m.bool("awaitingAccount")) }
        val schedules = memberMaps.flatMap { member -> member.maps("schedules").mapNotNull { parseSchedule(member.str("id"), it) } }
        val sharing = memberMaps.associate { m -> m.str("id") to (m["sharing"] as? Map<*, *>).let { s -> Sharing(s?.get("counts") == true, s?.get("messages") == true, s?.get("risk") == true, s?.get("nurseNotes") == true) } }
        val selectedIds = prefs.getStringSet("members-${session.value.uid}-${session.value.familyId}", null)?.toList()
            ?.filter { id -> parsed.any { it.id == id } } ?: parsed.filter { it.isOwner }.map { it.id }
        val relations = memberMaps.filter { it.str("id") in selectedIds }.flatMap { (it["relations"] as? Map<*, *>)?.entries?.map { e -> e.key.toString() to e.value.toString() }.orEmpty() }.toMap()
        val contacts = result.maps("contacts").filter { it.str("uid") != uid }.map {
            FamilyContact(it.str("uid"), it.str("name"), it.str("phone"), relations[it.str("uid")].orEmpty(), it.strings("roles")) }
        val doses = result.maps("doses").mapNotNull { data ->
            val slot = runCatching { Slot.valueOf(data.str("slot")) }.getOrNull() ?: return@mapNotNull null
            val status = runCatching { DoseStatus.valueOf(data.str("status")) }.getOrNull() ?: DoseStatus.unknown
            DoseRecord(data.str("memberId"), data.str("date"), slot, status, (data["countTaken"] as? Number)?.toInt(), (data["countExpected"] as? Number)?.toInt(), data.str("source"), data.str("by"), data.str("at"))
        }
        mutableState.update { it.copy(members = parsed, schedules = schedules, sharing = sharing, contacts = contacts, doses = doses, connected = true) }
        mutableSession.value = session.value.copy(loading = false, signedIn = true, uid = uid, familyName = result.str("name"), role = result.str("role"), deviceMemberIds = selectedIds, problem = "",
            deviceConfigured = prefs.getBoolean("confirmed-${session.value.uid}-${session.value.familyId}", false))
        if (selectedIds.isNotEmpty()) call("registerDevice", mapOf("familyId" to session.value.familyId, "deviceId" to deviceId, "memberIds" to selectedIds, "tier" to "T1"))
        `in`.orma.reminders.ScheduleStore.sync(context, state.value, session.value)
    }
    override suspend fun configureDevice(memberIds: List<String>) {
        require(memberIds.isNotEmpty())
        call("registerDevice", mapOf("familyId" to session.value.familyId, "deviceId" to deviceId, "memberIds" to memberIds, "tier" to "T1"))
        prefs.edit().putStringSet("members-${session.value.uid}-${session.value.familyId}", memberIds.toSet()).apply()
        prefs.edit().putBoolean("confirmed-${session.value.uid}-${session.value.familyId}", true).apply()
        mutableSession.update { it.copy(deviceMemberIds = memberIds) }
        refresh()
    }
    override suspend fun addMember(name: String, relation: String, language: String): String {
        val result = call("addFamilyMember", familyPayload().apply { putAll(mapOf("name" to name.trim(), "mode" to "assisted", "language" to language, "caregiverRelation" to relation)) })
        refresh(); return result.str("memberId")
    }
    override suspend fun invite(memberId: String?, role: String, relation: String): String = call("inviteFamilyMember", familyPayload().apply {
        if (memberId != null) put("memberId", memberId); put("role", role); put("relation", relation)
    }).str("code")
    override suspend fun saveSchedule(schedule: DoseSchedule) {
        call("updateMedicineSchedule", familyPayload(schedule.memberId).apply { putAll(mapOf("slot" to schedule.slot.name, "time" to schedule.time,
            "afterFood" to schedule.afterFood, "medicines" to schedule.medicines.map { mapOf("id" to it.id, "name" to it.name, "strength" to it.strength,
                "dose" to "${it.count} tablet(s)", "count" to it.count, "stock" to it.stock, "purpose" to it.purpose, "timeCritical" to it.timeCritical) })) })
        refresh()
    }
    override suspend fun understand(transcript: String): Understanding {
        val ids = session.value.deviceMemberIds.ifEmpty { members.filter { it.isOwner }.map { it.id } }
        require(ids.isNotEmpty()) { "Choose who this device is set up for." }
        val response = call("understand", familyPayload().apply { putAll(mapOf("deviceId" to deviceId, "memberIds" to ids, "transcript" to transcript,
            "clientTime" to Instant.now().toString(), "tz" to "Asia/Kolkata")); selectedSlot?.let { put("slot", it.name) } })
        return Understanding(response.str("intent", "unclear"), response.str("transcript"), response.strings("members"),
            response["slot"]?.toString()?.let { runCatching { Slot.valueOf(it) }.getOrNull() }, (response["count"] as? Number)?.toInt(),
            response.maps("evidence").map { Evidence(it.str("field"), it.str("span")) }, response.bool("needsClarification"), response.str("clarifyQuestion"),
            response.strings("medicines"), response["snoozeReason"] as? String, response.maps("memberActions").map { MemberAction(it.str("memberId"), it.bool("taken"), (it["count"] as? Number)?.toInt(), it.strings("medicines")) })
    }
    override suspend fun logDose(request: LogRequest): LogResult {
        val evidence = mapOf("type" to request.source, "at" to Instant.now().toString(), "by" to session.value.uid,
            "snippet" to request.transcript, "spans" to request.evidence.map { mapOf("field" to it.field, "span" to it.span) })
        val result = call("logDose", familyPayload(request.memberId).apply { putAll(mapOf("date" to request.date, "slot" to request.slot.name,
            "countTaken" to request.countTaken, "medicinesTaken" to request.medicinesTaken, "source" to request.source,
            "by" to session.value.uid, "evidence" to listOf(evidence))) })
        val status = DoseStatus.valueOf(result.str("status"))
        @Suppress("UNCHECKED_CAST") val reply = reply(result["reply"] as Map<String, Any?>)
        refresh()
        return LogResult(result.str("result"), status, reply)
    }
    override suspend fun askStatus(memberId: String, date: String, slot: Slot) = reply(call("askStatus", familyPayload(memberId).apply { put("date", date); put("slot", slot.name) }))
    override suspend fun explain(memberId: String, date: String, slot: Slot) = reply(call("explain", familyPayload(memberId).apply { put("date", date); put("slot", slot.name); put("kind", "status") }))
    override suspend fun setSharing(memberId: String, actorId: String, sharing: Sharing) {
        call("setSharing", familyPayload(memberId).apply { put("changes", mapOf("counts" to sharing.counts, "messages" to sharing.messages, "risk" to sharing.risk, "nurseNotes" to sharing.nurseNotes)) }); refresh()
    }
    override suspend fun snooze(memberId: String, slot: Slot, minutes: Int, reason: String): Reply {
        val result = call("snooze", familyPayload(memberId).apply { putAll(mapOf("date" to today(), "slot" to slot.name, "reason" to reason, "delayMinutes" to minutes)) })
        if (result["allowed"] == false) return reply(result)
        val at = result.str("remindAt"); if (at.isNotBlank()) `in`.orma.reminders.ScheduleStore.snooze(context, memberId, slot, Instant.parse(at).toEpochMilli())
        return reply(result)
    }
    override suspend fun message(memberId: String, recipient: String, text: String) = reply(call("sendMessage", familyPayload(memberId).apply { put("to", recipient); put("text", text) }))

    private fun parseSchedule(memberId: String, map: Map<String, Any?>): DoseSchedule? {
        val slot = runCatching { Slot.valueOf(map.str("slot")) }.getOrNull() ?: return null
        return DoseSchedule(memberId, slot, map.str("time"), map.maps("medicines").map { Medicine(it.str("id"), it.str("name"), it.str("strength"), (it["count"] as? Number)?.toInt() ?: 0,
            (it["stock"] as? Number)?.toInt() ?: 0, it.str("purpose"), it.bool("timeCritical")) }, map["afterFood"] != false)
    }
    private fun reply(map: Map<String, Any?>): Reply = Reply(map.str("textEn"), map.str("textMl"), map.maps("sentences").map { Sentence(it.str("text"), it.strings("cites"), it.str("textMl")) })
}

internal fun Map<String, Any?>.str(key: String, default: String = "") = this[key] as? String ?: default
internal fun Map<String, Any?>.bool(key: String) = this[key] == true
internal fun Map<String, Any?>.strings(key: String): List<String> = (this[key] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
@Suppress("UNCHECKED_CAST") internal fun Map<String, Any?>.maps(key: String): List<Map<String, Any?>> = (this[key] as? List<*>)?.mapNotNull { it as? Map<String, Any?> }.orEmpty()

private class ApiFailure(val status: Int, message: String) : Exception(message)
private fun Any?.toJson(): JsonElement = when (this) {
    null -> JsonNull
    is Map<*, *> -> JsonObject(entries.associate { it.key.toString() to it.value.toJson() })
    is Iterable<*> -> JsonArray(map { it.toJson() })
    is Boolean -> JsonPrimitive(this)
    is Number -> JsonPrimitive(this)
    else -> JsonPrimitive(toString())
}
private fun JsonElement.toNative(): Any? = when (this) {
    JsonNull -> null
    is JsonObject -> mapValues { it.value.toNative() }
    is JsonArray -> map { it.toNative() }
    is JsonPrimitive -> if (isString) content else booleanOrNull ?: longOrNull ?: doubleOrNull ?: content
}
