package `in`.orma.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.orma.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

data class Conversation(
    val transcript: String = "", val understanding: Understanding? = null,
    val reply: Reply? = null, val busy: Boolean = false, val blocked: Boolean = false,
    val message: String = "Tell me who, when, and how many tablets.", val failed: Boolean = false
)

@HiltViewModel
class OrmaViewModel @Inject constructor(val api: OrmaApi) : ViewModel() {
    val records = api.state
    val members = api.members
    private val mutableConversation = MutableStateFlow(Conversation())
    val conversation = mutableConversation.asStateFlow()

    fun submit(transcript: String) = runAction {
        val heard = api.understand(transcript)
        mutableConversation.value = Conversation(transcript, heard, message =
            if (heard.needsClarification) heard.question else "Please check what I heard before saving.")
        if (!heard.needsClarification && heard.intent == "ask") {
            val answer = api.askStatus(heard.memberIds.first(), today(), requireNotNull(heard.slot))
            mutableConversation.value = mutableConversation.value.copy(reply = answer)
        }
    }

    fun log(memberIds: List<String>, slot: Slot, count: Int, source: String = "tap", by: String = "self", transcript: String = "", evidence: List<Evidence> = emptyList()) = runAction {
        val results = memberIds.map { id -> api.logDose(LogRequest(id, slot = slot, countTaken = count,
            source = source, by = if (by == "self") id else by, transcript = transcript, evidence = evidence)) }
        mutableConversation.value = Conversation(transcript = transcript,
            reply = Reply(results.joinToString("\n") { it.reply.textEn }, results.joinToString("\n") { it.reply.textMl },
                results.flatMap { it.reply.sentences }),
            blocked = results.any { it.result == "duplicate_blocked" }, message = "Record checked")
    }

    fun explain(memberId: String, slot: Slot, privateView: Boolean = true) = runAction {
        val sharing = records.value.sharing[memberId] ?: Sharing()
        val reply = if (privateView || sharing.counts) api.explain(memberId, today(), slot) else {
            val record = records.value.doses.firstOrNull { it.memberId == memberId && it.date == today() && it.slot == slot }
            if (record == null) Reply("No dose record exists. Please contact the member before helping with this dose.", "മരുന്ന് കഴിച്ചതിന്റെ രേഖയില്ല. സഹായിക്കുന്നതിന് മുമ്പ് അംഗത്തെ ബന്ധപ്പെടൂ.")
            else {
                val text = "${record.status.label} · logged by ${record.by} via ${record.source} at ${record.at}. Tablet counts are private."
                val textMl = "${statusLabelMl(record.status)}. ${memberLabelMl(record.by)} ${sourceLabelMl(record.source)} വഴി ${recordTime(record.at)} ന് രേഖപ്പെടുത്തി. ഗുളികകളുടെ എണ്ണം സ്വകാര്യമാണ്."
                Reply(text, textMl, listOf(Sentence(text, listOf(record.id), textMl)))
            }
        }
        mutableConversation.value = Conversation(reply = reply, message = "From your records")
    }

    fun share(memberId: String, sharing: Sharing) = runAction { api.setSharing(memberId, memberId, sharing) }
    fun clearConversation() { mutableConversation.value = Conversation() }

    private fun runAction(block: suspend () -> Unit) {
        if (mutableConversation.value.busy) return
        mutableConversation.value = mutableConversation.value.copy(busy = true)
        viewModelScope.launch {
            try { block() }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutableConversation.value = Conversation(message = e.message ?: "Could not save. Please try again.", failed = true) }
            finally { mutableConversation.value = mutableConversation.value.copy(busy = false) }
        }
    }
}
