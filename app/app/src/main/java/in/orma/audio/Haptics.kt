package `in`.orma.audio

import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator

fun feedback(context: Context, blocked: Boolean = false) {
    val vibrator = context.getSystemService(Vibrator::class.java)
    vibrator?.vibrate(if (blocked) VibrationEffect.createOneShot(450, VibrationEffect.DEFAULT_AMPLITUDE)
        else VibrationEffect.createWaveform(longArrayOf(0, 70, 100, 70), -1))
}
