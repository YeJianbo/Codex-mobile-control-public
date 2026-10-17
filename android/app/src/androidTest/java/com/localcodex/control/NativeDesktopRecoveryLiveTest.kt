package com.localcodex.control

import android.app.Application
import android.graphics.Bitmap
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class NativeDesktopRecoveryLiveTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun productionRecoveryRetainsHistoryAndUnlocksComposer(){
        val file=File("/data/local/tmp/desktop-recovery-live.json")
        Assume.assumeTrue("Explicit read-only fixture required",file.exists())
        val config=JSONObject(file.readText())
        Assume.assumeTrue(config.optBoolean("allowReadOnly"))
        val app=ApplicationProvider.getApplicationContext<Application>()
        check(app.packageName.endsWith(".remotecheck"))
        app.getSharedPreferences("native",0).edit().clear().commit()
        app.getSharedPreferences("connection",0).edit().clear().commit()
        val vm=NativeViewModel(app)
        ui.setContent{NativeApp(vm)}
        try{
            ui.runOnUiThread{vm.connect(config.getString("base"),config.getString("token"),certificateSha256=config.getString("certificateSha256"))}
            ui.waitUntil(30000){vm.state.connected&&vm.state.models.isNotEmpty()}
            val recoveredId=config.getString("recoveredThreadId")
            ui.runOnUiThread{vm.openThread(ThreadRecord(recoveredId,title="已恢复的会话",status="running"));vm.draft("恢复后保留的草稿")}
            // A persisted interruption can predate the current ten-turn page.
            // The status response, rather than its old event's page membership,
            // determines whether the composer is unlocked.
            ui.waitUntil(30000){!vm.state.loadingHistory&&!vm.state.running&&vm.state.events.any{it.type=="message.delta"}}
            Assert.assertTrue(vm.state.events.any{it.type=="message.delta"})
            Assert.assertEquals("恢复后保留的草稿",vm.state.draft)
            ui.onNodeWithTag("composer").assertIsDisplayed()
            ui.waitUntil(10000){vm.state.threads.firstOrNull{it.id==recoveredId}?.goal?.status=="paused"}
            ui.onNodeWithTag("goalHeaderStatus",useUnmergedTree=true).assertTextEquals("已暂停")
            ui.onNodeWithTag("goalExpand").performClick()
            ui.onNodeWithText("继续").assertIsEnabled()
            ui.onNodeWithText("暂停").assertDoesNotExist()
            Assert.assertFalse(vm.state.canSteer)
            ui.waitForIdle()
            val screenshot=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            app.filesDir.resolve("native-production-crash-recovered.png").outputStream().use{screenshot.compress(Bitmap.CompressFormat.PNG,100,it)}
            ui.onNodeWithContentDescription("展开侧栏").performClick()
            ui.onNodeWithTag("runningThread:$recoveredId").assertDoesNotExist()
            ui.waitForIdle()
            val drawer=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            app.filesDir.resolve("native-production-crash-drawer.png").outputStream().use{drawer.compress(Bitmap.CompressFormat.PNG,100,it)}
            ui.runOnUiThread{vm.openThread(ThreadRecord(config.getString("activeThreadId"),title="当前任务",status="running"))}
            ui.waitUntil(30000){!vm.state.loadingHistory&&vm.state.events.isNotEmpty()}
            Assert.assertTrue("Live production task must remain running",vm.state.running)
        }finally{
            ui.runOnUiThread{vm.disconnect()}
            app.getSharedPreferences("native",0).edit().clear().commit()
            app.getSharedPreferences("connection",0).edit().clear().commit()
        }
    }
}
