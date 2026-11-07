@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package `in`.orma.feature

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import `in`.orma.R
import `in`.orma.assistant.*
import `in`.orma.audio.*
import `in`.orma.core.l10n.*
import `in`.orma.core.theme.*
import `in`.orma.data.*
import `in`.orma.reminders.NotificationControls
import `in`.orma.feature.onboarding.AccountSetupScreen
import `in`.orma.feature.caregiver.*
import java.time.LocalDate
import java.time.format.DateTimeFormatter

private fun Context.activity(): Activity? = when (this) {
    is Activity -> this; is ContextWrapper -> baseContext.activity(); else -> null
}

@Composable
fun OrmaApp(model: OrmaViewModel, openSpeak: Boolean, onOpened: () -> Unit) {
    val account by model.session.collectAsStateWithLifecycle()
    val accountRecords by model.records.collectAsStateWithLifecycle()
    if (!account.isDemo && (account.loading || !account.signedIn || account.familyId.isBlank())) { AccountSetupScreen(model); return }
    if (!account.isDemo && !account.deviceConfigured && accountRecords.members.isNotEmpty()) { AccountSetupScreen(model, deviceOnly = true); return }
    val nav = rememberNavController()
    var role by rememberSaveable { mutableStateOf("Supporter") }
    var roleMenu by remember { mutableStateOf(false) }
    val state by model.records.collectAsStateWithLifecycle()
    val conversation by model.conversation.collectAsStateWithLifecycle()
    var logMember by remember { mutableStateOf<Member?>(null) }
    var logSlot by remember { mutableStateOf(Slot.morning) }
    var explanation by remember { mutableStateOf(false) }
    val route = nav.currentBackStackEntryAsState().value?.destination?.route ?: "home"
    val context = LocalContext.current
    val speech = remember { SpeechController(context) }
    val languageTag = if (context.isMalayalam()) "ml-IN" else "en-IN"
    LaunchedEffect(account.role) {
        if (!account.isDemo) role = when (account.role) { "assisted" -> "Assisted"; "independent" -> "Independent"; "nurse" -> "Nurse"; else -> "Supporter" }
    }
    DisposableEffect(Unit) { onDispose { speech.close() } }
    LaunchedEffect(route) { if (route != "speak") speech.stop() }
    LaunchedEffect(openSpeak) {
        if (openSpeak) { role = "Assisted"; nav.navigate("speak") { launchSingleTop = true }; onOpened() }
    }
    LaunchedEffect(conversation.reply) {
        conversation.reply?.let {
            feedback(context, conversation.blocked)
            if (role == "Assisted" && route == "speak") speech.speak(languageTag, it.textMl, it.textEn)
        }
    }
    Scaffold(containerColor = Paper, topBar = {
        Column(Modifier.background(Paper).statusBarsPadding().padding(horizontal = 20.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (LocalDensity.current.fontScale < 1.5f) Text(stringResource(R.string.app_name), Modifier.weight(1f), fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Forest)
                else Icon(Icons.Outlined.Spa, null, Modifier.size(32.dp), tint = Forest)
                OutlinedButton(onClick = { speech.stop(); context.activity()?.let { AppLanguage.change(it, if (context.isMalayalam()) "en" else "ml") } },
                    modifier = Modifier.heightIn(min = 80.dp).then(if (LocalDensity.current.fontScale >= 1.5f) Modifier.weight(1f) else Modifier).testTag("language-switch"),
                    shape = RoundedCornerShape(20.dp), contentPadding = PaddingValues(16.dp)) {
                    Text(stringResource(R.string.language_switch), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
                }
                Box {
                    IconButton({ if (account.isDemo) roleMenu = true else nav.navigate("family") }, Modifier.size(80.dp).testTag("role-switch").semantics { contentDescription = context.getString(if (account.isDemo) R.string.switch_role else R.string.family_manage) }) {
                        Icon(Icons.Outlined.Person, null, Modifier.size(32.dp), tint = Forest)
                    }
                    DropdownMenu(roleMenu, { roleMenu = false }) {
                        listOf("Supporter", "Assisted", "Independent", "Nurse").forEach { item ->
                            DropdownMenuItem(text = { Text(context.roleName(item), fontSize = 20.sp) }, modifier = Modifier.heightIn(min = 88.dp), onClick = {
                                speech.stop(); role = item; roleMenu = false
                                nav.navigate("home") { popUpTo("home") { inclusive = true } }
                            })
                        }
                    }
                }
            }
            Text(context.roleName(role), color = Forest, style = MaterialTheme.typography.titleMedium)
            Text(stringResource(if (account.isDemo) R.string.local_demo else R.string.connected_server), style = MaterialTheme.typography.labelSmall, color = Muted,
                modifier = Modifier.padding(top = 4.dp, bottom = 10.dp))
        }
    }, bottomBar = {
        NavigationBar(containerColor = Color.White) {
            listOf(Triple("home", R.string.home, Icons.Outlined.Home), Triple("speak", R.string.speak_shortcut, Icons.Outlined.Mic), Triple("settings", R.string.settings, Icons.Outlined.Tune)).forEach { (destination, label, icon) ->
                NavigationBarItem(selected = route == destination, onClick = { nav.navigate(destination) { popUpTo("home"); launchSingleTop = true } },
                    icon = { Icon(icon, null, Modifier.size(30.dp)) }, label = { Text(stringResource(label), fontSize = 18.sp) }, modifier = Modifier.heightIn(min = 88.dp).testTag("nav-$destination"))
            }
        }
    }) { padding ->
        NavHost(nav, "home", Modifier.padding(padding)) {
            composable("home") {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    if (state.storageError) Notice(stringResource(R.string.logging_paused), stringResource(R.string.storage_error))
                    when (role) {
                        "Assisted" -> {
                            PageHeading(stringResource(R.string.assisted_title), stringResource(R.string.assisted_subtitle))
                            LargeButton(stringResource(R.string.speak), Modifier.fillMaxWidth().heightIn(min = 176.dp)) { nav.navigate("speak") }
                            model.members.filter { if (account.isDemo) it.id in listOf("achan", "amma") else it.id in account.deviceMemberIds }.forEach { member ->
                                MemberCard(member, state, true, { logMember = member; logSlot = it }, { model.explain(member.id, it); explanation = true })
                            }
                        }
                        "Independent" -> {
                            val member = model.members.firstOrNull { if (account.isDemo) it.id == "farhan" else it.isOwner } ?: return@Column
                            PageHeading(stringResource(R.string.independent_title), context.memberName(member.id))
                            Notice(stringResource(R.string.quiet_title), stringResource(R.string.quiet_body))
                            MemberCard(member, state, true, { logMember = member; logSlot = it }, { model.explain(member.id, it); explanation = true })
                            if (account.isDemo) NotificationControls()
                        }
                        else -> {
                            PageHeading(stringResource(if (role == "Nurse") R.string.patients_title else R.string.family_title),
                                LocalDate.now(KeralaZone).format(DateTimeFormatter.ofPattern("EEEE, d MMMM", context.resources.configuration.locales[0])))
                            if (role == "Supporter") {
                                val count = state.doses.count { it.date == today() && (!account.isDemo || it.memberId != "farhan") }
                                Card(colors = CardDefaults.cardColors(containerColor = Forest), shape = RoundedCornerShape(24.dp)) {
                                    Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(stringResource(R.string.doses_recorded, count), color = Color.White, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
                                        Text(stringResource(R.string.record_provenance), color = Color.White)
                                    }
                                }
                            } else Notice(stringResource(R.string.nurse_heading), stringResource(R.string.nurse_body))
                            if (!account.isDemo && role == "Supporter") {
                                LargeButton(stringResource(R.string.family_manage), Modifier.fillMaxWidth()) { nav.navigate("family") }
                                LargeButton(stringResource(R.string.configure_medicines), Modifier.fillMaxWidth()) { nav.navigate("schedule") }
                            }
                            if (model.members.isEmpty()) Text(stringResource(R.string.no_members), fontSize = 22.sp)
                            model.members.filter { if (role == "Nurse") it.nurseAssigned else !account.isDemo || it.id != "farhan" }.forEach { member ->
                                MemberCard(member, state, false, { logMember = member; logSlot = it }, { model.explain(member.id, it, privateView = false); explanation = true })
                            }
                            Notice(stringResource(R.string.consent_title), stringResource(R.string.consent_body))
                        }
                    }
                }
            }
            composable("speak") { SpeakScreen(model, conversation, speech, languageTag) }
            composable("family") { FamilyManagementScreen(model) { nav.navigate("schedule") } }
            composable("schedule") { ScheduleEditorScreen(model) }
            composable("contacts") { FamilyContactScreen(model) }
            composable("settings") {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    PageHeading(stringResource(R.string.make_yours), stringResource(R.string.settings_subtitle))
                    AssistantSetupControls()
                    NotificationControls(assistantOnly = true)
                    if (!account.isDemo) {
                        LargeButton(stringResource(R.string.family_manage), Modifier.fillMaxWidth()) { nav.navigate("family") }
                        LargeButton(stringResource(R.string.family_contacts), Modifier.fillMaxWidth()) { nav.navigate("contacts") }
                        LargeButton(stringResource(R.string.sign_out), Modifier.fillMaxWidth()) { model.signOut() }
                    }
                    if (role == "Assisted") {
                        var memberId by rememberSaveable { mutableStateOf(if (account.isDemo) "amma" else account.deviceMemberIds.firstOrNull().orEmpty()) }
                        Text(stringResource(R.string.sharing_heading), style = MaterialTheme.typography.titleLarge)
                        (if (account.isDemo) listOf("amma", "achan") else model.members.filter { it.isOwner }.map { it.id }).forEach { id -> LargeChoice(model.members.firstOrNull { it.id == id }?.name ?: context.memberName(id), memberId == id) { memberId = id } }
                        val sharing = state.sharing[memberId] ?: Sharing()
                        SharingToggle(stringResource(R.string.share_counts), sharing.counts) { model.share(memberId, sharing.copy(counts = it)) }
                        SharingToggle(stringResource(R.string.share_messages), sharing.messages) { model.share(memberId, sharing.copy(messages = it)) }
                        SharingToggle(stringResource(R.string.share_risk), sharing.risk) { model.share(memberId, sharing.copy(risk = it)) }
                        SharingToggle(stringResource(R.string.share_notes), sharing.nurseNotes) { model.share(memberId, sharing.copy(nurseNotes = it)) }
                        Text(stringResource(R.string.sharing_minimum), color = Muted)
                    } else Notice(stringResource(R.string.members_choose), stringResource(R.string.members_choose_body))
                    if (account.isDemo) Notice(stringResource(R.string.demo_setup), stringResource(R.string.demo_setup_body))
                }
            }
        }
    }
    logMember?.let { member ->
        val expected = model.expected(member.id, logSlot)
        var count by remember(member.id, logSlot) { mutableIntStateOf(expected) }
        ModalBottomSheet(onDismissRequest = { logMember = null }, containerColor = Paper) {
            SheetColumn {
                Text("${context.memberName(member.id)} · ${context.slotName(logSlot)}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                if (expected > 0) {
                    Text(if (account.isDemo) stringResource(R.string.record_instructions, expected) else stringResource(R.string.count_tablets, expected))
                    state.schedules.firstOrNull { it.memberId == member.id && it.slot == logSlot }?.medicines?.forEach { Text("${it.name} ${it.strength} · ${it.count}", fontSize = 22.sp) }
                    CountControls(count, expected, { count-- }, { count++ })
                } else Text(stringResource(R.string.no_schedule), fontSize = 22.sp)
                Text(stringResource(R.string.duplicate_instructions), color = Muted)
                LargeButton(stringResource(R.string.save_record), Modifier.fillMaxWidth(), !conversation.busy && count > 0) {
                    model.log(listOf(member.id), logSlot, count, source = when (role) { "Supporter" -> "family"; "Nurse" -> "nurse"; else -> "tap" },
                        by = when (role) { "Supporter" -> "Anu"; "Nurse" -> "Sister Mini"; else -> member.id })
                    logMember = null; explanation = true
                }
                if (!account.isDemo && expected > 0) LargeButton(stringResource(R.string.snooze_minutes, 10), Modifier.fillMaxWidth()) {
                    model.snooze(member.id, logSlot, 10); logMember = null; explanation = true
                }
                LargeButton(stringResource(R.string.cancel), Modifier.fillMaxWidth()) { logMember = null }
            }
        }
    }
    if (explanation) ModalBottomSheet(onDismissRequest = { explanation = false }, containerColor = Paper) {
        SheetColumn {
            Text(stringResource(if (conversation.blocked) R.string.check_before_more else R.string.from_records), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(conversation.reply?.let(context::replyText) ?: stringResource(if (conversation.busy) R.string.mic_processing else R.string.action_error), style = MaterialTheme.typography.bodyLarge)
            conversation.reply?.sentences?.flatMap { it.cites }?.distinct()?.forEach { Text(stringResource(R.string.source_record, it), color = Muted) }
            LargeButton(stringResource(R.string.done), Modifier.fillMaxWidth()) { explanation = false }
        }
    }
}

@Composable private fun SheetColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) { content(); Spacer(Modifier.height(16.dp)) }
}
@Composable private fun PageHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(subtitle, color = Muted, style = MaterialTheme.typography.bodyLarge)
        Text(title, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold)
    }
}
@Composable private fun Notice(title: String, body: String) {
    Column(Modifier.fillMaxWidth().background(Color(0xFFE9EEDC), RoundedCornerShape(20.dp)).padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleLarge)
        Text(body, style = MaterialTheme.typography.bodyLarge, color = Muted)
    }
}
@Composable private fun MemberCard(member: Member, state: LocalState, showPrivate: Boolean, onLog: (Slot) -> Unit, onWhy: (Slot) -> Unit) {
    val context = LocalContext.current
    Card(shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(context.memberName(member.id), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(stringResource(when (member.mode) { "keypad" -> R.string.keypad_phone; "independent" -> R.string.independent_phone; else -> R.string.home_phone }), color = Muted)
            Slot.entries.forEach { slot ->
                val record = state.doses.firstOrNull { it.memberId == member.id && it.date == today() && it.slot == slot }
                Column(Modifier.fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(20.dp)).background(Paper, RoundedCornerShape(20.dp))) {
                    Column(Modifier.fillMaxWidth().heightIn(min = 112.dp).clickable(onClickLabel = context.getString(R.string.record_taken)) { onLog(slot) }
                        .padding(20.dp).semantics(mergeDescendants = true) {
                            contentDescription = context.getString(R.string.dose_accessibility, context.memberName(member.id), context.slotName(slot), context.statusName(record?.status))
                        }.testTag("dose-${member.id}-${slot.name}"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(context.slotName(slot), fontSize = 24.sp, fontWeight = FontWeight.Bold)
                        Text("${slot.time} · ${context.statusName(record?.status)}", fontSize = 20.sp, color = Forest)
                        if (record != null && (showPrivate || state.sharing[member.id]?.counts == true)) Text("${record.countTaken}/${record.countExpected} · ${context.sourceName(record.source)}", fontSize = 18.sp)
                    }
                    OutlinedButton({ onWhy(slot) }, Modifier.fillMaxWidth().heightIn(min = 80.dp).padding(horizontal = 12.dp).semantics { contentDescription = context.getString(R.string.why_accessibility, context.memberName(member.id), context.slotName(slot)) }, shape = RoundedCornerShape(16.dp)) {
                        Text(stringResource(R.string.why), fontSize = 22.sp)
                    }
                    Spacer(Modifier.height(12.dp))
                }
            }
            if (!showPrivate && state.sharing[member.id]?.counts != true) Text(stringResource(R.string.privacy_counts, context.memberName(member.id)), color = Muted)
        }
    }
}
@Composable private fun SharingToggle(label: String, value: Boolean, changed: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 88.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), fontSize = 22.sp); Switch(value, changed, Modifier.sizeIn(minWidth = 80.dp, minHeight = 88.dp).semantics { contentDescription = label })
    }
}
@Composable private fun CountControls(count: Int, maximum: Int, decrease: () -> Unit, increase: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LargeButton("−", enabled = count > 1, accessibilityLabel = stringResource(R.string.decrease), onClick = decrease)
            Text(count.toString(), Modifier.weight(1f), fontSize = 32.sp, fontWeight = FontWeight.Bold, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            LargeButton("+", enabled = count < maximum, accessibilityLabel = stringResource(R.string.increase), onClick = increase)
        }
        Text(stringResource(R.string.count_tablets, count), fontSize = 22.sp)
    }
}

@Composable private fun AssistantSetupControls() {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var active by remember { mutableStateOf(isOrmaAssistant(context)) }
    var failed by remember { mutableStateOf(false) }
    fun openSettings() { try { context.startActivity(assistantSettingsIntent(context)) } catch (_: Exception) { failed = true } }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        active = isOrmaAssistant(context)
        if (!active) openSettings()
    }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_RESUME) active = isOrmaAssistant(context) }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer) }
    }
    Notice(stringResource(if (active) R.string.assistant_active else R.string.assistant_inactive), stringResource(R.string.assistant_instructions))
    LargeButton(stringResource(if (active) R.string.assistant_settings else R.string.assistant_setup), Modifier.fillMaxWidth().testTag("assistant-setup")) {
        if (active) openSettings() else try { picker.launch(assistantSetupIntent(context)) } catch (_: Exception) { openSettings() }
    }
    if (!active) LargeButton(stringResource(R.string.assistant_settings), Modifier.fillMaxWidth()) { openSettings() }
    LargeButton(stringResource(R.string.assistant_test), Modifier.fillMaxWidth()) { context.startActivity(Intent(context, AssistActivity::class.java).setAction(Intent.ACTION_ASSIST)) }
    Text(stringResource(R.string.assistant_test_help), color = Muted)
    if (failed) Text(stringResource(R.string.assistant_unavailable), color = MaterialTheme.colorScheme.error)
}

@Composable private fun SpeakScreen(model: OrmaViewModel, conversation: Conversation, speech: SpeechController, languageTag: String) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var micState by remember { mutableStateOf(SpeechState.Idle) }
    var issue by remember { mutableStateOf<SpeechIssue?>(null) }
    var level by remember { mutableFloatStateOf(0f) }
    var partial by remember { mutableStateOf("") }
    var transcript by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf("amma") }
    var slot by rememberSaveable { mutableStateOf(Slot.morning) }
    var count by rememberSaveable { mutableIntStateOf(3) }
    var sources by remember { mutableStateOf<Sentence?>(null) }
    fun startListening() {
        issue = null; partial = ""; level = 0f
        speech.listen(languageTag, { transcript = it; model.submit(it) }, { issue = it }, { micState = it }, { level = it }, { partial = it })
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { if (it) startListening() else issue = SpeechIssue.Permission }
    LaunchedEffect(languageTag) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening()
        else permission.launch(Manifest.permission.RECORD_AUDIO)
    }
    DisposableEffect(owner) {
        val observer = LifecycleEventObserver { _, event -> if (event == Lifecycle.Event.ON_STOP) { speech.stop(); micState = SpeechState.Idle } }
        owner.lifecycle.addObserver(observer)
        onDispose { owner.lifecycle.removeObserver(observer); speech.stop() }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        PageHeading(stringResource(R.string.speak_heading), stringResource(R.string.shared_members))
        LargeButton(stringResource(when (micState) {
            SpeechState.Starting -> R.string.mic_starting; SpeechState.Listening -> R.string.mic_listening
            SpeechState.Processing -> R.string.mic_processing; else -> R.string.speak
        }), Modifier.fillMaxWidth().heightIn(min = 184.dp).testTag("microphone"), micState != SpeechState.Processing) {
            if (micState == SpeechState.Listening) speech.finishListening()
            else if (micState == SpeechState.Starting) { speech.stop(); micState = SpeechState.Idle }
            else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening()
            else permission.launch(Manifest.permission.RECORD_AUDIO)
        }
        if (micState == SpeechState.Listening) LinearProgressIndicator(progress = { level }, modifier = Modifier.fillMaxWidth().height(12.dp).semantics { contentDescription = context.getString(R.string.mic_level) })
        if (partial.isNotBlank() && micState != SpeechState.Idle) Text(partial, fontSize = 26.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        issue?.let { error -> Text(stringResource(when (error) {
            SpeechIssue.Permission -> R.string.mic_permission; SpeechIssue.Unavailable -> R.string.mic_unavailable
            SpeechIssue.Language -> R.string.mic_language; SpeechIssue.Network -> R.string.mic_network
            SpeechIssue.Busy -> R.string.mic_busy; SpeechIssue.Muted -> R.string.mic_muted
            SpeechIssue.Timeout -> R.string.mic_timeout; else -> R.string.mic_no_speech
        }), color = MaterialTheme.colorScheme.error, fontSize = 20.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        Text(when {
            conversation.failed -> stringResource(R.string.action_error)
            conversation.busy -> stringResource(R.string.mic_processing)
            conversation.understanding?.needsClarification == true -> context.clarification(conversation.understanding)
            conversation.understanding != null -> stringResource(R.string.prompt_check)
            else -> stringResource(R.string.prompt_details)
        }, fontSize = 22.sp, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        if (conversation.transcript.isNotBlank()) {
            val evidence = verifiedEvidence(conversation.transcript, conversation.understanding?.evidence.orEmpty())
            Text(buildAnnotatedString {
                append(conversation.transcript)
                evidence.forEach { item -> val start = conversation.transcript.indexOf(item.span); addStyle(SpanStyle(color = Forest, fontWeight = FontWeight.Bold, textDecoration = TextDecoration.Underline), start, start + item.span.length) }
            }, fontSize = 26.sp, modifier = Modifier.semantics {
                contentDescription = conversation.transcript + evidence.joinToString(separator = "; ", prefix = "; ") { item ->
                    context.getString(R.string.heard_evidence, item.span, context.getString(when (item.field) {
                        "members" -> R.string.field_members; "slot" -> R.string.field_slot; else -> R.string.field_count
                    }))
                }
            })
        }
        conversation.reply?.let { reply ->
            Notice(stringResource(if (conversation.blocked) R.string.record_exists else R.string.record_says), context.replyText(reply))
            reply.sentences.forEach { sentence -> LargeButton(stringResource(R.string.view_source, sentence.cites.size), Modifier.fillMaxWidth()) { sources = sentence } }
        }
        conversation.understanding?.takeIf { !it.needsClarification && it.intent == "log" }?.let { heard ->
            LargeButton(stringResource(R.string.confirm_heard, requireNotNull(heard.countTaken), heard.memberIds.joinToString { context.memberName(it) }, context.slotName(requireNotNull(heard.slot))),
                Modifier.fillMaxWidth().testTag("confirm-heard"), !conversation.busy) {
                speech.stop(); micState = SpeechState.Idle
                model.log(heard.memberIds, heard.slot, heard.countTaken, "voice", transcript = heard.transcript, evidence = heard.evidence)
            }
        }
        Text(stringResource(R.string.tap_alternative), fontSize = 26.sp, fontWeight = FontWeight.Bold)
        listOf("achan", "amma", "both").forEach { id -> LargeChoice(if (id == "both") stringResource(R.string.both) else context.memberName(id), selected == id) { selected = id } }
        Slot.entries.forEach { item -> LargeChoice(context.slotName(item), slot == item) { slot = item } }
        CountControls(count, 3, { count-- }, { count++ })
        LargeButton(stringResource(R.string.record_taken), Modifier.fillMaxWidth(), !conversation.busy) { speech.stop(); micState = SpeechState.Idle; model.log(if (selected == "both") listOf("achan", "amma") else listOf(selected), slot, count) }
        LargeButton(stringResource(R.string.ask_dose), Modifier.fillMaxWidth(), !conversation.busy) { model.explain(if (selected == "both") "amma" else selected, slot) }
        HorizontalDivider()
        Text(stringResource(R.string.try_phrase), fontSize = 24.sp)
        OutlinedTextField(transcript, { transcript = it }, label = { Text(stringResource(R.string.what_you_said)) }, modifier = Modifier.fillMaxWidth())
        LargeButton(stringResource(R.string.check_phrase), Modifier.fillMaxWidth(), transcript.isNotBlank() && !conversation.busy) { speech.stop(); micState = SpeechState.Idle; model.submit(transcript) }
        listOf(R.string.sample_0, R.string.sample_1, R.string.sample_2, R.string.sample_3).forEachIndexed { index, resource ->
            val phrase = stringResource(resource)
            LargeButton(phrase, Modifier.fillMaxWidth().testTag("demo-phrase-$index")) { speech.stop(); micState = SpeechState.Idle; transcript = phrase; model.submit(phrase) }
        }
    }
    sources?.let { sentence -> ModalBottomSheet(onDismissRequest = { sources = null }) {
        SheetColumn {
            Text(stringResource(R.string.why_answer), fontSize = 26.sp, fontWeight = FontWeight.Bold)
            Text(if (context.isMalayalam()) sentence.textMl.ifBlank { context.getString(R.string.translation_unavailable) } else sentence.text, fontSize = 22.sp)
            sentence.cites.forEach { Text(stringResource(R.string.source_record, it)) }
            LargeButton(stringResource(R.string.done), Modifier.fillMaxWidth()) { sources = null }
        }
    } }
}
