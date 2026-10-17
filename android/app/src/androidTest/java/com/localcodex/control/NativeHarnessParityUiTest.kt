package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeHarnessParityUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun publicAccessUsesOneSwitchPerHarnessAndReportsTheSelectedValue(){
        val selected=mutableStateOf(true)
        var submitted:Pair<String,Boolean>?=null
        ui.setContent{MaterialTheme{
            NativeAgentManagementContent(
                NativeAgentHealthState(agents=listOf(NativeAgentHealth("claude","Claude Code","ready",true,"1.0","",0,2,0,"","",publicAllowed=selected.value))),
                true,{},{},{},canManagePublic=true,onPublicAccess={agent,value->submitted=agent to value;selected.value=value})
        }}
        ui.onNodeWithTag("harnessPublic:claude").performScrollTo().performClick()
        assertEquals("claude" to false,submitted)
        ui.onNodeWithTag("harnessPublic:claude").performClick()
        assertEquals("claude" to true,submitted)
    }

    @Test fun completionCardKeepsLongTitlesInsideItsRoundedSurface(){
        val theme=NativeBuiltinThemes.liquid.resolve(false)
        var opened=false
        ui.setContent{NativeThemeProvider(theme,theme.palette.material(false)){
            NativeTaskNotice(TaskNotification("test-notice","other","任务已完成 · 一个较长的会话名称，用于检查通知的圆角和按钮布局","结果已保存"),{}, {opened=true})
        }}
        val notice=ui.onNodeWithTag("taskCompletionNotice")
        notice.assertIsDisplayed()
        val bounds=notice.fetchSemanticsNode().boundsInRoot
        assertTrue(bounds.width>bounds.height)
        val image=notice.captureToImage().asAndroidBitmap()
        try{java.io.File(ui.activity.getExternalFilesDir(null),"harness446-notice.png").outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}finally{image.recycle()}
        ui.onNodeWithText("查看").performClick()
        assertTrue(opened)
    }
}
