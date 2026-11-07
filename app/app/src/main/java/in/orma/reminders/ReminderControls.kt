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
            "assistant" -> { Reminders.pinSpeak(context); message = "Speak shortcut added to notifications." }
            "schedule" -> {
                val exact = Reminders.schedule(context, "farhan", Slot.morning, today(), System.currentTimeMillis() + 60_000)
                message = if (exact) "Sample reminder scheduled in one minute." else "Sample reminder scheduled. Android may delay it; allow exact alarms for precise timing."
            }
            else -> { Reminders.show(context); message = "Silent sample reminder shown. Try Taken in the notification shade." }
        }
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) act(pendingAction) else message = "Notifications are off. You can still record doses using the app."
    }
    fun request(action: String) {
        pendingAction = action
        if (Reminders.permitted(context)) act(action)
        else if (Build.VERSION.SDK_INT >= 33) permission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (assistantOnly) LargeButton("Add Speak to notifications", Modifier.fillMaxWidth()) { request("assistant") }
        else {
            LargeButton("Try a silent demo reminder", Modifier.fillMaxWidth()) { request("demo") }
            LargeButton("Try a reminder in one minute", Modifier.fillMaxWidth()) { request("schedule") }
            if (Build.VERSION.SDK_INT >= 31) {
                TextButton({ context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))) }, Modifier.heightIn(min = 64.dp)) {
                    Text("Allow precise reminder times")
                }
            }
        }
        if (message.isNotEmpty()) Text(message, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
}
