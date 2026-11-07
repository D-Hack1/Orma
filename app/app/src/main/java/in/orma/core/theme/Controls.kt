package `in`.orma.core.theme

import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.dp

@Composable
fun LargeButton(label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    var lastTap by remember { mutableLongStateOf(0L) }
    Button(onClick = {
        val now = SystemClock.elapsedRealtime()
        if (now - lastTap >= 400) { lastTap = now; onClick() }
    }, modifier = modifier.heightIn(min = 64.dp).semantics { contentDescription = label }, enabled = enabled,
        shape = MaterialTheme.shapes.large, contentPadding = PaddingValues(16.dp)) {
        Text(label, style = MaterialTheme.typography.titleMedium)
    }
}
