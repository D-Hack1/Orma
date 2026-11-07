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
