package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class NativeErrorDetailTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun originalNetworkFailureCanBeReadAndCopied(){
        val detail="stream disconnected before completion: IO error\n远程主机强迫关闭了一个现有的连接。(os error 10054)\n\nReconnecting 4/5\nHTTP 502"
        lateinit var clipboard:ClipboardManager
        ui.setContent{MaterialTheme{clipboard=LocalClipboardManager.current;NativeErrorDetail(ChatEvent(type="error",text="连接失败",detail=detail,willRetry=true))}}
        ui.onNodeWithText(detail).assertIsDisplayed()
        ui.onNodeWithText("复制错误详情").performClick()
        ui.runOnIdle{assertEquals(detail,clipboard.getText()?.text)}
    }
}
