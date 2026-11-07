package `in`.orma.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.time.Instant

/** Local demo only. Never represents a server-verified record or sends an alert. */
class StubOrmaApi(
    private val fixture: DemoFixture,
    initial: LocalState = LocalState(),
    private val persist: (LocalState) -> Unit = {},
    private val clock: () -> String = { Instant.now().toString() }
) : OrmaApi {
    override val members = fixture.members
    private val mutableState = MutableStateFlow(initial)
    override val state = mutableState.asStateFlow()
    private val mutex = Mutex()

    override suspend fun understand(transcript: String): Understanding {
        // Prefer fixture examples; otherwise require explicit fields in the local keyword fallback.
        val match = fixture.phrases.firstOrNull { it.transcript.trim().equals(transcript.trim(), true) }
            ?: return offlineUnderstanding(transcript)
        val evidence = verifiedEvidence(transcript, match.evidence)
        val fields = evidence.map { it.field }.toSet()
        val complete = match.intent != "log" || ("members" in fields && "slot" in fields && "count" in fields)
        return match.copy(transcript = transcript, evidence = evidence,
            needsClarification = match.needsClarification || !complete)
    }

    override suspend fun logDose(request: LogRequest): LogResult = mutex.withLock {
        check(!state.value.storageError) { "Saved records could not be read. Logging is paused; please contact your supporter." }
        val member = members.firstOrNull { it.id == request.memberId } ?: error("Member not found")
        require(request.countTaken in 1..member.expected) { "Choose a count from the confirmed schedule." }
        val existing = state.value.doses.firstOrNull {
            it.memberId == request.memberId && it.date == request.date && it.slot == request.slot
        }
        // Partial doses also block a second unreviewed log: don't overwrite or silently top up.
        if (existing != null) return@withLock LogResult("duplicate_blocked", existing.status,
            Reply("A ${request.slot.label.lowercase()} record already exists for ${member.name}. Please check the record before taking more.",
                "ഈ മരുന്ന് കഴിച്ചതിന്റെ രേഖയുണ്ട്. വീണ്ടും കഴിക്കുന്നതിന് മുമ്പ് രേഖ പരിശോധിക്കൂ.",
                listOf(Sentence("${member.name}: ${existing.countTaken} of ${existing.countExpected} recorded at ${existing.at}.", listOf(existing.id)))))
        val status = when {
            request.countTaken < member.expected -> DoseStatus.partial
            request.source in listOf("nurse", "family") -> DoseStatus.reported
            else -> DoseStatus.confirmed
        }
        val record = DoseRecord(request.memberId, request.date, request.slot, status,
            request.countTaken, member.expected, request.source, request.by, clock(), request.transcript,
            verifiedEvidence(request.transcript, request.evidence))
        publish(state.value.copy(doses = state.value.doses + record))
        val text = "${member.name}: ${request.countTaken} of ${member.expected} tablets recorded for ${request.slot.label.lowercase()}."
        LogResult(if (status == DoseStatus.partial) "partial" else "logged", status,
            Reply(text, "മരുന്ന് കഴിച്ചതായി രേഖപ്പെടുത്തി.", listOf(Sentence(text, listOf(record.id)))))
    }

    override suspend fun askStatus(memberId: String, date: String, slot: Slot): Reply {
        val member = members.first { it.id == memberId }
        val record = state.value.doses.firstOrNull { it.memberId == memberId && it.date == date && it.slot == slot }
        if (record == null) return Reply(
            "There is no ${slot.label.lowercase()} record for ${member.name}. Please wait before taking another dose and contact your supporter. This demo cannot send an alert.",
            "രേഖയില്ല. വീണ്ടും മരുന്ന് കഴിക്കുന്നതിന് മുമ്പ് കാത്തിരിക്കൂ. സഹായിയെ വിളിക്കൂ.")
        val text = "${member.name}: ${record.countTaken} of ${record.countExpected} recorded by ${record.by}, via ${record.source}, at ${record.at}."
        return Reply(text, "മരുന്ന് കഴിച്ചതിന്റെ രേഖയുണ്ട്.", listOf(Sentence(text, listOf(record.id))))
    }

    override suspend fun explain(memberId: String, date: String, slot: Slot): Reply = askStatus(memberId, date, slot)

    override suspend fun setSharing(memberId: String, actorId: String, sharing: Sharing) = mutex.withLock {
        require(actorId == memberId) { "Only the member may change sharing in this demo." }
        publish(state.value.copy(sharing = state.value.sharing + (memberId to sharing)))
    }

    private fun publish(next: LocalState) {
        persist(next) // Commit to disk before exposing a successful write.
        mutableState.value = next
    }
}
