package `in`.orma.data

import kotlinx.coroutines.flow.StateFlow

interface OrmaApi {
    val members: List<Member>
    val state: StateFlow<LocalState>
    suspend fun understand(transcript: String): Understanding
    suspend fun logDose(request: LogRequest): LogResult
    suspend fun askStatus(memberId: String, date: String, slot: Slot): Reply
    suspend fun explain(memberId: String, date: String, slot: Slot): Reply
    suspend fun setSharing(memberId: String, actorId: String, sharing: Sharing)
}
