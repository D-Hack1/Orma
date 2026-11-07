package `in`.orma.data

sealed interface CompanionCommand {
    data class Snooze(val minutes: Int) : CompanionCommand
    data class Call(val candidates: List<FamilyContact>) : CompanionCommand
}

/** Local personal actions never invent a medicine record or destination phone number. */
fun companionCommand(transcript: String, contacts: List<FamilyContact>): CompanionCommand? {
    val text = transcript.trim().lowercase()
    if (Regex("\\b(don't|do not|never)\\b|വേണ്ട|വിളിക്കരുത്").containsMatchIn(text)) return null
    val snooze = Regex("remind|snooze|ഓർമ്മിപ്പ|ഓര്‍മ്മിപ്പ|പിന്നീട്").containsMatchIn(text)
    if (snooze) {
        val explicit = Regex("(?<!\\d)(\\d{1,3})\\s*(?:min|minute|മിനി)").find(text)?.groupValues?.get(1)?.toIntOrNull()
        val named = when { Regex("\\bten\\b|പത്ത്|പത്തു").containsMatchIn(text) -> 10; Regex("\\bfive\\b|അഞ്ച്").containsMatchIn(text) -> 5; else -> null }
        val minutes = explicit ?: named
        if (minutes != null && minutes in 1..120) return CompanionCommand.Snooze(minutes)
    }
    if (Regex("\\b(call|phone|dial)\\b|വിളിക്ക|വിളിക്ക്").containsMatchIn(text)) {
        val relation = when {
            Regex("\\bson\\b|മകൻ|മകനെ").containsMatchIn(text) -> "son"
            Regex("\\bdaughter\\b|മകൾ|മകളെ").containsMatchIn(text) -> "daughter"
            Regex("\\b(child|children)\\b|മക്കളെ").containsMatchIn(text) -> "child"
            else -> null
        }
        val named = contacts.filter { it.name.isNotBlank() && text.contains(it.name.lowercase()) }
        val candidates = if (named.isNotEmpty()) named else contacts.filter { relation != null && (it.relation == relation || relation == "child" && it.relation in listOf("son", "daughter", "child")) }
        return CompanionCommand.Call(candidates)
    }
    return null
}
