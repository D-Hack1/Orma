@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
package `in`.orma.feature

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.*
import `in`.orma.R
import `in`.orma.assistant.assistantSetupIntent
import `in`.orma.audio.*
import `in`.orma.core.theme.*
import `in`.orma.data.*
import `in`.orma.reminders.NotificationControls
import java.time.LocalDate
import java.time.format.DateTimeFormatter

@Composable
fun OrmaApp(model: OrmaViewModel, openSpeak: Boolean, onOpened: () -> Unit) {
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
    DisposableEffect(Unit) { onDispose { speech.close() } }
    LaunchedEffect(role, route) { if (role != "Assisted" || route != "speak") speech.stop() }
    LaunchedEffect(openSpeak) {
        if (openSpeak) { role = "Assisted"; nav.navigate("speak") { launchSingleTop = true }; onOpened() }
    }
    LaunchedEffect(conversation.reply) {
        conversation.reply?.let {
            feedback(context, conversation.blocked)
            if (role == "Assisted" && route == "speak") speech.speak(it.textMl, it.textEn)
        }
    }

    Scaffold(containerColor = Paper,
        topBar = {
            Column(Modifier.background(Paper).statusBarsPadding().padding(horizontal = 24.dp)) {
                Row(Modifier.fillMaxWidth().padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(42.dp).background(Forest, RoundedCornerShape(14.dp)), contentAlignment = Alignment.Center) {
                        Icon(Icons.Outlined.Spa, contentDescription = null, tint = Color.White)
                    }
                    Spacer(Modifier.width(10.dp))
                    Text("orma", fontWeight = FontWeight.Bold, fontSize = 30.sp, color = Forest)
                    Spacer(Modifier.weight(1f))
                    Box {
                        TextButton(onClick = { roleMenu = true }, modifier = Modifier.heightIn(min = 64.dp)) {
                            Text(role, color = Forest); Icon(Icons.Outlined.ExpandMore, contentDescription = "Switch role")
                        }
                        DropdownMenu(roleMenu, onDismissRequest = { roleMenu = false }) {
                            listOf("Supporter", "Assisted", "Independent", "Nurse").forEach { item ->
                                DropdownMenuItem(text = { Text(item) }, modifier = Modifier.heightIn(min = 64.dp), onClick = {
                                    role = item; roleMenu = false; nav.navigate("home") { popUpTo("home") { inclusive = true } }
                                })
                            }
                        }
                    }
                }
                Text("LOCAL DEMO · saved on this phone", style = MaterialTheme.typography.labelSmall, color = Muted,
                    modifier = Modifier.padding(bottom = 12.dp).semantics { contentDescription = "Demo mode. Records are saved locally. No family alerts are sent." })
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Color.White) {
                listOf(Triple("home", "Home", Icons.Outlined.Home), Triple("speak", "Speak", Icons.Outlined.Mic),
                    Triple("settings", "Settings", Icons.Outlined.Tune)).forEach { (destination, label, icon) ->
                    NavigationBarItem(selected = route == destination,
                        onClick = { nav.navigate(destination) { popUpTo("home"); launchSingleTop = true } },
                        icon = { Icon(icon, contentDescription = null) }, label = { Text(label) },
                        modifier = Modifier.heightIn(min = 72.dp))
                }
            }
        }
    ) { padding ->
        NavHost(nav, startDestination = "home", modifier = Modifier.padding(padding)) {
            composable("home") {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(24.dp)) {
                    if (state.storageError) Notice("Logging is paused", "Saved records could not be opened. Please contact your supporter before taking another dose.")
                    when (role) {
                        "Assisted" -> {
                            PageHeading("A little help,\nevery day.", "Your medicine companion · Home phone")
                            LargeButton("Speak to Orma · പറയൂ", Modifier.fillMaxWidth().heightIn(min = 152.dp)) { nav.navigate("speak") }
                            model.members.filter { it.id in listOf("achan", "amma") }.forEach { member ->
                                MemberCard(member, state, showPrivate = true, onLog = { slot -> logMember = member; logSlot = slot },
                                    onWhy = { slot -> model.explain(member.id, slot); explanation = true })
                            }
                        }
                        "Independent" -> {
                            val member = model.members.first { it.id == "farhan" }
                            PageHeading("Your day,\nat your pace.", "Farhan · Silent reminders")
                            Notice("Quiet by default", "Captions and taps work with sound off. Your record is not linked to a family.")
                            MemberCard(member, state, true, { logMember = member; logSlot = it }, { model.explain(member.id, it); explanation = true })
                            NotificationControls()
                        }
                        else -> {
                            PageHeading(if (role == "Nurse") "Care for today." else "A little closer,\neven from afar.",
                                "${LocalDate.now(KeralaZone).format(DateTimeFormatter.ofPattern("EEEE, d MMMM"))} · Kerala")
                            if (role == "Supporter") {
                                val family = model.members.filter { it.id != "farhan" }
                                val count = state.doses.count { it.date == today() && it.memberId in family.map(Member::id) }
                                Card(colors = CardDefaults.cardColors(containerColor = Forest), shape = RoundedCornerShape(24.dp)) {
                                    Column(Modifier.fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text("THE FAMILY, TODAY", color = Color(0xFFDBEAAE), style = MaterialTheme.typography.labelMedium)
                                        Text("$count doses recorded", color = Color.White, style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.SemiBold)
                                        Text("Every record tells you who, when, and how.", color = Color(0xFFE2EFE7))
                                        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 12.dp)) {
                                            Icon(Icons.Outlined.People, contentDescription = null, tint = Color.White)
                                            Text("  Anu & Rahul · Your support circle", color = Color.White, style = MaterialTheme.typography.bodyMedium)
                                        }
                                    }
                                }
                            } else Notice("Sister Mini · Assigned patients", "You can log care for Achan and Amma. Schedule changes need family confirmation.")
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                Text(if (role == "Nurse") "Your patients" else "Your family", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                                Spacer(Modifier.weight(1f))
                                Text("IST", style = MaterialTheme.typography.labelMedium, color = Muted)
                            }
                            model.members.filter { if (role == "Nurse") it.nurseAssigned else it.id != "farhan" }.forEach { member ->
                                MemberCard(member, state, showPrivate = false,
                                    onLog = { logMember = member; logSlot = it },
                                    onWhy = { model.explain(member.id, it, privateView = false); explanation = true })
                            }
                            Notice("Care begins with consent", "Each member chooses what to share. Counts, messages, and risk stay private by default.")
                        }
                    }
                }
            }
            composable("speak") { SpeakScreen(model, conversation, speech) }
            composable("settings") {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                    PageHeading("Make it yours.", "Accessibility & member sharing")
                    LargeButton("Set Orma as digital assistant", Modifier.fillMaxWidth()) { context.startActivity(assistantSetupIntent(context)) }
                    NotificationControls(assistantOnly = true)
                    Notice("Ways to reach Orma", "Choose Orma in Android’s digital assistant settings. Use the Speak tab or launcher if your phone’s power button does not open the assistant.")
                    if (role == "Assisted") {
                        var memberId by rememberSaveable { mutableStateOf("amma") }
                        Text("Member sharing · On this home phone", style = MaterialTheme.typography.titleLarge)
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("amma", "achan").forEach { id ->
                                FilterChip(memberId == id, { memberId = id }, label = { Text(id.replaceFirstChar { it.uppercase() }) }, modifier = Modifier.heightIn(min = 64.dp))
                            }
                        }
                        val sharing = state.sharing[memberId] ?: Sharing()
                        SharingToggle("Share tablet counts", sharing.counts) { model.share(memberId, sharing.copy(counts = it)) }
                        SharingToggle("Share message content", sharing.messages) { model.share(memberId, sharing.copy(messages = it)) }
                        SharingToggle("Share risk predictions", sharing.risk) { model.share(memberId, sharing.copy(risk = it)) }
                        SharingToggle("Share nurse notes", sharing.nurseNotes) { model.share(memberId, sharing.copy(nurseNotes = it)) }
                        Text("Dose status and duplicate-dose alerts are the minimum shared for safety. This is a local demonstration; account verification is required for live sharing.", color = Muted)
                    } else Notice("Members choose what is shared", "Open the Assisted role on the member’s home phone to try sharing controls. Supporter and nurse views cannot change them.")
                    Notice("Demo setup", "No real prescription is loaded. Demo counts are sample values. Firebase, phone verification, and family alerts will be connected after the backend contracts are available.")
                }
            }
        }
    }

    logMember?.let { member ->
        var count by remember(member.id, logSlot) { mutableIntStateOf(member.expected) }
        AlertDialog(onDismissRequest = { logMember = null }, title = { Text("${member.name} · ${logSlot.label}") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text("Record tablets already taken. Demo schedule: ${member.expected} tablets.")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        LargeButton("−", enabled = count > 1) { count-- }
                        Text("$count", Modifier.padding(24.dp), style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold)
                        LargeButton("+", enabled = count < member.expected) { count++ }
                    }
                    Text("A previous record will block another log.", color = Muted)
                }
            }, confirmButton = { LargeButton("Save record", enabled = !conversation.busy) {
                model.log(listOf(member.id), logSlot, count,
                    source = when(role) { "Supporter" -> "family"; "Nurse" -> "nurse"; else -> "tap" },
                    by = when(role) { "Supporter" -> "Anu"; "Nurse" -> "Sister Mini"; else -> member.id })
                logMember = null; explanation = true
            } }, dismissButton = { TextButton({ logMember = null }, Modifier.heightIn(min = 64.dp)) { Text("Cancel") } })
    }
    if (explanation) {
        ModalBottomSheet(onDismissRequest = { explanation = false }, containerColor = Paper) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text(if (conversation.blocked) "Please check before taking more" else "From your records", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(conversation.reply?.textEn ?: conversation.message, style = MaterialTheme.typography.bodyLarge)
                conversation.reply?.sentences?.flatMap { it.cites }?.distinct()?.forEach { cite ->
                    Text("Source · $cite", color = Muted, style = MaterialTheme.typography.bodyMedium)
                }
                LargeButton("Done", Modifier.fillMaxWidth()) { explanation = false }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable private fun PageHeading(title: String, subtitle: String) {
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(subtitle, color = Muted, style = MaterialTheme.typography.bodyMedium)
        Text(title, style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.SemiBold, letterSpacing = (-1).sp)
    }
}

@Composable private fun Notice(title: String, body: String) {
    Column(Modifier.fillMaxWidth().background(Color(0xFFE9EEDC), RoundedCornerShape(20.dp)).padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold, color = Ink)
        Text(body, style = MaterialTheme.typography.bodyMedium, color = Muted)
    }
}

@Composable private fun MemberCard(member: Member, state: LocalState, showPrivate: Boolean, onLog: (Slot) -> Unit, onWhy: (Slot) -> Unit) {
    Card(shape = RoundedCornerShape(24.dp), colors = CardDefaults.cardColors(containerColor = Color.White)) {
        Column(Modifier.fillMaxWidth().padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(48.dp).background(Color(0xFFEAF0E2), CircleShape), contentAlignment = Alignment.Center) {
                    Text(member.initials, color = Forest, fontWeight = FontWeight.Bold)
                }
                Column(Modifier.padding(start = 12.dp).weight(1f)) {
                    Text(member.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                    Text(member.relation, color = Muted, style = MaterialTheme.typography.bodySmall)
                }
                Icon(if (member.mode == "keypad") Icons.Outlined.Phone else Icons.Outlined.Smartphone, contentDescription = member.mode, tint = Muted)
            }
            // Vertical dose rows remain readable at 200% text scaling on narrow phones.
            Slot.entries.forEach { slot ->
                val record = state.doses.firstOrNull { it.memberId == member.id && it.date == today() && it.slot == slot }
                val color = when (record?.status) {
                    DoseStatus.confirmed, DoseStatus.reported -> Forest
                    DoseStatus.partial -> Color(0xFF775300)
                    else -> Muted
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).heightIn(min = 64.dp).clickable { onLog(slot) }.padding(vertical = 8.dp)
                        .semantics(mergeDescendants = true) { contentDescription = "${member.name}, ${slot.label}, ${record?.status?.label ?: "No record"}. Tap to record tablets already taken." }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(when (slot) { Slot.morning -> Icons.Outlined.WbSunny; Slot.noon -> Icons.Outlined.LightMode; Slot.night -> Icons.Outlined.DarkMode }, null, tint = color, modifier = Modifier.size(20.dp))
                            Text("  ${slot.label}", style = MaterialTheme.typography.titleMedium)
                        }
                        Text("${slot.time} · ${record?.status?.label ?: "No record"}", color = color, style = MaterialTheme.typography.bodyMedium)
                        if (record != null && (showPrivate || state.sharing[member.id]?.counts == true)) {
                            Text("${record.countTaken}/${record.countExpected} · ${record.source}", color = Muted, style = MaterialTheme.typography.bodySmall)
                        }
                    }
                    IconButton({ onWhy(slot) }, Modifier.size(64.dp).semantics { contentDescription = "Why: ${member.name} ${slot.label}" }) {
                        Icon(Icons.Outlined.Info, null, tint = Muted)
                    }
                }
                if (slot != Slot.night) HorizontalDivider(color = Color(0xFFEDF0E8))
            }
            if (!showPrivate && state.sharing[member.id]?.counts != true) Text("${member.name} keeps tablet counts private", color = Muted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable private fun SharingToggle(label: String, value: Boolean, changed: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 72.dp).semantics(mergeDescendants = true) {}, verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f)); Switch(value, changed, Modifier.minimumInteractiveComponentSize().semantics { contentDescription = label })
    }
}

@Composable private fun SpeakScreen(model: OrmaViewModel, conversation: Conversation, speech: SpeechController) {
    val context = LocalContext.current
    var listening by remember { mutableStateOf(false) }
    var voiceError by remember { mutableStateOf("") }
    var transcript by rememberSaveable { mutableStateOf("") }
    var selected by rememberSaveable { mutableStateOf("amma") }
    var slot by rememberSaveable { mutableStateOf(Slot.morning) }
    var count by rememberSaveable { mutableIntStateOf(3) }
    var sources by remember { mutableStateOf<Sentence?>(null) }
    fun startListening() {
        voiceError = ""; listening = true
        speech.listen({ listening = false; transcript = it; model.submit(it) }, { listening = false; voiceError = it }, { listening = true })
    }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startListening() else voiceError = "Microphone access is off. You can use the buttons below."
    }
    LaunchedEffect(Unit) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening()
        else permission.launch(Manifest.permission.RECORD_AUDIO)
    }
    DisposableEffect(Unit) { onDispose { speech.stop() } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
        PageHeading("I'm here.\nപറയൂ.", "Achan & Amma · Shared home phone")
        LargeButton(if (listening) "Listening… Tap to stop" else stringResource(R.string.speak), Modifier.fillMaxWidth().heightIn(min = 140.dp)) {
            if (listening) { speech.stop(); listening = false }
            else if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) startListening()
            else permission.launch(Manifest.permission.RECORD_AUDIO)
        }
        if (voiceError.isNotEmpty()) Text(voiceError, color = MaterialTheme.colorScheme.error, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        Text(conversation.message, color = Muted, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        if (conversation.transcript.isNotEmpty()) {
            val evidence = conversation.understanding?.evidence.orEmpty()
            Text(buildAnnotatedString {
                append(conversation.transcript)
                verifiedEvidence(conversation.transcript, evidence).forEach { item ->
                    val start = conversation.transcript.indexOf(item.span)
                    addStyle(SpanStyle(color = Forest, fontWeight = FontWeight.Bold, textDecoration = TextDecoration.Underline), start, start + item.span.length)
                }
            }, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.semantics {
                contentDescription = conversation.transcript + evidence.joinToString { "; heard ${it.span}, ${it.field}" }
            })
        }
        conversation.reply?.let { reply ->
            Notice(if (conversation.blocked) "Record already exists" else "What the record says", reply.textEn)
            reply.sentences.forEach { sentence ->
                TextButton({ sources = sentence }, Modifier.heightIn(min = 64.dp)) { Text("View source · ${sentence.cites.size} record(s)") }
            }
            if (reply.textMl.isNotBlank()) Text(reply.textMl, style = MaterialTheme.typography.headlineSmall)
        }
        conversation.understanding?.takeIf { !it.needsClarification && it.intent == "log" }?.let { heard ->
            LargeButton("Confirm ${heard.countTaken} tablets today · ${heard.memberIds.joinToString()} · ${heard.slot?.label}", Modifier.fillMaxWidth(), !conversation.busy) {
                model.log(heard.memberIds, requireNotNull(heard.slot), requireNotNull(heard.countTaken), "voice", transcript = heard.transcript, evidence = heard.evidence)
            }
        }
        Text("Or use the large buttons", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("achan" to "Achan", "amma" to "Amma", "both" to "Both").forEach { (id, label) ->
                FilterChip(selected == id, { selected = id }, label = { Text(label) }, modifier = Modifier.heightIn(min = 64.dp))
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Slot.entries.forEach { item -> FilterChip(slot == item, { slot = item }, label = { Text(item.label) }, modifier = Modifier.heightIn(min = 64.dp)) }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            LargeButton("−", enabled = count > 1) { count-- }
            Text("$count tablets", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            LargeButton("+", enabled = count < 3) { count++ }
        }
        LargeButton("Record tablets already taken", Modifier.fillMaxWidth(), !conversation.busy) {
            model.log(if (selected == "both") listOf("achan", "amma") else listOf(selected), slot, count)
        }
        LargeButton("Did I take this dose?", Modifier.fillMaxWidth(), !conversation.busy) {
            model.explain(if (selected == "both") "amma" else selected, slot)
        }
        HorizontalDivider()
        Text("Try a demo phrase", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(transcript, { transcript = it }, label = { Text("What you said") }, modifier = Modifier.fillMaxWidth())
        LargeButton("Check phrase", Modifier.fillMaxWidth(), transcript.isNotBlank() && !conversation.busy) { model.submit(transcript) }
        listOf("Njangal randuperum raavile 3 gulika kazhichu", "Amma uchakku 2 gulika kazhichu", "Kazhichu", "Amma raathri gulika kazhicho?").forEachIndexed { index, phrase ->
            TextButton({ transcript = phrase; model.submit(phrase) }, Modifier.fillMaxWidth().heightIn(min = 64.dp).testTag("demo-phrase-$index")) { Text(phrase) }
        }
    }
    sources?.let { sentence -> AlertDialog(onDismissRequest = { sources = null }, title = { Text("Why this answer?") },
        text = { Text(sentence.text + "\n\n" + sentence.cites.joinToString("\n") { "Source: $it" }) },
        confirmButton = { LargeButton("Done") { sources = null } }) }
}
