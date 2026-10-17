package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeStatisticsTabStripTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun changingSelectionRevealsItsTabWithoutMovingTheVerticalPage(){
        val selected=mutableStateOf("0")
        val requestedScroll=mutableStateOf(0)
        val options=List(8){it.toString() to "统计选项 $it"}
        lateinit var outer:ScrollState
        var clippedScroll=0
        ui.setContent{
            MaterialTheme{
                outer=rememberScrollState()
                clippedScroll=with(LocalDensity.current){170.dp.roundToPx()}
                LaunchedEffect(requestedScroll.value){outer.scrollTo(requestedScroll.value)}
                Box(Modifier.size(width=300.dp,height=320.dp)){
                    Column(Modifier.fillMaxSize().verticalScroll(outer)){
                        Spacer(Modifier.height(160.dp))
                        StatisticsTabStrip(options,selected.value,{selected.value=it},Modifier.testTag("statisticsTabs"))
                        Spacer(Modifier.height(640.dp))
                    }
                }
            }
        }
        ui.waitForIdle()
        ui.runOnIdle{requestedScroll.value=clippedScroll}
        ui.waitForIdle()
        val position=ui.runOnIdle{outer.value}
        ui.runOnIdle{selected.value="7"}
        ui.waitForIdle()
        ui.runOnIdle{assertEquals("Selecting a tab must not relocate the vertical page",position,outer.value)}
        val viewport=ui.onNodeWithTag("statisticsTabs").fetchSemanticsNode().boundsInRoot
        val last=ui.onNodeWithText("统计选项 7").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        assertTrue("Selected tab must be visible horizontally",last.left>=viewport.left&&last.right<=viewport.right)
        ui.runOnIdle{selected.value="0"}
        ui.waitForIdle()
        ui.onNodeWithText("统计选项 0").assertIsDisplayed()
        ui.runOnIdle{assertEquals(position,outer.value)}
    }
}
