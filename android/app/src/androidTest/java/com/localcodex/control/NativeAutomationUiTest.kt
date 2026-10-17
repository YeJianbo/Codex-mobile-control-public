package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeAutomationUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun cachedHeartbeatShowsACompactCollapsedTrigger(){
        val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
        val event=ChatEvent(type="user.message",eventId="schedule",text="<heartbeat><automation_id>dxo-xd3</automation_id><current_time_iso>2026-10-05T12:09:38Z</current_time_iso><instructions>检查降噪进度并保留原片</instructions></heartbeat>")
        ui.setContent{MaterialTheme{NativeScheduledTrigger(vm,event,nativeScheduledMessage(event)!!)}}
        ui.onNodeWithText("定时任务 已触发").assertIsDisplayed()
        ui.onNodeWithText("管理").assertIsDisplayed()
        ui.onNodeWithText("<heartbeat>",substring=true).assertDoesNotExist()
        ui.onNodeWithText("检查降噪进度并保留原片").assertDoesNotExist()
        ui.onNodeWithContentDescription("展开定时任务内容").performClick()
        ui.onNodeWithText("检查降噪进度并保留原片").assertIsDisplayed()
        ui.onNodeWithContentDescription("收起定时任务内容").performClick()
        ui.onNodeWithText("检查降噪进度并保留原片").assertDoesNotExist()
    }
}
