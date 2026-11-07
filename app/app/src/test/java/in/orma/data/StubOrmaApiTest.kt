package `in`.orma.data

import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class StubOrmaApiTest {
    private val fixture = Json.decodeFromString<DemoFixture>(
        requireNotNull(javaClass.classLoader?.getResourceAsStream("demo-fixture.json")).bufferedReader().use { it.readText() })
    private fun api(initial: LocalState = LocalState(), persist: (LocalState) -> Unit = {}) = StubOrmaApi(fixture, initial, persist) { "2026-11-07T02:45:00Z" }
    private fun request(member: String = "amma", count: Int = 3, slot: Slot = Slot.morning) =
        LogRequest(memberId = member, date = "2026-11-07", slot = slot, countTaken = count, by = member)

    @Test fun `concurrent duplicate requests create exactly one record`() = runTest {
        val api = api()
        val results = List(12) { async { api.logDose(request()) } }.awaitAll()
        assertEquals(1, results.count { it.result == "logged" })
        assertEquals(11, results.count { it.result == "duplicate_blocked" })
        assertEquals(1, api.state.value.doses.size)
    }

    @Test fun `partial log cannot be silently overwritten or topped up`() = runTest {
        val api = api()
        assertEquals(DoseStatus.partial, api.logDose(request(count = 2)).status)
        assertEquals("duplicate_blocked", api.logDose(request(count = 1)).result)
        assertEquals(2, api.state.value.doses.single().countTaken)
    }

    @Test fun `no record returns unknown without inventing a citation or sent alert`() = runTest {
        val reply = api().askStatus("amma", "2026-11-07", Slot.night)
        assertTrue(reply.textEn.contains("Please wait"))
        assertTrue(reply.textEn.contains("cannot send an alert"))
        assertTrue(reply.sentences.isEmpty())
    }

    @Test fun `confirmed answer cites an existing exact dose record`() = runTest {
        val api = api()
        api.logDose(request())
        val reply = api.askStatus("amma", "2026-11-07", Slot.morning)
        assertEquals(listOf(api.state.value.doses.single().id), reply.sentences.single().cites)
    }

    @Test fun `saved records preserve duplicate protection after restart`() = runTest {
        var saved = LocalState()
        api(persist = { saved = it }).logDose(request())
        assertEquals("duplicate_blocked", api(saved).logDose(request()).result)
    }

    @Test fun `disk write failure does not announce successful logging`() = runTest {
        val api = api(persist = { error("Disk unavailable") })
        try { api.logDose(request()); fail("Expected persistence failure") } catch (_: IllegalStateException) { }
        assertTrue(api.state.value.doses.isEmpty())
    }

    @Test fun `invalid tablet counts never write a record`() = runTest {
        val api = api()
        for (count in listOf(-1, 0, 4)) {
            try { api.logDose(request(count = count)); fail("Invalid count accepted") } catch (_: IllegalArgumentException) { }
        }
        assertTrue(api.state.value.doses.isEmpty())
    }

    @Test fun `caregiver cannot change member sharing`() = runTest {
        val api = api()
        try { api.setSharing("amma", "anu", Sharing(counts = true)); fail("Supporter was permitted") } catch (_: IllegalArgumentException) { }
        assertTrue(api.state.value.sharing.isEmpty())
        api.setSharing("amma", "amma", Sharing(counts = true))
        assertTrue(api.state.value.sharing.getValue("amma").counts)
    }

    @Test fun `every demo phrase yields only spans actually heard`() = runTest {
        val api = api()
        fixture.phrases.forEach { phrase ->
            val result = api.understand(phrase.transcript)
            result.evidence.forEach { assertTrue(result.transcript.contains(it.span)) }
            assertEquals(phrase.intent, result.intent)
        }
    }

    @Test fun `ambiguous speaker and unrecognised phrases cannot log`() = runTest {
        val api = api()
        assertTrue(api.understand("Kazhichu").needsClarification)
        assertTrue(api.understand("something completely different").needsClarification)
        assertTrue(api.state.value.doses.isEmpty())
    }

    @Test fun `invented evidence is rejected and forces clarification`() = runTest {
        val phrase = fixture.phrases.first()
        val corrupt = phrase.copy(evidence = phrase.evidence.map { if (it.field == "members") it.copy(span = "not in transcript") else it })
        val api = StubOrmaApi(fixture.copy(phrases = listOf(corrupt)))
        val result = api.understand(phrase.transcript)
        assertTrue(result.needsClarification)
        assertFalse(result.evidence.any { it.field == "members" })
    }

    @Test fun `group logging creates separate cited records`() = runTest {
        val api = api()
        listOf("amma", "achan").forEach { api.logDose(request(it)) }
        assertEquals(2, api.state.value.doses.size)
        assertEquals(2, api.state.value.doses.map { it.id }.distinct().size)
    }
}
