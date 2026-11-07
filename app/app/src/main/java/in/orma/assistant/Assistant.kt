package `in`.orma.assistant

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.service.voice.VoiceInteractionSessionService
import `in`.orma.MainActivity
import dagger.hilt.android.AndroidEntryPoint
import android.content.ComponentName
import android.content.ActivityNotFoundException

class OrmaVoiceInteractionService : VoiceInteractionService()

class OrmaSessionService : VoiceInteractionSessionService() {
    override fun onNewSession(args: Bundle?): VoiceInteractionSession = OrmaSession(this)
}

class OrmaSession(context: Context) : VoiceInteractionSession(context) {
    override fun onShow(args: Bundle?, showFlags: Int) {
        super.onShow(args, showFlags)
        startAssistantActivity(Intent(context, AssistActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("open_speak", true))
        hide()
    }
}

@AndroidEntryPoint
class AssistActivity : MainActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        intent.putExtra("open_speak", true)
        super.onCreate(savedInstanceState)
    }
}

fun assistantSetupIntent(context: Context): Intent {
    if (Build.VERSION.SDK_INT >= 29) {
        val manager = context.getSystemService(RoleManager::class.java)
        if (manager.isRoleAvailable(RoleManager.ROLE_ASSISTANT)) {
            return manager.createRequestRoleIntent(RoleManager.ROLE_ASSISTANT)
        }
    }
    return Intent(Settings.ACTION_VOICE_INPUT_SETTINGS)
}

fun isOrmaAssistant(context: Context): Boolean {
    val component = Settings.Secure.getString(context.contentResolver, "voice_interaction_service")
        ?.let(ComponentName::unflattenFromString)
    return component?.packageName == context.packageName && component.className == OrmaVoiceInteractionService::class.java.name
}

fun assistantSettingsIntent(context: Context): Intent =
    listOf(Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS, Settings.ACTION_SETTINGS)
        .map(::Intent).first { it.resolveActivity(context.packageManager) != null }
