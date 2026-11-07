package `in`.orma.feature.onboarding

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import `in`.orma.R
import `in`.orma.core.l10n.*
import `in`.orma.core.theme.*
import `in`.orma.data.*
import `in`.orma.feature.OrmaViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

private fun Context.hostActivity(): Activity? = if (this is Activity) this else (this as? ContextWrapper)?.baseContext?.hostActivity()

@Composable
fun AccountSetupScreen(model: OrmaViewModel, deviceOnly: Boolean = false) {
    val context = LocalContext.current
    val session by model.session.collectAsStateWithLifecycle()
    val action by model.setup.collectAsStateWithLifecycle()
    val records by model.records.collectAsStateWithLifecycle()
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var create by rememberSaveable { mutableStateOf(true) }
    var purpose by rememberSaveable { mutableStateOf("assisted") }
    var familyName by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    var share by rememberSaveable { mutableStateOf(false) }
    var selected by remember { mutableStateOf(session.deviceMemberIds.toSet()) }
    Surface(color = Paper) {
        Column(Modifier.fillMaxSize().systemBarsPadding().verticalScroll(rememberScrollState()).padding(24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            Text(stringResource(if (deviceOnly) R.string.device_person else R.string.welcome), fontSize = 30.sp)
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton({ context.hostActivity()?.let { AppLanguage.change(it, "en") } }, Modifier.weight(1f).heightIn(min = 80.dp)) { Text("English", fontSize = 22.sp) }
                OutlinedButton({ context.hostActivity()?.let { AppLanguage.change(it, "ml") } }, Modifier.weight(1f).heightIn(min = 80.dp)) { Text("മലയാളം", fontSize = 22.sp) }
            }
            if (session.loading) {
                CircularProgressIndicator(); Text(stringResource(R.string.working))
            } else if (deviceOnly) {
                Text(stringResource(R.string.device_help), fontSize = 20.sp)
                records.members.filter { if (session.role in listOf("assisted", "independent")) it.isOwner else true }.forEach { member ->
                    LargeChoice(member.name, member.id in selected) { selected = if (member.id in selected) selected - member.id else selected + member.id }
                }
                LargeButton(stringResource(R.string.save_device), Modifier.fillMaxWidth().testTag("save-device"), selected.isNotEmpty() && !action.busy) { model.deviceMembers(selected.toList()) }
            } else if (!session.signedIn) {
                Text(stringResource(R.string.setup_intro), fontSize = 20.sp)
                if (create) {
                    Text(stringResource(R.string.who_phone), fontSize = 24.sp)
                    listOf("assisted" to R.string.setup_assisted, "supporter" to R.string.setup_supporter, "independent" to R.string.setup_independent).forEach { (value, label) ->
                        LargeChoice(stringResource(label), purpose == value) { purpose = value }
                    }
                    OutlinedTextField(name, { name = it }, label = { Text(stringResource(R.string.your_name)) }, modifier = Modifier.fillMaxWidth().testTag("account-name"))
                    OutlinedTextField(phone, { phone = it }, label = { Text(stringResource(R.string.your_phone)) }, modifier = Modifier.fillMaxWidth().testTag("account-phone"))
                    Text(stringResource(R.string.phone_help))
                }
                OutlinedTextField(email, { email = it }, label = { Text(stringResource(R.string.email)) }, modifier = Modifier.fillMaxWidth().testTag("account-email"), singleLine = true)
                OutlinedTextField(password, { password = it }, label = { Text(stringResource(R.string.password)) }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().testTag("account-password"), singleLine = true)
                LargeButton(stringResource(if (create) R.string.create_account else R.string.sign_in), Modifier.fillMaxWidth().testTag("account-submit"), !action.busy && email.contains('@') && password.length >= 6 && (!create || name.isNotBlank())) {
                    model.authenticate(email, password, name, phone, if (context.isMalayalam()) "ml" else "en", create)
                }
                LargeButton(stringResource(if (create) R.string.have_account else R.string.new_account), Modifier.fillMaxWidth()) { create = !create; model.resetSetupMessage() }
                Text(stringResource(R.string.setup_account_help))
            } else {
                if (session.problem.isNotBlank()) {
                    Text(stringResource(R.string.server_unavailable), color = MaterialTheme.colorScheme.error)
                    LargeButton(stringResource(R.string.retry), Modifier.fillMaxWidth()) { model.retryConnection() }
                }
                Text(stringResource(R.string.family_group), fontSize = 26.sp)
                listOf("supporter" to R.string.setup_supporter, "assisted" to R.string.setup_assisted, "independent" to R.string.setup_independent).forEach { (value, label) ->
                    LargeChoice(stringResource(label), purpose == value) { purpose = value }
                }
                session.families.forEach { family -> LargeButton(family.name, Modifier.fillMaxWidth()) { model.selectFamily(family.familyId) } }
                if (purpose != "assisted") {
                    OutlinedTextField(familyName, { familyName = it }, label = { Text(stringResource(R.string.family_name)) }, modifier = Modifier.fillMaxWidth().testTag("family-name"))
                    LargeButton(stringResource(if (purpose == "independent") R.string.own_private else R.string.create_family), Modifier.fillMaxWidth().testTag("create-family"), familyName.isNotBlank() && !action.busy) { model.createFamily(familyName, purpose == "independent") }
                }
                OutlinedTextField(code, { code = it.uppercase() }, label = { Text(stringResource(R.string.pair_code)) }, modifier = Modifier.fillMaxWidth().testTag("pair-code"), singleLine = true)
                Text(stringResource(R.string.pair_help))
                SetupToggle(stringResource(R.string.share_setup), share) { share = it }
                LargeButton(stringResource(R.string.join_family), Modifier.fillMaxWidth().testTag("join-family"), code.length == 12 && !action.busy) { model.join(code, share) }
                LargeButton(stringResource(R.string.sign_out), Modifier.fillMaxWidth()) { model.signOut() }
            }
            if (action.busy) CircularProgressIndicator()
            if (action.failed) Text(if (context.isMalayalam()) stringResource(R.string.setup_failed) else action.error.ifBlank { context.getString(R.string.setup_failed) }, color = MaterialTheme.colorScheme.error, fontSize = 20.sp)
        }
    }
}

@Composable
fun SetupToggle(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 88.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(label, Modifier.weight(1f), fontSize = 20.sp); Checkbox(checked, onChange, Modifier.sizeIn(minWidth = 64.dp, minHeight = 64.dp))
    }
}
