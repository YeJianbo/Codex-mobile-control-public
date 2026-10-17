package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeMotionTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun disclosuresReverseWithoutJumpingAndGoalTitleStaysStill(){
        val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
        val block=NativeBlock("changes",ChatEvent("files.summary","t"),activities=listOf(ChatEvent("tool.completed","t",fileChanges=(1..3).map{NativeFileChange("file$it.kt",1,1)})))
        var reads=0
        ui.setContent{MaterialTheme{Column(Modifier.fillMaxWidth()){
            NativeGoalDock(vm,"t",NativeGoal("核对展开动画与阅读位置","paused",timeUsedSeconds=100))
            NativeFileChangeCard(vm,block,Modifier.testTag("motionFiles")){reads++}
        }}}
        fun play(ms:Long){ui.mainClock.advanceTimeBy(ms);ui.waitForIdle()}
        fun filesHeight()=ui.onNodeWithTag("motionFiles").fetchSemanticsNode().boundsInRoot.height
        val summary=ui.onNodeWithText("已更改 3 个文件  +3 −3")
        val closed=filesHeight()
        val title=ui.onNodeWithTag("goalHeaderTitle",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
        ui.mainClock.autoAdvance=false
        try{
            summary.performClick();play(48)
            val partial=filesHeight();assertTrue("文件列表应逐步展开",partial>closed)
            summary.performClick();play(16)
            assertTrue("反向切换应保留中间高度",filesHeight()>closed)
            play(400);assertEquals(closed,filesHeight(),1f)
            ui.onNodeWithText("file1.kt").assertDoesNotExist()
            summary.performClick();play(300)
            assertTrue(filesHeight()>partial);ui.onNodeWithText("file3.kt").assertIsDisplayed()
            assertEquals(3,reads)
            ui.onNodeWithTag("goalExpand").performClick();play(48)
            val during=ui.onNodeWithTag("goalHeaderTitle",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
            assertEquals(title.left,during.left,1f);assertEquals(title.top,during.top,1f);assertEquals(title.width,during.width,1f)
            ui.onNodeWithText("目标：核对展开动画与阅读位置").assertExists()
            ui.onNodeWithTag("goalExpand").performClick();play(400)
            ui.onNodeWithTag("goalObjective",useUnmergedTree=true).assertDoesNotExist()
        }finally{ui.mainClock.autoAdvance=true}
    }
    @Test fun shortFastSheetFlingContinuesDownFromRelease(){
        val open=mutableStateOf(true)
        var closed=0
        ui.mainClock.autoAdvance=false
        ui.setContent{MaterialTheme{if(open.value)Sheet("快速下滑",{closed++;open.value=false}){Text("检查短距离快速松手的关闭轨迹。")}}}
        repeat(24){ui.mainClock.advanceTimeBy(16);ui.waitForIdle();android.os.SystemClock.sleep(16)}
        val originalTop=ui.onNodeWithTag("sheetDragHeader").fetchSemanticsNode().boundsInRoot.top
        val pixels=ui.activity.resources.displayMetrics.density*48f
        ui.mainClock.autoAdvance=false
        try{
            ui.onNodeWithTag("sheetDragHeader").performTouchInput{swipe(center,center+Offset(0f,pixels),40)}
            ui.mainClock.advanceTimeBy(32);ui.waitForIdle()
            val releaseTop=ui.onNodeWithTag("sheetDragHeader").fetchSemanticsNode().boundsInRoot.top
            assertTrue("快速下滑应延续向下移动：$originalTop -> $releaseTop",releaseTop>originalTop)
            ui.mainClock.advanceTimeBy(350);ui.waitForIdle()
            ui.onNodeWithTag("sheetPanel").assertDoesNotExist()
            assertEquals(1,closed)
        }finally{ui.mainClock.autoAdvance=true}
    }
    @Test fun sheetEntryReversalDragAndReopen(){
        val open=mutableStateOf(false)
        ui.setContent{MaterialTheme{Surface(Modifier.fillMaxSize()){
            Column {Text("Codex 原生面板动效");Button(onClick={open.value=true}){Text("打开面板")}}
            if(open.value)Sheet("动效体验",{open.value=false}){Text("隔离界面：检查遮罩、展开、短拖回弹与中途关闭。")}
        }}}
        ui.mainClock.autoAdvance=false
        fun play(ms:Int){repeat(ms/16){ui.mainClock.advanceTimeBy(16);ui.waitForIdle();android.os.SystemClock.sleep(16)}}
        fun shot(stage:String){
            val instrumentation=InstrumentationRegistry.getInstrumentation()
            val phase=InstrumentationRegistry.getArguments().getString("motionPhase")?:"before"
            val image=instrumentation.uiAutomation.takeScreenshot()
            val file=java.io.File(instrumentation.targetContext.getExternalFilesDir(null),"native-motion-$phase-$stage.png")
            file.outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        }
        try{
            ui.onNodeWithText("打开面板").performClick();play(32);shot("early");play(320)
            ui.onNodeWithTag("sheetDragHeader").assertExists();shot("open")
            ui.onNodeWithTag("sheetDragHeader").performTouchInput{swipe(center,center+Offset(0f,24f),160)};play(260)
            ui.onNodeWithTag("sheetDragHeader").assertExists()
            ui.onNodeWithContentDescription("关闭").performClick();play(320)
            ui.onNodeWithTag("sheetDragHeader").assertDoesNotExist()
            ui.onNodeWithText("打开面板").performClick();play(48)
            ui.onNodeWithContentDescription("关闭").performClick();play(320)
            ui.onNodeWithTag("sheetDragHeader").assertDoesNotExist()
            ui.onNodeWithText("打开面板").performClick();play(320)
            ui.onNodeWithTag("sheetDragHeader").performTouchInput{swipe(center,center+Offset(0f,320f),260)};play(320)
            ui.onNodeWithTag("sheetDragHeader").assertDoesNotExist()
            ui.onNodeWithText("打开面板").performClick();play(96)
            ui.onNodeWithTag("sheetDragHeader").performTouchInput{down(Offset(center.x,6f))}
            play(16)
            val held=ui.onNodeWithTag("sheetPanel").fetchSemanticsNode().boundsInRoot.top
            play(96)
            assertEquals("按下拖动区应立即接管入场动画",held,ui.onNodeWithTag("sheetPanel").fetchSemanticsNode().boundsInRoot.top,1f)
            ui.onNodeWithTag("sheetDragHeader").performTouchInput{up()};play(400)
            if(open.value){ui.onNodeWithContentDescription("关闭").performClick();play(400)}
            ui.onNodeWithTag("sheetPanel").assertDoesNotExist()
        }finally{ui.mainClock.autoAdvance=true}
    }
}
