package `in`.orma.core.theme

import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.ui.platform.testTag

@Composable
fun VoiceButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Column(modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Button(onClick = onClick, enabled = enabled, shape = CircleShape, contentPadding = PaddingValues(0.dp),
            modifier = Modifier.size(184.dp).testTag("microphone").semantics { contentDescription = label }) {
            Icon(Icons.Outlined.Mic, null, Modifier.size(76.dp))
        }
        Text(label, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
    }
}

@Composable
fun LargeButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, accessibilityLabel: String = label, onClick: () -> Unit) {
    var lastTap by remember { mutableLongStateOf(0L) }
    Button(onClick = {
        val now = SystemClock.elapsedRealtime()
        if (now - lastTap >= 400) { lastTap = now; onClick() }
    }, modifier = modifier.heightIn(min = 88.dp).widthIn(min = 88.dp).semantics { contentDescription = accessibilityLabel }, enabled = enabled,
        shape = MaterialTheme.shapes.large, contentPadding = PaddingValues(horizontal = 20.dp, vertical = 22.dp)) {
        Text(label, style = MaterialTheme.typography.titleLarge, fontSize = 22.sp, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun LargeChoice(label: String, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = modifier.fillMaxWidth().heightIn(min = 88.dp).semantics { this.selected = selected },
        border = androidx.compose.foundation.BorderStroke(if (selected) 3.dp else 1.dp, Forest),
        colors = ButtonDefaults.outlinedButtonColors(containerColor = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface),
        shape = MaterialTheme.shapes.large, contentPadding = PaddingValues(20.dp)) {
        Text(label, fontSize = 22.sp, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
    }
}
