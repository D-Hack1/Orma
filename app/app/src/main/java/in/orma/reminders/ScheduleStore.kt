package `in`.orma.reminders

import android.content.Context
import android.content.Intent
import android.content.BroadcastReceiver
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import `in`.orma.data.*
import java.time.LocalDate
import java.time.LocalTime

/** Confirmed schedules survive process death and reboot. No offline dose writes. */
object ScheduleStore {
    private fun prefs(context: Context) = context.getSharedPreferences("orma-schedules", Context.MODE_PRIVATE)
    fun cached(context: Context): LocalState = runCatching { Json.decodeFromString<LocalState>(prefs(context).getString("state", "{}").orEmpty()) }.getOrDefault(LocalState())
    fun sync(context: Context, state: LocalState, session: AccountSession) {
        val selected = if (session.role in listOf("assisted", "independent")) session.deviceMemberIds else emptyList()
        val local = state.copy(members = state.members.filter { it.id in selected }, schedules = state.schedules.filter { it.memberId in selected }, contacts = emptyList())
        val encoded = Json.encodeToString(local)
        if (prefs(context).getString("state", "") == encoded && prefs(context).getString("day", "") == today()) return
        cancel(context)
        prefs(context).edit().putString("state", encoded).putString("day", today()).apply()
        restore(context)
    }
    fun snooze(context: Context, memberId: String, slot: Slot, at: Long) {
        prefs(context).edit().putLong("snooze-$memberId-${slot.name}", at).apply()
        Reminders.schedule(context, memberId, slot, today(), at)
    }
    fun restore(context: Context) {
        val state = cached(context)
        val keys = mutableSetOf<String>()
        state.schedules.forEach { schedule ->
            var date = LocalDate.now(KeralaZone)
            var whenDue = date.atTime(LocalTime.parse(schedule.time)).atZone(KeralaZone).toInstant().toEpochMilli()
            val snoozed = prefs(context).getLong("snooze-${schedule.memberId}-${schedule.slot.name}", 0)
            val recorded = state.doses.any { it.memberId == schedule.memberId && it.slot == schedule.slot && it.date == date.toString() }
            if (snoozed > System.currentTimeMillis() && !recorded) whenDue = snoozed
            else if (whenDue <= System.currentTimeMillis() || recorded) {
                date = date.plusDays(1)
                whenDue = date.atTime(LocalTime.parse(schedule.time)).atZone(KeralaZone).toInstant().toEpochMilli()
            }
            Reminders.schedule(context, schedule.memberId, schedule.slot, date.toString(), whenDue)
            keys += "${schedule.memberId}|${schedule.slot.name}|$date"
        }
        prefs(context).edit().putStringSet("alarms", keys).apply()
    }
    private fun cancel(context: Context) {
        prefs(context).getStringSet("alarms", emptySet()).orEmpty().forEach { key ->
            val parts = key.split('|')
            if (parts.size == 3) Reminders.cancel(context, parts[0], Slot.valueOf(parts[1]), parts[2])
        }
    }
    fun clear(context: Context) { cancel(context); prefs(context).edit().clear().apply() }
}

class ScheduleRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { ScheduleStore.restore(context) }
}
