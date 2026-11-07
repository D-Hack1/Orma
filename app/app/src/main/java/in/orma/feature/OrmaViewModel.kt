package `in`.orma.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import `in`.orma.data.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collectLatest
import javax.inject.Inject

data class Conversation(
    val transcript: String = "", val understanding: Understanding? = null,
    val reply: Reply? = null, val busy: Boolean = false, val blocked: Boolean = false,
    val message: String = "Tell me who, when, and how many tablets.", val failed: Boolean = false,
    val command: CompanionCommand? = null
)
data class SetupAction(val busy: Boolean = false, val failed: Boolean = false, val invitation: String = "", val complete: Boolean = false)

@HiltViewModel
class OrmaViewModel @Inject constructor(val api: OrmaApi) : ViewModel() {
    val records = api.state
    val members get() = records.value.members.ifEmpty { api.members }
    val session = api.session
    private val mutableSetup = MutableStateFlow(SetupAction())
    val setup = mutableSetup.asStateFlow()
    private val mutableConversation = MutableStateFlow(Conversation())
    val conversation = mutableConversation.asStateFlow()
    init { viewModelScope.launch { api.initialize() } }

    fun expected(memberId: String, slot: Slot) = records.value.schedules.firstOrNull { it.memberId == memberId && it.slot == slot }?.expected
        ?: if (session.value.isDemo) members.firstOrNull { it.id == memberId }?.expected ?: 0 else 0
    fun authenticate(email: String, password: String, name: String, phone: String, language: String, create: Boolean) = setupAction { api.authenticate(email, password, name, phone, language, create) }
    fun createFamily(name: String, independent: Boolean) = setupAction { api.createFamily(name, independent) }
    fun join(code: String, share: Boolean) = setupAction { api.joinFamily(code, share) }
    fun selectFamily(id: String) = setupAction { api.selectFamily(id) }
    fun deviceMembers(ids: List<String>) = setupAction { api.configureDevice(ids) }
    fun addParent(name: String, relation: String, language: String) = setupAction { api.addMember(name, relation, language) }
    fun invite(memberId: String?, role: String, relation: String) = setupAction { mutableSetup.value = SetupAction(busy = true, invitation = api.invite(memberId, role, relation)) }
    fun saveSchedule(schedule: DoseSchedule) = setupAction { api.saveSchedule(schedule) }
    fun refresh() = setupAction { api.refresh() }
    fun retryConnection() = setupAction { api.initialize() }
    fun signOut() = setupAction { api.logout(); mutableConversation.value = Conversation() }
    fun resetSetupMessage() { mutableSetup.value = SetupAction() }
    fun setPrompt(slot: Slot?) { (api as? FirebaseOrmaApi)?.selectedSlot = slot }

    private fun setupAction(block: suspend () -> Unit) {
        if (mutableSetup.value.busy) return
        mutableSetup.value = SetupAction(busy = true)
        viewModelScope.launch {
            try { block(); mutableSetup.value = mutableSetup.value.copy(busy = false, complete = true) }
            catch (e: CancellationException) { throw e }
            catch (_: Exception) { mutableSetup.value = SetupAction(failed = true) }
        }
    }

    fun submit(transcript: String) = runAction {
        val command = companionCommand(transcript, records.value.contacts)
        if (command != null) { mutableConversation.value = Conversation(transcript = transcript, command = command); return@runAction }
        val heard = api.understand(transcript)
        mutableConversation.value = Conversation(transcript, heard, message =
            if (heard.needsClarification) heard.question else "Please check what I heard before saving.")
        if (!heard.needsClarification && heard.intent == "ask") {
            val answer = api.askStatus(heard.memberIds.first(), today(), requireNotNull(heard.slot))
            mutableConversation.value = mutableConversation.value.copy(reply = answer)
        }
    }

    fun log(memberIds: List<String>, slot: Slot, count: Int, source: String = "tap", by: String = "self", transcript: String = "", evidence: List<Evidence> = emptyList()) = runAction {
        val results = memberIds.map { id ->
            val schedule = records.value.schedules.firstOrNull { it.memberId == id && it.slot == slot }
            val medicines = if (count == schedule?.expected) schedule.medicines.map { it.id } else conversation.value.understanding?.medicines.orEmpty()
            api.logDose(LogRequest(id, slot = slot, countTaken = count, medicinesTaken = medicines,
                source = source, by = if (by == "self") id else by, transcript = transcript, evidence = evidence))
        }
        mutableConversation.value = Conversation(transcript = transcript,
            reply = Reply(results.joinToString("\n") { it.reply.textEn }, results.joinToString("\n") { it.reply.textMl },
                results.flatMap { it.reply.sentences }),
            blocked = results.any { it.result == "duplicate_blocked" }, message = "Record checked")
    }

    fun explain(memberId: String, slot: Slot, privateView: Boolean = true) = runAction {
        if (!session.value.isDemo) {
            mutableConversation.value = Conversation(reply = api.explain(memberId, today(), slot), message = "From your records")
            return@runAction
        }
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
    fun snooze(memberId: String, slot: Slot, minutes: Int) = runAction {
        mutableConversation.value = Conversation(reply = api.snooze(memberId, slot, minutes), message = "Record checked")
    }
    fun sendMessage(memberId: String, recipient: String, text: String) = runAction {
        mutableConversation.value = Conversation(reply = api.message(memberId, recipient, text), message = "Record checked")
    }

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
