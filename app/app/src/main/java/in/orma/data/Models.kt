package `in`.orma.data

import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.ZoneId

val KeralaZone: ZoneId = ZoneId.of("Asia/Kolkata")
fun today(): String = LocalDate.now(KeralaZone).toString()

@Serializable enum class Slot(val label: String, val time: String) {
    morning("Morning", "08:00"), noon("Noon", "13:00"), night("Night", "20:00")
}
@Serializable enum class DoseStatus(val label: String) {
    confirmed("Taken"), reported("Reported"), partial("Partly taken"), pending("Upcoming"), unknown("No record")
}
@Serializable data class Member(
    val id: String, val name: String, val relation: String, val mode: String,
    val initials: String, val expected: Int = 3, val stock: Int = 30,
    val nurseAssigned: Boolean = false
)
@Serializable data class Evidence(val field: String, val span: String)
@Serializable data class Understanding(
    val intent: String = "unclear", val transcript: String = "", val memberIds: List<String> = emptyList(),
    val slot: Slot? = null, val countTaken: Int? = null, val evidence: List<Evidence> = emptyList(),
    val needsClarification: Boolean = true, val question: String = "Please choose who and which dose."
)
@Serializable data class DoseRecord(
    val memberId: String, val date: String, val slot: Slot, val status: DoseStatus,
    val countTaken: Int, val countExpected: Int, val source: String, val by: String,
    val at: String, val transcript: String = "", val evidence: List<Evidence> = emptyList()
) { val id: String get() = "$memberId/$date\u005f${slot.name}" }
@Serializable data class Sentence(val text: String, val cites: List<String>, val textMl: String = "")
@Serializable data class Reply(val textEn: String, val textMl: String = "", val sentences: List<Sentence> = emptyList())
@Serializable data class LogRequest(
    val memberId: String, val date: String = today(), val slot: Slot, val countTaken: Int,
    val medicinesTaken: List<String> = emptyList(), val source: String = "tap", val by: String,
    val transcript: String = "", val evidence: List<Evidence> = emptyList()
)
@Serializable data class LogResult(val result: String, val status: DoseStatus, val reply: Reply)
@Serializable data class Sharing(val counts: Boolean = false, val messages: Boolean = false, val risk: Boolean = false, val nurseNotes: Boolean = false)
@Serializable data class DemoFixture(val members: List<Member>, val phrases: List<Understanding>)
@Serializable data class LocalState(val doses: List<DoseRecord> = emptyList(), val sharing: Map<String, Sharing> = emptyMap(), val storageError: Boolean = false)

fun verifiedEvidence(transcript: String, evidence: List<Evidence>): List<Evidence> =
    evidence.filter { it.span.isNotBlank() && transcript.contains(it.span) }

fun memberLabelMl(id: String): String = when (id.lowercase()) {
    "achan" -> "അച്ഛൻ"; "amma" -> "അമ്മ"; "ammoomma" -> "അമ്മൂമ്മ"
    "rahul" -> "രാഹുൽ"; "farhan" -> "ഫർഹാൻ"; "anu" -> "അനു"; "sister mini" -> "സിസ്റ്റർ മിനി"; else -> id
}
fun slotLabelMl(slot: Slot) = when (slot) { Slot.morning -> "രാവിലെ"; Slot.noon -> "ഉച്ചയ്ക്ക്"; Slot.night -> "രാത്രി" }
fun sourceLabelMl(source: String) = when (source) { "voice" -> "ശബ്ദം"; "family" -> "കുടുംബം"; "nurse" -> "നഴ്സ്"; "notification" -> "അറിയിപ്പ്"; else -> "ബട്ടൺ" }
fun statusLabelMl(status: DoseStatus) = when (status) {
    DoseStatus.confirmed -> "കഴിച്ചു"; DoseStatus.reported -> "മറ്റൊരാൾ രേഖപ്പെടുത്തി"; DoseStatus.partial -> "ഭാഗികമായി കഴിച്ചു"
    DoseStatus.pending -> "സമയം ആയിട്ടില്ല"; DoseStatus.unknown -> "രേഖയില്ല"
}
fun recordTime(at: String): String = runCatching {
    java.time.Instant.parse(at).atZone(KeralaZone).format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm"))
}.getOrDefault(at)
