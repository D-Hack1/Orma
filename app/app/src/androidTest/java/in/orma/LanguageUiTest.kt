package `in`.orma

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test

class LanguageUiTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun languageSwitchShowsOneLanguageAndPersistsAcrossRecreation() {
        compose.onNodeWithTag("language-switch").performClick()
        compose.waitUntil(8_000) { compose.onAllNodesWithText("നിങ്ങളുടെ കുടുംബം").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("Your family").assertCountEquals(0)
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText("നിങ്ങളുടെ കുടുംബം").assertIsDisplayed()
        compose.onNodeWithTag("language-switch").performClick()
        compose.waitUntil(8_000) { compose.onAllNodesWithText("Your family").fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodesWithText("നിങ്ങളുടെ കുടുംബം").assertCountEquals(0)
    }

    @Test fun actionAndChoiceButtonsHaveLargeTouchAreas() {
        compose.onNodeWithTag("role-switch").performClick()
        compose.onNodeWithText("Assisted").performClick()
        compose.onNodeWithText("Speak to Orma").assertHeightIsAtLeast(androidx.compose.ui.unit.Dp(176f))
        compose.onNodeWithTag("dose-achan-morning").performScrollTo().assertHeightIsAtLeast(androidx.compose.ui.unit.Dp(112f))
    }

    @Test fun assistantSetupReportsActualSelectionAndProvidesSettings() {
        compose.onNodeWithTag("nav-settings").performClick()
        compose.onNodeWithTag("assistant-setup").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Test assistant").performScrollTo().assertIsDisplayed()
    }
}
