package `in`.orma.reminders

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import `in`.orma.R
import `in`.orma.core.theme.LargeButton
import `in`.orma.data.Slot
import `in`.orma.data.today

@Composable
fun NotificationControls(assistantOnly: Boolean = false) {
    val context = LocalContext.current
    var message by remember { mutableStateOf("") }
    var pendingAction by remember { mutableStateOf("demo") }
    fun act(action: String) {
        when (action) {
            "assistant" -> { message = context.getString(if (Reminders.pinSpeak(context)) R.string.pin_success else R.string.notifications_off) }
            "schedule" -> {
                val exact = Reminders.schedule(context, "farhan", Slot.morning, today(), System.currentTimeMillis() + 60_000)
                message = context.getString(if (exact) R.string.reminder_scheduled else R.string.reminder_inexact)
            }
            else -> { message = context.getString(if (Reminders.show(context)) R.string.reminder_shown else R.string.notifications_off) }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) act(pendingAction) else message = context.getString(R.string.notifications_off)
    }
    fun request(action: String) {
        pendingAction = action
        if (Reminders.permitted(context)) act(action)
        else if (Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.checkin_permissions_help))
        LargeButton(stringResource(R.string.checkin_permissions), Modifier.fillMaxWidth()) {
            request("assistant")
        }
        if (Build.VERSION.SDK_INT >= 31 && !Reminders.exactPermitted(context)) {
            LargeButton(stringResource(R.string.precise_alarms), Modifier.fillMaxWidth()) {
                context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}")))
            }
        }
        if (Build.VERSION.SDK_INT >= 34 && !context.getSystemService(android.app.NotificationManager::class.java).canUseFullScreenIntent()) {
            LargeButton(stringResource(R.string.allow_fullscreen), Modifier.fillMaxWidth()) {
                context.startActivity(Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:${context.packageName}")))
            }
        }
        if (assistantOnly) LargeButton(stringResource(R.string.pin_speak), Modifier.fillMaxWidth()) { request("assistant") }
        else {
            LargeButton(stringResource(R.string.demo_reminder), Modifier.fillMaxWidth()) { request("demo") }
            LargeButton(stringResource(R.string.minute_reminder), Modifier.fillMaxWidth()) { request("schedule") }
            if (Build.VERSION.SDK_INT >= 31) {
                TextButton({ context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))) }, Modifier.heightIn(min = 64.dp)) {
                    Text(stringResource(R.string.precise_alarms))
                }
            }
        }
        if (message.isNotEmpty()) Text(message, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
}
