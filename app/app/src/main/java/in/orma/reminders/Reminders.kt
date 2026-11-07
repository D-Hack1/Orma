package `in`.orma.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Notification
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dagger.hilt.android.AndroidEntryPoint
import `in`.orma.R
import `in`.orma.MainActivity
import `in`.orma.assistant.AssistActivity
import `in`.orma.data.*
import `in`.orma.core.l10n.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import javax.inject.Inject

private const val CHANNEL = "orma_quiet_v1"
private const val NOTIFICATION_ID = 410
private const val REMIND = "in.orma.REMIND"
private const val TAKEN = "in.orma.TAKEN"
private const val SNOOZE = "in.orma.SNOOZE"

object Reminders {
    fun permitted(context: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun channel(context: Context) {
        val strings = AppLanguage.wrap(context)
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, strings.getString(R.string.quiet_channel), NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = strings.getString(R.string.quiet_channel_description)
                setSound(null, null); enableVibration(false)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
            })
    }

    private fun post(context: Context, id: Int, notification: Notification): Boolean {
        if (!permitted(context)) return false
        return try {
            NotificationManagerCompat.from(context).notify(id, notification)
            true
        } catch (_: SecurityException) { false } // Permission can be revoked after the check.
    }

    private fun action(context: Context, action: String, memberId: String, slot: Slot, date: String): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(action)
            .setData(Uri.parse("orma://reminders/$memberId/$date/${slot.name}/$action"))
            .putExtra("memberId", memberId).putExtra("slot", slot.name).putExtra("date", date)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    fun show(context: Context, memberId: String = "farhan", slot: Slot = Slot.morning, date: String = today()): Boolean {
        if (!permitted(context)) return false
        channel(context)
        val strings = AppLanguage.wrap(context)
        val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_orma)
            .setContentTitle(strings.getString(R.string.reminder_title, strings.slotName(slot)))
            .setContentText(strings.getString(R.string.reminder_body, date))
            .setContentIntent(open).setSilent(true).setAutoCancel(false)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .addAction(0, strings.getString(R.string.status_taken), action(context, TAKEN, memberId, slot, date))
            .addAction(0, strings.getString(R.string.later_30), action(context, SNOOZE, memberId, slot, date)).build()
        return post(context, NOTIFICATION_ID, notification)
    }

    fun result(context: Context, text: String) {
        if (!permitted(context)) return
        channel(context)
        post(context, NOTIFICATION_ID,
            NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_orma)
                .setContentTitle(AppLanguage.wrap(context).getString(R.string.notification_checked)).setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setContentText(text).setSilent(true).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build())
    }

    fun pinSpeak(context: Context): Boolean {
        if (!permitted(context)) return false
        channel(context)
        val speak = PendingIntent.getActivity(context, 1, Intent(context, AssistActivity::class.java).setAction(Intent.ACTION_ASSIST), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return post(context, 411, NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_orma).setContentTitle(AppLanguage.wrap(context).getString(R.string.speak))
            .setContentText(AppLanguage.wrap(context).getString(R.string.notification_speak_body)).setContentIntent(speak)
            .setSilent(true).setOngoing(true).setVisibility(NotificationCompat.VISIBILITY_PUBLIC).build())
    }

    fun exactPermitted(context: Context): Boolean = Build.VERSION.SDK_INT < 31 || context.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    /** Returns whether Android permits exact timing; an inexact alarm remains a safe fallback. */
    fun schedule(context: Context, memberId: String, slot: Slot, date: String, atMillis: Long): Boolean {
        val alarm = context.getSystemService(AlarmManager::class.java)
        val pending = action(context, REMIND, memberId, slot, date)
        if (exactPermitted(context)) {
            try { alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending); return true }
            catch (_: SecurityException) { /* Permission may have changed after the check. */ }
        }
        alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending)
        return false
    }

    internal fun isReminder(intent: Intent) = intent.action == REMIND
    internal fun isTaken(intent: Intent) = intent.action == TAKEN
    internal fun isSnooze(intent: Intent) = intent.action == SNOOZE
}

@AndroidEntryPoint
class ReminderReceiver : BroadcastReceiver() {
    @Inject lateinit var api: OrmaApi
    override fun onReceive(context: Context, intent: Intent) {
        val strings = AppLanguage.wrap(context)
        val memberId = intent.getStringExtra("memberId") ?: return
        val slot = intent.getStringExtra("slot")?.let { runCatching { Slot.valueOf(it) }.getOrNull() } ?: return
        val date = intent.getStringExtra("date") ?: return
        val member = api.members.firstOrNull { it.id == memberId } ?: return
        val recordExists = api.state.value.doses.any { it.memberId == memberId && it.slot == slot && it.date == date }
        if (Reminders.isReminder(intent)) {
            if (!recordExists) Reminders.show(context, memberId, slot, date)
        } else if (Reminders.isSnooze(intent)) {
            if (recordExists) { Reminders.result(context, strings.getString(R.string.notification_duplicate)); return }
            val exact = Reminders.schedule(context, memberId, slot, date, System.currentTimeMillis() + 30 * 60_000)
            Reminders.result(context, strings.getString(if (exact) R.string.snoozed else R.string.reminder_inexact))
        } else if (Reminders.isTaken(intent)) {
            val pending = goAsync()
            CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
                try {
                    val result = api.logDose(LogRequest(memberId, date, slot, member.expected, source = "notification", by = memberId))
                    Reminders.result(context, strings.replyText(result.reply))
                } catch (_: Exception) { Reminders.result(context, strings.getString(R.string.notification_save_error)) }
                finally { pending.finish() }
            }
        }
    }
}
