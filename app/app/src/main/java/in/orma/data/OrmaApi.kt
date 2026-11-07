package `in`.orma.data

import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow

private val demoSession = MutableStateFlow(AccountSession(loading = false, signedIn = true, role = "supporter", isDemo = true))

interface OrmaApi {
    val members: List<Member>
    val state: StateFlow<LocalState>
    val session: StateFlow<AccountSession> get() = demoSession
    suspend fun initialize() {}
    suspend fun authenticate(email: String, password: String, name: String, phone: String, language: String, create: Boolean) { error("Not available in demo mode") }
    suspend fun logout() { error("Not available in demo mode") }
    suspend fun createFamily(name: String, independent: Boolean): String { error("Not available in demo mode") }
    suspend fun joinFamily(code: String, shareDetails: Boolean) { error("Not available in demo mode") }
    suspend fun selectFamily(familyId: String) { error("Not available in demo mode") }
    suspend fun configureDevice(memberIds: List<String>) { error("Not available in demo mode") }
    suspend fun addMember(name: String, relation: String, language: String): String { error("Not available in demo mode") }
    suspend fun invite(memberId: String?, role: String, relation: String): String { error("Not available in demo mode") }
    suspend fun saveSchedule(schedule: DoseSchedule) { error("Not available in demo mode") }
    suspend fun refresh() {}
    suspend fun snooze(memberId: String, slot: Slot, minutes: Int, reason: String = "later"): Reply { error("Not available in demo mode") }
    suspend fun message(memberId: String, recipient: String, text: String): Reply { error("Not available in demo mode") }
    suspend fun understand(transcript: String): Understanding
    suspend fun logDose(request: LogRequest): LogResult
    suspend fun askStatus(memberId: String, date: String, slot: Slot): Reply
    suspend fun explain(memberId: String, date: String, slot: Slot): Reply
    suspend fun setSharing(memberId: String, actorId: String, sharing: Sharing)
}
