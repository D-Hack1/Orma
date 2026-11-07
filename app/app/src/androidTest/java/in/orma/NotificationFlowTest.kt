package `in`.orma

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import `in`.orma.data.LocalState
import `in`.orma.data.Slot
import `in`.orma.data.today
import `in`.orma.reminders.Reminders
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class NotificationFlowTest {
    @Test fun quietTakenActionPersistsOnceAndBlocksAnotherTap() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        if (Build.VERSION.SDK_INT >= 33) {
            ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation.executeShellCommand(
                "pm grant ${context.packageName} android.permission.POST_NOTIFICATIONS")).use { it.readBytes() }
        }
        assertTrue(Reminders.show(context, "farhan", Slot.morning))
        val manager = context.getSystemService(NotificationManager::class.java)
        val notification = manager.activeNotifications.first { it.id == 410 }.notification
        assertNull(manager.getNotificationChannel(notification.channelId).sound)
        assertFalse(manager.getNotificationChannel(notification.channelId).shouldVibrate())
        val taken = notification.actions.first { it.title.toString() == "Taken" }.actionIntent
        taken.send()
        waitUntil {
            readState(context).doses.count { it.memberId == "farhan" && it.date == today() && it.slot == Slot.morning } == 1
        }
        taken.send()
        waitUntil {
            manager.activeNotifications.firstOrNull { it.id == 410 }?.notification?.extras
                ?.getCharSequence("android.text")?.contains("already exists") == true
        }
        assertEquals(1, readState(context).doses.count { it.memberId == "farhan" && it.date == today() && it.slot == Slot.morning })
        manager.cancel(410)
    }

    private fun readState(context: Context): LocalState {
        val json = context.getSharedPreferences("orma-demo", Context.MODE_PRIVATE).getString("records", null) ?: return LocalState()
        return Json.decodeFromString<LocalState>(json)
    }

    private fun waitUntil(condition: () -> Boolean) {
        val deadline = SystemClock.elapsedRealtime() + 5_000
        while (SystemClock.elapsedRealtime() < deadline) {
            if (condition()) return
            SystemClock.sleep(50)
        }
        assertTrue("Notification action did not complete", condition())
    }
}
