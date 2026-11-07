package `in`.orma.feature.caregiver

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import `in`.orma.R
import `in`.orma.core.l10n.*
import `in`.orma.core.theme.*
import `in`.orma.data.*
import `in`.orma.feature.OrmaViewModel
import `in`.orma.feature.onboarding.SetupToggle
import java.util.UUID

@Composable
fun FamilyManagementScreen(model: OrmaViewModel, openSchedules: () -> Unit) {
    val context = LocalContext.current
    val session by model.session.collectAsStateWithLifecycle()
    val records by model.records.collectAsStateWithLifecycle()
    val action by model.setup.collectAsStateWithLifecycle()
    var name by rememberSaveable { mutableStateOf("") }
    var relation by rememberSaveable { mutableStateOf("child") }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text(stringResource(R.string.family_manage), fontSize = 30.sp)
        Text(session.familyName, fontSize = 24.sp)
        LargeButton(stringResource(R.string.refresh_family), Modifier.fillMaxWidth()) { model.refresh() }
        if (session.role in listOf("supporter", "independent")) {
            Text(stringResource(R.string.add_parent), fontSize = 26.sp)
            OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.parent_name)) }, modifier = Modifier.fillMaxWidth().testTag("parent-name"))
            Text(stringResource(R.string.i_am), fontSize = 22.sp)
            listOf("son" to R.string.son, "daughter" to R.string.daughter, "child" to R.string.child).forEach { (id, label) -> LargeChoice(stringResource(label), relation == id) { relation = id } }
            LargeButton(stringResource(R.string.add_member), Modifier.fillMaxWidth().testTag("add-parent"), name.isNotBlank() && !action.busy) { model.addParent(name, relation, if (context.isMalayalam()) "ml" else "en") }
        }
        if (records.members.isEmpty()) Text(stringResource(R.string.no_members), fontSize = 22.sp)
        records.members.forEach { member ->
            Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(member.name, fontSize = 26.sp)
                    if (member.awaitingAccount) Text(stringResource(R.string.member_waiting))
                    if (member.canManage) LargeButton(stringResource(R.string.configure_medicines), Modifier.fillMaxWidth()) { openSchedules() }
                    else Text(stringResource(R.string.schedule_private))
                    if (session.role == "supporter") {
                        if (member.awaitingAccount) LargeButton(stringResource(R.string.invite_parent), Modifier.fillMaxWidth().testTag("invite-${member.id}")) { model.invite(member.id, "member", relation) }
                        LargeButton(stringResource(R.string.invite_nurse), Modifier.fillMaxWidth()) { model.invite(member.id, "nurse", "other") }
                    }
                }
            }
        }
        if (session.role == "supporter") LargeButton(stringResource(R.string.invite_supporter), Modifier.fillMaxWidth()) { model.invite(null, "supporter", relation) }
        if (action.invitation.isNotBlank()) {
            SelectionContainer { Text(stringResource(R.string.invitation_code, action.invitation), Modifier.testTag("invitation-code"), fontSize = 30.sp) }
            Text(stringResource(R.string.invitation_help), fontSize = 20.sp)
        }
        if (action.busy) CircularProgressIndicator()
        if (action.failed) Text(stringResource(R.string.setup_failed), color = MaterialTheme.colorScheme.error)
    }
}

private data class DraftMedicine(val id: String = "med-${UUID.randomUUID().toString().take(12)}", val name: String = "", val strength: String = "", val count: String = "1", val stock: String = "0", val purpose: String = "", val critical: Boolean = false)

@Composable
fun ScheduleEditorScreen(model: OrmaViewModel) {
    val records by model.records.collectAsStateWithLifecycle()
    val action by model.setup.collectAsStateWithLifecycle()
    val available = records.members.filter { it.canManage }
    var memberId by rememberSaveable { mutableStateOf(available.firstOrNull()?.id.orEmpty()) }
    var slot by rememberSaveable { mutableStateOf(Slot.morning) }
    val existing = records.schedules.firstOrNull { it.memberId == memberId && it.slot == slot }
    var time by remember(memberId, slot, existing?.time) { mutableStateOf(existing?.time ?: slot.time) }
    var afterFood by remember(memberId, slot) { mutableStateOf(existing?.afterFood ?: true) }
    var confirmed by remember(memberId, slot) { mutableStateOf(false) }
    val drafts = remember(memberId, slot, existing) {
        mutableStateListOf<DraftMedicine>().apply {
            addAll(existing?.medicines?.map { DraftMedicine(it.id, it.name, it.strength, it.count.toString(), it.stock.toString(), it.purpose, it.timeCritical) } ?: listOf(DraftMedicine()))
        }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text(stringResource(R.string.configure_medicines), fontSize = 30.sp)
        Text(stringResource(R.string.choose_person), fontSize = 24.sp)
        available.forEach { member -> LargeChoice(member.name, memberId == member.id) { memberId = member.id; model.resetSetupMessage() } }
        if (available.isEmpty()) Text(stringResource(R.string.schedule_private))
        Text(stringResource(R.string.choose_slot), fontSize = 24.sp)
        val context = LocalContext.current
        Slot.entries.forEach { value -> LargeChoice(context.slotName(value), slot == value) { slot = value; model.resetSetupMessage() } }
        OutlinedTextField(time, { time = it; confirmed = false }, label = { Text(stringResource(R.string.medicine_time)) }, modifier = Modifier.fillMaxWidth().testTag("schedule-time"), singleLine = true)
        drafts.forEachIndexed { index, draft ->
            Card {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    OutlinedTextField(draft.name, { drafts[index] = draft.copy(name = it); confirmed = false }, label = { Text(stringResource(R.string.medicine_name)) }, modifier = Modifier.fillMaxWidth().testTag("medicine-name-$index"))
                    OutlinedTextField(draft.strength, { drafts[index] = draft.copy(strength = it); confirmed = false }, label = { Text(stringResource(R.string.medicine_strength)) }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(draft.count, { drafts[index] = draft.copy(count = it); confirmed = false }, label = { Text(stringResource(R.string.tablet_count)) }, modifier = Modifier.fillMaxWidth().testTag("medicine-count-$index"))
                    OutlinedTextField(draft.stock, { drafts[index] = draft.copy(stock = it); confirmed = false }, label = { Text(stringResource(R.string.stock_count)) }, modifier = Modifier.fillMaxWidth().testTag("medicine-stock-$index"))
                    OutlinedTextField(draft.purpose, { drafts[index] = draft.copy(purpose = it); confirmed = false }, label = { Text(stringResource(R.string.medicine_purpose)) }, modifier = Modifier.fillMaxWidth())
                    SetupToggle(stringResource(R.string.time_critical), draft.critical) { drafts[index] = draft.copy(critical = it); confirmed = false }
                }
            }
        }
        LargeButton(stringResource(R.string.add_medicine), Modifier.fillMaxWidth(), drafts.size < 12) { drafts += DraftMedicine(); confirmed = false }
        SetupToggle(stringResource(R.string.after_food), afterFood) { afterFood = it; confirmed = false }
        SetupToggle(stringResource(R.string.confirm_schedule), confirmed) { confirmed = it }
        val valid = available.any { it.id == memberId } && time.matches(Regex("^([01]\\d|2[0-3]):[0-5]\\d$")) && drafts.all { it.name.isNotBlank() && (it.count.toIntOrNull() ?: 0) in 1..20 && (it.stock.toIntOrNull() ?: -1) in 0..10000 }
        LargeButton(stringResource(R.string.save_schedule), Modifier.fillMaxWidth().testTag("save-schedule"), valid && confirmed && !action.busy) {
            val medicines = drafts.map { draft ->
                val reused = records.schedules.filter { it.memberId == memberId }.flatMap { it.medicines }.firstOrNull { it.name.equals(draft.name.trim(), true) && it.strength.equals(draft.strength.trim(), true) }
                Medicine(reused?.id ?: draft.id, draft.name.trim(), draft.strength.trim(), draft.count.toInt(), draft.stock.toInt(), draft.purpose.trim(), draft.critical)
            }
            model.saveSchedule(DoseSchedule(memberId, slot, time, medicines, afterFood))
        }
        if (action.busy) CircularProgressIndicator()
        if (action.complete && !action.failed) Text(stringResource(R.string.schedule_saved), fontSize = 22.sp)
        if (action.failed) Text(stringResource(R.string.setup_failed), color = MaterialTheme.colorScheme.error)
    }
}

@Composable
fun FamilyContactScreen(model: OrmaViewModel) {
    val records by model.records.collectAsStateWithLifecycle()
    val session by model.session.collectAsStateWithLifecycle()
    var call by remember { mutableStateOf<FamilyContact?>(null) }
    var recipient by remember { mutableStateOf("") }
    var message by rememberSaveable { mutableStateOf("") }
    val conversation by model.conversation.collectAsStateWithLifecycle()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        Text(stringResource(R.string.family_contacts), fontSize = 30.sp)
        if (records.contacts.isEmpty()) Text(stringResource(R.string.no_contacts))
        records.contacts.forEach { contact ->
            LargeButton(stringResource(R.string.call_contact, contact.name), Modifier.fillMaxWidth(), contact.phone.isNotBlank()) { call = contact }
            if (contact.phone.isBlank()) Text(stringResource(R.string.phone_missing))
            LargeChoice(contact.name, recipient == contact.uid) { recipient = contact.uid }
        }
        OutlinedTextField(message, { message = it }, label = { Text(stringResource(R.string.message_text)) }, modifier = Modifier.fillMaxWidth())
        LargeButton(stringResource(R.string.send_message), Modifier.fillMaxWidth(), recipient.isNotBlank() && message.isNotBlank() && session.deviceMemberIds.isNotEmpty() && !conversation.busy) {
            model.sendMessage(session.deviceMemberIds.first(), recipient, message)
        }
        val context = LocalContext.current
        conversation.reply?.let { Text(context.replyText(it), fontSize = 22.sp) }
        if (conversation.failed) Text(stringResource(R.string.action_error), color = MaterialTheme.colorScheme.error)
    }
    call?.let { ContactCallSheet(it) { call = null } }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContactCallSheet(contact: FamilyContact, dismiss: () -> Unit) {
    val context = LocalContext.current
    fun dial(direct: Boolean) {
        val intent = Intent(if (direct) Intent.ACTION_CALL else Intent.ACTION_DIAL, Uri.fromParts("tel", contact.phone, null))
        runCatching { context.startActivity(intent) }
        dismiss()
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { dial(it) }
    ModalBottomSheet(onDismissRequest = dismiss) {
        Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Text(stringResource(R.string.call_confirm, contact.name), fontSize = 28.sp)
            Text(contact.phone, fontSize = 24.sp)
            LargeButton(stringResource(R.string.call_contact, contact.name), Modifier.fillMaxWidth(), contact.phone.isNotBlank()) {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.CALL_PHONE) == PackageManager.PERMISSION_GRANTED) dial(true)
                else permission.launch(Manifest.permission.CALL_PHONE)
            }
            LargeButton(stringResource(R.string.cancel), Modifier.fillMaxWidth(), onClick = dismiss)
        }
    }
}
