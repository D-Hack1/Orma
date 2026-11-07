package `in`.orma

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test

class OrmaSmokeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun dashboardShowsFamilyAndDemoDisclosure() {
        compose.onNodeWithText("LOCAL DEMO · saved on this phone").assertIsDisplayed()
        compose.onNodeWithText("Your family").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Achan", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("Farhan").assertCountEquals(0)
    }

    @Test fun roleSwitcherRestrictsNurseToAssignedPatients() {
        compose.onNodeWithText("Supporter").performClick()
        compose.onNodeWithText("Nurse").performClick()
        compose.onNodeWithText("Your patients").assertIsDisplayed()
        compose.onNodeWithText("Achan", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("Ammoomma").assertCountEquals(0)
    }

    @Test fun assistedGroupLoggingShowsEvidenceThenBlocksADuplicate() {
        compose.onNodeWithText("Speak", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("demo-phrase-0").performScrollTo().performClick()
        compose.onNodeWithText("Confirm 3 tablets today · achan, amma · Morning").performScrollTo().performClick()
        compose.onNodeWithTag("demo-phrase-0").performScrollTo().performClick()
        compose.onNodeWithText("Confirm 3 tablets today · achan, amma · Morning").performScrollTo().performClick()
        compose.onNodeWithText("Record already exists").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("A morning record already exists for Achan.", substring = true).assertExists()
    }
}
