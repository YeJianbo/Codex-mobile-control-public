package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.material.*
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Isolated design review fixtures; no connection to a user's gateway or conversation. */
@RunWith(AndroidJUnit4::class)
class NativeManagementUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun taskPagesAdaptAndKeepFailuresInsideTheEditor(){
        val dark=mutableStateOf(false)
        val failure=mutableStateOf("")
        val tasks=listOf(
            NativeAutomation("one","检查长时间运行的研究任务","核对任务进度和新结果，只有需要处理的变化才通知。保留原始记录。","ACTIVE","heartbeat","t","FREQ=HOURLY;INTERVAL=2",1792022400000,null),
            NativeAutomation("two","整理项目与检查构建","检查最新构建，并清理已经确认无用的早期生成包。","PAUSED","heartbeat","t","FREQ=DAILY;INTERVAL=1",null,null)
        )
        ui.setContent{MaterialTheme(colors=if(dark.value)darkColors(primary=AppColor.DarkPrimary,background=AppColor.DarkBackground,surface=AppColor.DarkSurface,onSurface=AppColor.DarkOnSurface) else lightColors(primary=AppColor.LightPrimary,background=AppColor.LightBackground,surface=AppColor.LightSurface,onSurface=AppColor.LightOnSurface)){
            NativeAutomationsContent(tasks,false,true,true,false,"",{fail("Unexpected close")},{},{_,_,_->failure.value="无法保存任务：连接暂时不可用，请重试"},error=failure.value)
        }}
        val one=ui.onNodeWithTag("automation:one").fetchSemanticsNode().boundsInRoot
        val two=ui.onNodeWithTag("automation:two").fetchSemanticsNode().boundsInRoot
        if(ui.activity.resources.configuration.screenWidthDp>=760)assertEquals(one.top,two.top,1f) else assertTrue(two.top>one.top)
        screenshot("tasks-light")
        ui.runOnUiThread{dark.value=true};screenshot("tasks-dark")
        ui.runOnUiThread{dark.value=false}
        ui.onNodeWithTag("automation:one").performClick()
        ui.onNodeWithTag("automationEditor").assertIsDisplayed()
        screenshot("task-editor")
        ui.onNodeWithText("保存任务").performClick()
        ui.onNodeWithText("无法保存任务：连接暂时不可用，请重试").assertIsDisplayed()
        ui.onNodeWithTag("automationEditor").assertIsDisplayed()
        ui.onNodeWithContentDescription("返回").performClick()
        ui.onNodeWithTag("automationList").assertIsDisplayed()
    }
    private fun screenshot(label:String){
        ui.waitForIdle()
        val image=ui.onRoot().captureToImage().asAndroidBitmap()
        val context=ApplicationProvider.getApplicationContext<Application>()
        val config=ui.activity.resources.configuration
        java.io.File(context.getExternalFilesDir(null),"review-328-$label-${config.screenWidthDp}-${config.fontScale}.png").outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
}
