package `in`.orma.data

import org.junit.Assert.*
import org.junit.Test

class OfflineUnderstandingTest {
    @Test fun malayalamSpeechRequiresExplicitFacts() {
        val result = offlineUnderstanding("അമ്മ രാവിലെ മൂന്ന് ഗുളിക കഴിച്ചു")
        assertEquals(listOf("amma"), result.memberIds)
        assertEquals(Slot.morning, result.slot)
        assertEquals(3, result.countTaken)
        assertEquals("log", result.intent)
        assertFalse(result.needsClarification)
        result.evidence.forEach { assertTrue(result.transcript.contains(it.span)) }
    }
    @Test fun sharedSpeakerAndMissingCountStayUnclear() {
        assertTrue(offlineUnderstanding("രാവിലെ മൂന്ന് ഗുളിക കഴിച്ചു").needsClarification)
        assertTrue(offlineUnderstanding("അമ്മ രാവിലെ ഗുളിക കഴിച്ചു").needsClarification)
        assertTrue(offlineUnderstanding("Amma morning 2 3 took").needsClarification)
    }
    @Test fun aNegativeOrMixedGroupCannotLog() {
        assertTrue(offlineUnderstanding("Amma raavile 3 gulika kazhichilla").needsClarification)
        assertTrue(offlineUnderstanding("Achan kazhichu Amma kazhichilla").needsClarification)
        assertTrue(offlineUnderstanding("അമ്മ രാവിലെ മൂന്ന് ഗുളിക കഴിച്ചില്ല").needsClarification)
    }
    @Test fun grandmotherDoesNotMatchMotherBySubstring() {
        assertTrue(offlineUnderstanding("അമ്മൂമ്മ രാവിലെ മൂന്ന് ഗുളിക കഴിച്ചു").memberIds.isEmpty())
    }
    @Test fun questionsNeverBecomeLogs() {
        val result = offlineUnderstanding("അമ്മ രാവിലെ ഗുളിക കഴിച്ചോ?")
        assertEquals("ask", result.intent)
        assertFalse(result.needsClarification)
    }
    @Test fun anotherDateIsNeverSilentlyTreatedAsToday() {
        assertTrue(offlineUnderstanding("Amma yesterday morning 3 tablets took").needsClarification)
        assertTrue(offlineUnderstanding("അമ്മ ഇന്നലെ രാവിലെ മൂന്ന് ഗുളിക കഴിച്ചു").needsClarification)
    }
}
