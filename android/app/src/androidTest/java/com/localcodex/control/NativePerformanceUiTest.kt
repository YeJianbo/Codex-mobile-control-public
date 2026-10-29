package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.lifecycle.ViewModelProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativePerformanceUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun recordingSurvivesLeavingDiagnosticsAndCanBeStoppedAfterReturning(){
        val visible=mutableStateOf(true)
        val vm=ViewModelProvider(ui.activity).get(NativeViewModel::class.java)
        ui.setContent{MaterialTheme{
            RecordNativeComposerState(NativeComposerGate.EMPTY,foreground=true)
            if(visible.value)NativePerformancePanel(vm) else androidx.compose.ui.window.Dialog(onDismissRequest={}){
            NativeDialogSystemBars()
            Text("聊天")
        }}}
        ui.runOnUiThread{NativePerformanceRecorder.attach(ui.activity.window)}
        ui.onNodeWithTag("performanceRecord").performClick()
        ui.onNodeWithText("结束并查看").assertExists()
        ui.runOnUiThread{visible.value=false}
        ui.onNodeWithText("聊天").assertExists()
        ui.waitForIdle()
        android.os.SystemClock.sleep(150)
        assertTrue(NativePerformanceRecorder.session.active)
        ui.runOnUiThread{NativePerformanceRecorder.stop();visible.value=true}
        ui.waitUntil(10000){NativePerformanceRecorder.state.value.report!=null}
        ui.onNodeWithText("保存记录").assertExists()
        assertFalse(NativePerformanceRecorder.session.active)
        assertTrue(NativePerformanceRecorder.state.value.report!!.frames>0)
        assertTrue(NativePerformanceRecorder.state.value.report!!.dialogFrames>0)
        assertEquals(NativeComposerGate.EMPTY,NativePerformanceRecorder.state.value.report!!.composer.first().gate)
        val json=nativePerformanceJson(NativePerformanceRecorder.state.value.report!!,null,null)
        assertFalse(json.contains("threadId"));assertFalse(json.contains("https://"))
        ui.runOnUiThread{NativePerformanceRecorder.detach(ui.activity.window)}
    }
}
