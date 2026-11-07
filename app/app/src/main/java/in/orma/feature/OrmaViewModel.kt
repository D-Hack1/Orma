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
data class SetupAction(val busy: Boolean = false, val failed: Boolean = false, val invitation: String = "", val complete: Boolean = false, val error: String = "")

@HiltViewModel
class OrmaViewModel @Inject constructor(val api: OrmaApi) : ViewModel() {
    val records = api.state
    val members get() = records.value.members.ifEmpty { api.members }
    val session = api.session
    val reminder = MutableStateFlow<Pair<String, Slot>?>(null)
    fun setReminder(memberId: String?, slot: String?) {
        val parsed = slot?.let { runCatching { Slot.valueOf(it) }.getOrNull() }
        if (!memberId.isNullOrBlank() && parsed != null) { reminder.value = memberId to parsed; setPrompt(parsed) }
    }
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
    fun setPrompt(slot: Slot?) { (api as? SupabaseOrmaApi)?.selectedSlot = slot }

    private fun setupAction(block: suspend () -> Unit) {
        if (mutableSetup.value.busy) return
        mutableSetup.value = SetupAction(busy = true)
        viewModelScope.launch {
            try { block(); mutableSetup.value = mutableSetup.value.copy(busy = false, complete = true) }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { mutableSetup.value = SetupAction(failed = true, error = e.message.orEmpty()) }
        }
    }

    fun submit(transcript: String, languageTag: String = "en-IN", speaker: String? = null) = runAction {
        val command = companionCommand(transcript, records.value.contacts)
        if (command != null) { mutableConversation.value = Conversation(transcript = transcript, command = command); return@runAction }
        val heard = runCatching { api.understand(transcript) }.getOrNull()
        mutableConversation.value = Conversation(transcript, heard, message =
            if (heard == null) "" else if (heard.needsClarification) heard.question else "Please check what I heard before saving.")
        var grounded: Reply? = null
        var saved = ""
        val lower = transcript.lowercase()
        val negative = Regex("illa|ഇല്ല|not |no\\b|didn|haven").containsMatchIn(lower)
        val affirmative = Regex("kazhichu|kazhichittund|കഴിച്ചു|കഴിച്ചിട്ടുണ്ട്|took|taken|\\bate\\b|eaten|\\bhad\\b|swallowed|yes|ഉവ്വ്|ശരി|^aa|ആ\\b|done").containsMatchIn(lower)
        val due = reminder.value
        val phoneMembers = members.filter { m -> records.value.schedules.any { it.memberId == m.id } }.map { it.id }
        speakerId = speaker?.takeIf { it.isNotBlank() } ?: phoneMembers.firstOrNull()
        val isAsk = heard?.intent == "ask" || Regex("\\?|kazhicho|കഴിച്ചോ|കഴിച്ചിട്ടുണ്ടോ|did i|have i|did we|have we|did (amma|achan)").containsMatchIn(lower)
        val group = Regex("njangal|ഞങ്ങൾ|randuperum|രണ്ടുപേരും|both|\\bwe\\b|\\bus\\b").containsMatchIn(lower)
        val slotWord = heard?.slot ?: when {
            Regex("morning|raavile|ravile|രാവിലെ").containsMatchIn(lower) -> Slot.morning
            Regex("noon|afternoon|lunch|uchakk|ഉച്ച").containsMatchIn(lower) -> Slot.noon
            Regex("night|evening|rathri|raathri|രാത്രി|dinner").containsMatchIn(lower) -> Slot.night
            else -> null
        }
        if (due == null && !isAsk && affirmative && !negative) {
            val ids = heard?.memberIds?.takeIf { it.isNotEmpty() }
                ?: if (group) phoneMembers.ifEmpty { listOfNotNull(speakerId) } else listOfNotNull(speakerId)
            val slot = slotWord ?: currentSlot()
            val results = ids.map { id ->
                val max = expected(id, slot) ?: 1
                val count = (heard?.countTaken ?: max).coerceIn(1, max)
                runCatching { api.logDose(LogRequest(id, slot = slot, countTaken = count,
                    medicinesTaken = heard?.medicines.orEmpty(), source = "voice", by = id, transcript = transcript, evidence = heard?.evidence.orEmpty())) }
                    .onFailure { android.util.Log.w("OrmaLog", "log failed: ${it.message}") }.getOrNull()
            }.filterNotNull()
            saved = results.joinToString(" ") { r -> r.reply.textEn }
            if (results.any { it.result == "duplicate_blocked" }) mutableConversation.value = mutableConversation.value.copy(blocked = true)
        } else if (due != null && affirmative && !negative) {
            val result = runCatching { api.logDose(LogRequest(due.first, slot = due.second, countTaken = expected(due.first, due.second) ?: 1,
                source = "voice", by = due.first, transcript = transcript)) }.getOrNull()
            if (result != null) { saved = result.reply.textEn; if (result.result == "duplicate_blocked") mutableConversation.value = mutableConversation.value.copy(blocked = true) }
            reminder.value = null
        }
        if (heard != null && !heard.needsClarification && heard.intent == "ask" && heard.slot != null && heard.memberIds.isNotEmpty()) {
            grounded = runCatching { api.askStatus(heard.memberIds.first(), today(), heard.slot) }.getOrNull()
        }
        if (GeminiClient.enabled) {
            val text = GeminiClient.reply(transcript, languageTag, todayFacts(grounded) +
                (if (saved.isNotBlank()) "\nJust saved from what the user said now: $saved" else "") +
                (due?.let { "\nThis was the answer to a medicine-time reminder for ${members.firstOrNull { m -> m.id == it.first }?.name ?: it.first} (${it.second})." } ?: ""))
            if (text != null) {
                val unsure = saved.isBlank() && (SupporterCall.shouldCall(text) || (grounded?.textEn?.let(SupporterCall::shouldCall) ?: false))
                val ml = languageTag.startsWith("ml")
                val tail = if (unsure) (if (ml) " ഞാൻ ഇപ്പോൾ അനുവിനെ വിളിക്കുന്നു." else " I am calling Anu for you now.") else ""
                val reply = if (ml) Reply(textEn = (grounded?.textEn ?: text) + tail, textMl = text + tail, sentences = grounded?.sentences.orEmpty())
                    else Reply(textEn = text + tail, textMl = (grounded?.textMl ?: text) + tail, sentences = grounded?.sentences.orEmpty())
                mutableConversation.value = mutableConversation.value.copy(reply = reply)
                if (unsure) callSupporter(transcript, heard?.memberIds?.firstOrNull())
                return@runAction
            }
        }
        if (grounded != null) mutableConversation.value = mutableConversation.value.copy(reply = grounded)
        else if (saved.isNotBlank()) mutableConversation.value = mutableConversation.value.copy(reply = Reply(saved, saved))
    }

    val callStatus = MutableStateFlow("")
    /** (memberName, question) for the UI layer to text + dial the supporter from this phone. */
    val dialRequest = MutableStateFlow<Pair<String, String>?>(null)
    fun callSupporter(question: String, memberId: String? = null) {
        val name = members.firstOrNull { it.id == memberId }?.name ?: members.firstOrNull { it.name == "Amma" }?.name ?: "Your family member"
        callStatus.value = "📞 Calling Anu…"
        dialRequest.value = name to question.ifBlank { "Please call me about my medicine" }
    }

    private var speakerId: String? = null
    private fun currentSlot(): Slot { val h = java.time.LocalTime.now(java.time.ZoneId.of("Asia/Kolkata")).hour; return if (h < 11) Slot.morning else if (h < 17) Slot.noon else Slot.night }

    private fun todayFacts(grounded: Reply?): String {
        val state = records.value
        val nm = members.associate { it.id to it.name }
        val perSlot = state.schedules.sortedBy { it.memberId + it.slot.ordinal }.joinToString("\n") { s ->
            val d = state.doses.firstOrNull { it.memberId == s.memberId && it.slot == s.slot && it.date == today() }
            val meds = s.medicines.joinToString { "${it.name} ${it.strength}" }
            "- ${nm[s.memberId] ?: s.memberId}, ${s.slot} (${s.time}; $meds): " +
                (if (d == null) "NOT RECORDED yet today" else "TAKEN today (${d.status}, recorded ${d.at.take(16)})")
        }
        val speakerLine = speakerId?.let { "The person speaking right now is ${nm[it] ?: it}. 'I' / 'me' means ${nm[it] ?: it}." } ?: ""
        return "$speakerLine\nCurrent dose time: ${currentSlot()}.\nDose status per person and time today:\n$perSlot" +
            (grounded?.let { "\nSystem record lookup: ${it.textEn}" } ?: "")
    }

    private fun legacyFacts(grounded: Reply?): String {
        val state = records.value
        val names = members.associate { it.id to it.name }
        val doses = state.doses.filter { it.date == today() }.joinToString("\n") {
            "- ${names[it.memberId] ?: it.memberId}: ${it.slot} dose ${it.status} at ${it.at}" + (it.countTaken?.let { c -> " ($c of ${it.countExpected ?: "?"} tablets)" } ?: "")
        }.ifBlank { "- No doses recorded yet today." }
        val schedule = state.schedules.joinToString("\n") { s ->
            "- ${names[s.memberId] ?: s.memberId} ${s.slot} at ${s.time}: " + s.medicines.joinToString { "${it.name} ${it.strength} x${it.count} (${it.purpose})" }
        }
        return "Today's dose records:\n$doses" + (if (schedule.isNotBlank()) "\nSchedule:\n$schedule" else "") +
            (grounded?.let { "\nSystem record lookup: ${it.textEn}" } ?: "")
    }

    fun log(memberIds: List<String>, slot: Slot, count: Int, source: String = "tap", by: String = "self", transcript: String = "", evidence: List<Evidence> = emptyList(), medicineIds: List<String>? = null) = runAction {
        val results = memberIds.map { id ->
            val schedule = records.value.schedules.firstOrNull { it.memberId == id && it.slot == slot }
            val medicines = medicineIds ?: if (count == schedule?.expected) schedule.medicines.map { it.id }
                else if (schedule?.medicines?.size == 1) listOf(schedule.medicines.single().id) else conversation.value.understanding?.medicines.orEmpty()
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
