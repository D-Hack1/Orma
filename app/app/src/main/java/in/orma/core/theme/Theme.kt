package `in`.orma.core.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Forest = Color(0xFF125845)
val Paper = Color(0xFFF7F8F2)
val Ink = Color(0xFF182C25)
val Muted = Color(0xFF496157)

@Composable
fun OrmaTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = lightColorScheme(
        primary = Forest, onPrimary = Color.White,
        primaryContainer = Color(0xFFDEECD9), onPrimaryContainer = Ink,
        secondaryContainer = Color(0xFFDEECD9), onSecondaryContainer = Forest,
        secondary = Color(0xFF485D2A), background = Paper, onBackground = Ink,
        surface = Color.White, onSurface = Ink, onSurfaceVariant = Muted,
        error = Color(0xFFA62F28), outline = Color(0xFF647B6D)
    ), content = content)
}
