package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.json.JSONObject

@RunWith(AndroidJUnit4::class)
class NativeSettingsUiTest{
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val colors=lightColors(primary=AppColor.LightPrimary,background=AppColor.LightBackground,surface=AppColor.LightSurface,onSurface=AppColor.LightOnSurface)

    @Test fun settingsRoutesAnimateWithDistinctPagesAndReturnToTheirParent(){
        ui.runOnUiThread{androidx.core.view.WindowCompat.setDecorFitsSystemWindows(ui.activity.window,false)}
        val page=mutableStateOf("")
        ui.setContent{MaterialTheme(colors=colors){NativeSettingsNavigation(page.value){destination->
            if(destination=="home")NativeSettingsHome(true,listOf("automations","local-console-management"),{page.value=""},{page.value=it})
            else NativeManagementPage("账号额度","",{page.value="home"},modifier=Modifier.testTag("quotaPage")){Text("5h 额度 · 7d 额度")}
        }}}
        val root=ui.onNodeWithTag("settingsNavigationContainer").fetchSemanticsNode().boundsInRoot
        ui.mainClock.autoAdvance=false
        ui.runOnIdle{page.value="home"}
        ui.mainClock.advanceTimeByFrame()
        ui.mainClock.advanceTimeBy(80)
        val entering=ui.onNodeWithTag("settingsFrame:home").fetchSemanticsNode().boundsInRoot
        screenshot("settings-entering")
        assertEquals(root.top,entering.top)
        assertEquals(root.height,entering.height)
        assertTrue("整页应从右侧水平进入: root=$root entering=$entering",entering.left>root.left)
        ui.mainClock.advanceTimeBy(400)
        ui.mainClock.autoAdvance=true
        screenshot("settings")
        val toolbar=ui.onNodeWithTag("managementToolbar").fetchSemanticsNode().boundsInRoot
        assertTrue(toolbar.height<=ui.activity.resources.displayMetrics.density*57)
        ui.mainClock.autoAdvance=false
        ui.onNodeWithTag("settings:quota").performClick()
        ui.mainClock.advanceTimeByFrame()
        ui.mainClock.advanceTimeBy(80)
        ui.onNodeWithTag("settingsHome").assertExists()
        ui.onNodeWithTag("quotaPage").assertExists()
        ui.mainClock.advanceTimeBy(400)
        ui.mainClock.autoAdvance=true
        ui.onNodeWithTag("quotaPage").assertIsDisplayed()
        ui.onNodeWithTag("settingsHome").assertDoesNotExist()
        ui.onNodeWithContentDescription("返回").performClick()
        ui.onNodeWithTag("settingsHome").assertIsDisplayed()
        ui.mainClock.autoAdvance=false
        ui.onNodeWithContentDescription("返回").performClick()
        ui.mainClock.advanceTimeByFrame()
        ui.mainClock.advanceTimeBy(80)
        val leaving=ui.onNodeWithTag("settingsFrame:home").fetchSemanticsNode().boundsInRoot
        assertEquals(root.top,leaving.top)
        assertEquals(root.height,leaving.height)
        assertTrue(leaving.left>root.left)
        ui.mainClock.advanceTimeBy(400)
        ui.mainClock.autoAdvance=true
        ui.onNodeWithTag("settingsHome").assertDoesNotExist()
    }

    @Test fun sessionUsageIsAvailableWithoutSettingsAndMetadataStartsCollapsed(){
        val state=NativeState(threadId="01a07e7c-8f28-7a53-9825-0152b461a685",model="gpt-6-astra",effort="high",connected=true,
            threads=listOf(ThreadRecord(id="01a07e7c-8f28-7a53-9825-0152b461a685",title="优化控制台体验",projectPath="F:/Code/Codex-mobile-control")),
            usage=JSONObject("""{"tokens":{"context":142000,"contextWindow":1000000,"total":12345678,"input":10000000,"output":2345678,"cached":9000000,"reasoning":1200000,"last":160000}}"""))
        ui.setContent{MaterialTheme(colors=colors){NativeManagementPage("会话状态","",{}){Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp)){
            NativeSessionOverview(state,true,{})
            Spacer(Modifier.height(12.dp))
            DashboardCard{Text("连接");Text("内网 · 已连接电脑")}
        }}}}
        ui.onNodeWithTag("sessionUsageSection").assertIsDisplayed()
        ui.onNodeWithTag("sessionDetails").assertDoesNotExist()
        screenshot("session")
        ui.onNodeWithTag("sessionDetailsToggle").performScrollTo().performClick()
        ui.onNodeWithTag("sessionContextIdLabel").assertExists()
        ui.onNodeWithTag("sessionDetailsToggle").performScrollTo().performClick()
        ui.onNodeWithTag("sessionDetails").assertDoesNotExist()
    }

    private fun screenshot(label:String){
        ui.waitForIdle()
        val image=ui.onRoot().captureToImage().asAndroidBitmap()
        val context=ApplicationProvider.getApplicationContext<Application>()
        java.io.File(context.getExternalFilesDir(null),"review-331-$label-${ui.activity.resources.configuration.screenWidthDp}.png").outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
}
