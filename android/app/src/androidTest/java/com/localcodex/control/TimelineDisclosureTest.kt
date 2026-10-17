package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Box
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class TimelineDisclosureTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun compactionSummaryStartsCollapsedAndSurvivesNotificationRefresh(){
        val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
        val events=mutableStateOf(listOf(
            ChatEvent(type="message.delta",threadId="compaction",itemId="handoff",text="压缩摘要内容"),
            ChatEvent(type="context.compaction",threadId="compaction",eventId="history:compact",itemId="compact",status="ok",text="压缩摘要内容")))
        ui.setContent{MaterialTheme{Column{nativeTimeline(events.value,"compaction").forEach{NativeTimelineBlock(vm,it,{})}}}}
        ui.onNodeWithTag("contextCompactionSummary").assertDoesNotExist()
        ui.onNodeWithTag("contextCompaction").performClick()
        ui.onNodeWithTag("contextCompactionSummary").assertIsDisplayed()
        ui.runOnIdle{events.value=events.value+events.value.last().copy(eventId="live:compact",text="")}
        ui.onNodeWithTag("contextCompactionSummary").assertIsDisplayed()
        ui.onNodeWithTag("contextCompaction").performClick()
        ui.onNodeWithTag("contextCompactionSummary").assertDoesNotExist()
    }

    @Test fun terminalProcessCollapsesInPlaceAndKeepsItsEndTime() {
        val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
        val status=mutableStateOf("")
        val thread=mutableStateOf("completed")
        val ended=java.time.LocalDate.now().atTime(14,5,10).atZone(java.time.ZoneId.systemDefault()).toInstant()
        ui.setContent { MaterialTheme { Column {
            val id=thread.value
            val events=listOf(
                ChatEvent(type="turn.started",threadId=id,eventId="start",createdAt=ended.minusSeconds(5).toString()),
                ChatEvent(type="tool.completed",threadId=id,eventId="tool",itemId="command",title="运行命令",text="检查完成"),
                ChatEvent(type="message.delta",threadId=id,eventId="answer",text="本轮结果 $id")
            )+if(status.value.isBlank())emptyList() else listOf(ChatEvent(type="turn.completed",threadId=id,eventId="end",status=status.value,createdAt=ended.toString()))
            nativeTimeline(events,id,running=status.value.isBlank()).forEach { block ->
                Box(Modifier.testTag("row:${block.event.type}")){NativeTimelineBlock(vm,block,{})}
            }
        } } }
        for(terminal in listOf("completed","interrupted","error")) {
            ui.runOnIdle { thread.value=terminal;status.value="" }
            ui.onNodeWithTag("activityGroupHeader").performClick()
            ui.onNodeWithTag("activityDetail").assertIsDisplayed()
            ui.runOnIdle { status.value=terminal }
            ui.onNodeWithContentDescription("展开详情").assertIsDisplayed()
            ui.onNodeWithContentDescription("收起详情").assertDoesNotExist()
            val header=ui.onNodeWithText("用时 5秒").fetchSemanticsNode().boundsInRoot
            androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("本轮结果 $terminal"))
                .check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()))
            val reply=ui.onNodeWithTag("row:message.delta").fetchSemanticsNode().boundsInRoot
            assertTrue("过程入口应在本轮正文前",header.bottom<=reply.top)
            ui.onNodeWithText("处理过程",substring=true).assertDoesNotExist()
            ui.onNodeWithContentDescription("回复菜单").performClick()
            ui.onNodeWithText("结束于 今天 14:05:10").assertIsDisplayed()
            ui.onNodeWithText("未记录",substring=true).assertDoesNotExist()
            ui.onNodeWithContentDescription("关闭回复菜单").performClick()
        }
    }

    @Test fun processSegmentsStayBetweenMessagesAndFoldIndependently() {
        val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
        val blocks=nativeTimeline(listOf(
            ChatEvent(type="message.delta",threadId="segments",itemId="intro",text="先读取配置"),
            ChatEvent(type="tool.completed",threadId="segments",itemId="read",title="读取配置"),
            ChatEvent(type="message.delta",threadId="segments",itemId="progress",text="继续验证"),
            ChatEvent(type="tool.completed",threadId="segments",itemId="check",title="验证结果"),
            ChatEvent(type="message.delta",threadId="segments",itemId="answer",text="全部完成"),
            ChatEvent(type="turn.completed",threadId="segments",status="completed")),"segments")
        ui.setContent { MaterialTheme { Column {
            blocks.forEach { block -> Box(Modifier.testTag("segmentRow:${block.key}")){NativeTimelineBlock(vm,block,{})} }
        } } }
        fun row(index:Int)=ui.onNodeWithTag("segmentRow:${blocks[index].key}").fetchSemanticsNode().boundsInRoot
        for(index in 0 until blocks.lastIndex)assertTrue("正文和过程应按发生顺序显示",row(index).bottom<=row(index+1).top)
        assertEquals(listOf("全部完成"),blocks.filter{it.event.type=="message.delta"}.map{it.event.text})
        val outer=ui.onNodeWithTag("processToggle:${blocks[0].key}")
        ui.onAllNodesWithContentDescription("展开详情").assertCountEquals(1)
        ui.onNodeWithText("先读取配置").assertDoesNotExist()
        ui.onAllNodesWithTag("activityGroupHeader").assertCountEquals(0)
        outer.performClick()
        fun nativeTextBounds(text:String):android.graphics.Rect{
            val bounds=android.graphics.Rect()
            androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText(text))
                .check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()))
                .check{view,error->
                    if(error!=null)throw error
                    val origin=IntArray(2);val position=IntArray(2)
                    ui.activity.findViewById<android.view.View>(android.R.id.content).getLocationOnScreen(origin)
                    view.getLocationOnScreen(position)
                    bounds.set(position[0]-origin[0],position[1]-origin[1],position[0]-origin[0]+view.width,position[1]-origin[1]+view.height)
                }
            return bounds
        }
        val intro=nativeTextBounds("先读取配置")
        val progress=nativeTextBounds("继续验证")
        ui.onAllNodesWithTag("activityGroupHeader").assertCountEquals(2)
        ui.onAllNodesWithTag("activityDetail").assertCountEquals(0)
        val headers=ui.onAllNodesWithTag("activityGroupHeader").fetchSemanticsNodes()
        assertTrue(intro.bottom<=headers[0].boundsInRoot.top&&headers[0].boundsInRoot.bottom<=progress.top&&progress.bottom<=headers[1].boundsInRoot.top)
        ui.onAllNodesWithTag("activityGroupHeader")[0].performClick()
        ui.onNodeWithText("读取配置").assertIsDisplayed()
        ui.onNodeWithText("验证结果").assertDoesNotExist()
        ui.onAllNodesWithTag("activityGroupHeader")[1].performClick()
        ui.onNodeWithText("验证结果").assertIsDisplayed()
        ui.onAllNodesWithTag("activityGroupHeader")[0].performClick()
        ui.onNodeWithText("读取配置").assertDoesNotExist()
        ui.onNodeWithText("验证结果").assertIsDisplayed()
        outer.performClick()
        ui.onAllNodesWithTag("activityGroupHeader").assertCountEquals(0)
        nativeTextBounds("全部完成")
    }

    @Test fun expandedTurnSurvivesNewMessageAndRowRecreation() {
        val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
        val visible=mutableStateOf(true)
        val appended=mutableStateOf(false)
        var reading=false
        val child=NativeBlock("summary",ChatEvent(type="context.compaction",threadId="a",eventId="summary",status="completed"))
        val turn=NativeBlock("completed:summary",ChatEvent(type="process.completed",threadId="a",title="用时 5秒"),children=listOf(child))
        ui.setContent { MaterialTheme { Column {
            if(visible.value)NativeTimelineBlock(vm,turn,{}, {reading=true})
            if(appended.value)NativeTimelineBlock(vm,NativeBlock("new",ChatEvent(type="user.message",threadId="a",eventId="new",text="新发的消息")),{})
        } } }
        ui.onNodeWithText("用时 5秒").performClick()
        ui.onNodeWithText("上下文已自动压缩").assertIsDisplayed()
        ui.runOnIdle { assertTrue(reading); appended.value=true }
        ui.onNodeWithText("上下文已自动压缩").assertIsDisplayed()
        ui.runOnIdle { visible.value=false }
        ui.onNodeWithText("上下文已自动压缩").assertDoesNotExist()
        ui.runOnIdle { visible.value=true }
        ui.onNodeWithText("上下文已自动压缩").assertIsDisplayed()
        ui.onNodeWithText("用时 5秒").performClick()
        ui.runOnIdle { visible.value=false }
        ui.runOnIdle { visible.value=true }
        ui.onNodeWithText("上下文已自动压缩").assertDoesNotExist()
        assertFalse(vm.timelineDisclosure("b","turn","completed:summary").value)
    }
}
