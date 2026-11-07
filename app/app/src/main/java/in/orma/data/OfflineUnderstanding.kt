package `in`.orma.data

/** Conservative on-phone fallback. A log requires explicit member, slot, count and taken verb. */
fun offlineUnderstanding(transcript: String): Understanding {
    fun heard(words: List<String>): String? = words.firstNotNullOfOrNull { word ->
        Regex("(?<![\\p{L}\\p{M}\\p{N}])${Regex.escape(word)}(?![\\p{L}\\p{M}\\p{N}])", RegexOption.IGNORE_CASE)
            .find(transcript)?.value
    }
    if (heard(listOf("yesterday", "tomorrow", "innale", "naale", "ഇന്നലെ", "നാളെ", "last")) != null ||
        Regex("\\d{4}-\\d{2}-\\d{2}").containsMatchIn(transcript)) {
        return Understanding(transcript = transcript, question = "These controls record today's doses only. Please check the date with your supporter.")
    }
    val negative = heard(listOf("kazhichilla", "കഴിച്ചില്ല", "illa", "ഇല്ല", "not", "didn't", "never"))
    if (negative != null) return Understanding(transcript = transcript,
        question = "I heard that a dose may not have been taken. Nothing was logged. Please check the member and slot below.")

    val members = mutableListOf<String>()
    val evidence = mutableListOf<Evidence>()
    val both = heard(listOf("randuperum", "രണ്ടുപേരും", "both"))
    if (both != null) { members += listOf("achan", "amma"); evidence += Evidence("members", both) }
    else {
        listOf("achan" to listOf("Achan", "അച്ഛൻ", "അച്ഛന്"), "amma" to listOf("Amma", "അമ്മ")).forEach { (id, words) ->
            heard(words)?.let { members += id; evidence += Evidence("members", it) }
        }
    }
    val slots = listOf(
        Slot.morning to listOf("raavile", "ravile", "morning", "രാവിലെ"),
        Slot.noon to listOf("uchakku", "uchaykku", "noon", "ഉച്ചയ്ക്ക്", "ഉച്ചക്ക്"),
        Slot.night to listOf("raathri", "rathri", "night", "രാത്രി")
    ).mapNotNull { (slot, words) -> heard(words)?.let { slot to it } }
    val selectedSlot = slots.singleOrNull()
    selectedSlot?.let { evidence += Evidence("slot", it.second) }
    val numberWords = listOf(
        listOf("1", "one", "onnu", "ഒന്ന്"), listOf("2", "two", "randu", "രണ്ട്"),
        listOf("3", "three", "moonnu", "മൂന്ന്"), listOf("4", "four", "naalu", "നാല്"),
        listOf("5", "five", "anchu", "അഞ്ച്"), listOf("6", "six", "aaru", "ആറ്"),
        listOf("7", "seven", "ezhu", "ഏഴ്"), listOf("8", "eight", "ettu", "എട്ട്"),
        listOf("9", "nine", "onpathu", "ഒമ്പത്")
    ).mapIndexedNotNull { index, words -> heard(words)?.let { index + 1 to it } }
    val count = numberWords.singleOrNull()
    count?.let { evidence += Evidence("count", it.second) }
    val ask = heard(listOf("kazhicho", "കഴിച്ചോ", "did", "taken?")) != null || transcript.contains('?')
    val taken = heard(listOf("kazhichu", "കഴിച്ചു", "took"))
    val complete = members.isNotEmpty() && selectedSlot != null && (ask || (count != null && taken != null))
    return Understanding(
        intent = if (ask) "ask" else if (taken != null) "log" else "unclear",
        transcript = transcript, memberIds = members, slot = selectedSlot?.first, countTaken = count?.first,
        evidence = verifiedEvidence(transcript, evidence), needsClarification = !complete,
        question = when {
            members.isEmpty() -> "Who took it: Achan, Amma, or both?"
            selectedSlot == null -> "Which dose: morning, noon, or night?"
            count == null && !ask -> "How many tablets did you take?"
            else -> "Please check who, when and how many before recording."
        }
    )
}
