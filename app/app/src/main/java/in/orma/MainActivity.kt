package `in`.orma

import android.os.Bundle
import android.content.Context
import `in`.orma.core.l10n.AppLanguage
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.compose.runtime.mutableStateOf
import `in`.orma.feature.OrmaViewModel
import `in`.orma.feature.OrmaApp
import `in`.orma.core.theme.OrmaTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
open class MainActivity : ComponentActivity() {
    override fun attachBaseContext(newBase: Context) { super.attachBaseContext(AppLanguage.wrap(newBase)) }
    private val model: OrmaViewModel by viewModels()
    private val openSpeak = mutableStateOf(false)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        openSpeak.value = intent.getBooleanExtra("open_speak", false)
        setContent { OrmaTheme { OrmaApp(model, openSpeak.value) { openSpeak.value = false } } }
    }
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        openSpeak.value = intent.getBooleanExtra("open_speak", false)
    }
}
