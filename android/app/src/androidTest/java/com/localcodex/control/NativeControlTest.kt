package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.Recomposer
import androidx.compose.ui.test.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertTrue
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeControlTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun dashboardTabsIgnoreReselectionAndRetargetRapidTaps(){
        val selected=mutableStateOf("quota")
        var changes=0
        ui.setContent{MaterialTheme{DashboardTabs(listOf("quota" to "额度","stats" to "统计","models" to "模型","service" to "服务"),selected.value,{selected.value=it;changes++})}}
        ui.onNodeWithText("额度").performClick().assertIsSelected()
        ui.runOnIdle{org.junit.Assert.assertEquals(0,changes)}
        ui.mainClock.autoAdvance=false
        ui.onNodeWithText("统计").performClick();ui.mainClock.advanceTimeBy(32)
        ui.onNodeWithText("模型").performClick();ui.mainClock.advanceTimeBy(32)
        ui.onNodeWithText("额度").performClick();ui.mainClock.advanceTimeBy(200)
        ui.onNodeWithText("额度").assertIsSelected()
        ui.onNodeWithText("统计").assertIsNotSelected()
        ui.onAllNodesWithTag("dashboardTabIndicator").assertCountEquals(1)
        ui.runOnIdle{org.junit.Assert.assertEquals(3,changes)}
        ui.onNodeWithText("统计").performTouchInput{down(center)}
        ui.mainClock.advanceTimeBy(100)
        val image=ui.onRoot().captureToImage().asAndroidBitmap()
        java.io.File(ui.activity.getExternalFilesDir(null),"tabs335-pressed.png").outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        ui.onNodeWithText("统计").performTouchInput{up()}
        ui.mainClock.autoAdvance=true
        ui.onNodeWithText("统计").assertIsSelected()
    }
    @Test fun toggleAnimationDoesNotCommitCompositionEveryFrame(){
        val checked=mutableStateOf(false)
        ui.setContent{MaterialTheme{ModernToggle(checked.value){checked.value=it}}}
        ui.waitForIdle()
        ui.mainClock.autoAdvance=false
        ui.runOnUiThread{checked.value=true}
        ui.mainClock.advanceTimeBy(32)
        var before=0L
        ui.runOnIdle{before=Recomposer.runningRecomposers.value.sumOf{it.changeCount}}
        ui.mainClock.advanceTimeBy(96)
        ui.runOnIdle{
            val commits=Recomposer.runningRecomposers.value.sumOf{it.changeCount}-before
            assertTrue("开关动效在 96ms 中发生 $commits 次组合提交",commits<=1)
        }
        ui.mainClock.autoAdvance=true
        ui.onNode(isToggleable()).assertIsOn()
    }
    @Test fun toggleHasAccessibleTouchAreaAndRetargetsRapidChanges(){
        val checked=mutableStateOf(false)
        val enabled=mutableStateOf(true)
        ui.setContent{MaterialTheme{Column{ModernToggle(checked.value,enabled.value){checked.value=it}}}}
        val toggle=ui.onNode(isToggleable())
        toggle.assertWidthIsAtLeast(48.dp).assertHeightIsAtLeast(48.dp).assertIsOff()
        repeat(5){toggle.performClick().assertIsOn();toggle.performClick().assertIsOff()}
        ui.runOnIdle{enabled.value=false}
        toggle.assertIsNotEnabled().assertIsOff()
    }
}
