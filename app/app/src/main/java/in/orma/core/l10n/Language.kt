package `in`.orma.core.l10n

import android.app.Activity
import android.app.LocaleManager
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale
import `in`.orma.R
import `in`.orma.data.*

object AppLanguage {
    fun code(context: Context): String = context.getSharedPreferences("orma-settings", Context.MODE_PRIVATE)
        .getString("language", null) ?: if (context.resources.configuration.locales[0].language == "ml") "ml" else "en"

    fun wrap(context: Context): Context {
        val locale = Locale.forLanguageTag(if (code(context) == "ml") "ml-IN" else "en-IN")
        val config = Configuration(context.resources.configuration).apply { setLocale(locale) }
        return context.createConfigurationContext(config)
    }

    fun change(activity: Activity, code: String) {
        require(code in listOf("en", "ml"))
        activity.getSharedPreferences("orma-settings", Context.MODE_PRIVATE).edit().putString("language", code).apply()
        if (Build.VERSION.SDK_INT >= 33) {
            activity.getSystemService(LocaleManager::class.java).applicationLocales = LocaleList.forLanguageTags(code)
        } else activity.recreate()
    }
}

fun Context.isMalayalam() = resources.configuration.locales[0].language == "ml"
fun Context.memberName(id: String): String { return getString(when (id.lowercase()) {
    "achan" -> R.string.member_achan; "amma" -> R.string.member_amma
    "ammoomma" -> R.string.member_ammoomma; "rahul" -> R.string.member_rahul
    "farhan" -> R.string.member_farhan; "anu" -> R.string.member_anu
    "sister mini" -> R.string.member_mini; else -> return id
}) }
fun Context.slotName(slot: Slot) = getString(when (slot) {
    Slot.morning -> R.string.morning; Slot.noon -> R.string.noon; Slot.night -> R.string.night
})
fun Context.statusName(status: DoseStatus?) = getString(when (status) {
    DoseStatus.confirmed -> R.string.status_taken; DoseStatus.reported -> R.string.status_reported
    DoseStatus.partial -> R.string.status_partial; DoseStatus.pending -> R.string.status_pending
    else -> R.string.status_unknown
})
fun Context.roleName(role: String) = getString(when (role) {
    "Assisted" -> R.string.role_assisted; "Independent" -> R.string.role_independent
    "Nurse" -> R.string.role_nurse; else -> R.string.role_supporter
})
fun Context.sourceName(source: String) = getString(when (source) {
    "voice" -> R.string.source_voice; "notification" -> R.string.source_notification
    "family" -> R.string.source_family; "nurse" -> R.string.role_nurse; else -> R.string.source_tap
})
fun Context.replyText(reply: Reply) = if (isMalayalam()) reply.textMl.ifBlank { getString(R.string.translation_unavailable) } else reply.textEn

fun Context.clarification(heard: Understanding?): String = getString(when {
    heard == null -> R.string.prompt_details
    heard.question.contains("today", true) -> R.string.clarify_date
    heard.question.contains("not have", true) -> R.string.clarify_negative
    heard.memberIds.isEmpty() -> R.string.clarify_member
    heard.slot == null -> R.string.clarify_slot
    heard.countTaken == null && heard.intent != "ask" -> R.string.clarify_count
    else -> R.string.prompt_check
})
