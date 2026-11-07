package `in`.orma.audio

import android.content.Context
import android.os.VibrationEffect
import android.os.Vibrator

fun feedback(context: Context, blocked: Boolean = false) {
    val vibrator = context.getSystemService(Vibrator::class.java)
    vibrator?.vibrate(VibrationEffect.createOneShot(if (blocked) 450 else 70, VibrationEffect.DEFAULT_AMPLITUDE))
}
