package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeInteractionTest {
    @Test fun groupsExecutionWithoutHidingApprovalsOrOutput(){
        val events=listOf(
            ChatEvent(type="tool.started",threadId="t",itemId="a",eventId="1"),
            ChatEvent(type="tool.output",threadId="t",itemId="a",eventId="2",text="result"),
            ChatEvent(type="tool.completed",threadId="t",itemId="a",eventId="3"),
            ChatEvent(type="approval.requested",threadId="t",eventId="4"),
            ChatEvent(type="tool.started",threadId="t",itemId="b",eventId="5")
        )
        val blocks=nativeTimeline(events,"t")
        assertEquals(3,blocks.size)
        assertEquals("result",blocks.first().activities[1].text)
        assertEquals("approval.requested",blocks[1].event.type)
        assertEquals(1,blocks.last().activities.size)
        assertEquals("tool.started",events.first().type)
    }
    @Test fun commentaryAndFileChangesShareOneCompactProcessGroup(){
        val events=listOf(
            ChatEvent(type="tool.started",threadId="t",eventId="1",itemId="a"),
            ChatEvent(type="message.delta",threadId="t",eventId="2",text="正在检查"),
            ChatEvent(type="file.changed",threadId="t",eventId="3",detail="changed.kt"),
            ChatEvent(type="tool.completed",threadId="t",eventId="4",itemId="a"),
            ChatEvent(type="message.delta",threadId="t",eventId="5",text="检查完成")
        )
        val blocks=nativeTimeline(events,"t")
        assertEquals(3,blocks.size)
        assertEquals(listOf("tool.started","file.changed","tool.completed"),blocks[1].activities.map{it.type})
        assertEquals(listOf("正在检查","检查完成"),blocks.filter{it.event.type=="message.delta"}.map{it.event.text})
    }
    @Test fun reasoningImageFileAndCompactionShareOneExpandableTurn(){
        val events=listOf(
            ChatEvent(type="reasoning.summary",threadId="t",eventId="r1",itemId="thought-1",text="先查看图片"),
            ChatEvent(type="tool.started",threadId="t",eventId="i1",itemId="image-1",title="view_image"),
            ChatEvent(type="tool.completed",threadId="t",eventId="i2",itemId="image-1"),
            ChatEvent(type="reasoning.summary",threadId="t",eventId="r2",itemId="thought-2",text="再修改文件"),
            ChatEvent(type="tool.started",threadId="t",eventId="f1",itemId="file-1",title="fileChange"),
            ChatEvent(type="file.changed",threadId="t",eventId="f2",itemId="file-1",files=listOf("screen.kt")),
            ChatEvent(type="tool.completed",threadId="t",eventId="f3",itemId="file-1"),
            ChatEvent(type="context.compaction",threadId="t",eventId="c1",itemId="compact-1",status="running"),
            ChatEvent(type="context.compaction",threadId="t",eventId="c2",itemId="compact-1",status="ok")
        )
        val groups=nativeTimeline(events,"t")
        assertEquals(1,groups.size)
        assertEquals(9,groups[0].activities.size)
    }
    @Test fun activeTurnShowsCommentaryBeforeExpandableActivity(){
        val events=listOf(ChatEvent(type="message.delta",threadId="t",eventId="m",text="我先检查"),ChatEvent(type="reasoning.summary",threadId="t",eventId="r",text="**Checking gateway configuration**"),ChatEvent(type="tool.started",threadId="t",eventId="x",itemId="tool"))
        val blocks=nativeTimeline(events,"t",running=true)
        assertEquals(listOf("message.delta","reasoning.summary"),blocks.map{it.event.type})
        assertEquals("Checking gateway configuration",nativeActivityLabel(events[1].text))
    }
    @Test fun oldQueueErrorsHaveReadableSummary(){
        assertEquals("会话连接已失效，消息已保留，请重试",nativeQueueError("{\"code\":-32600,\"message\":\"thread not found: t\"}"))
        assertEquals("upload failed",nativeQueueError("upload failed"))
    }
    @Test fun desktopControlBlocksAreNotShownAsUserMessages(){
        val ambient="<in-app-browser-context source=\"ambient-ui-state\">This block is automatically supplied ambient UI state, not part of the user's request.</in-app-browser-context>\n## My request:\n真实问题"
        val events=listOf(
            ChatEvent(type="user.message",threadId="t",eventId="history:t:1",text=ambient),
            ChatEvent(type="user.message",threadId="t",eventId="history:t:2",text="<turn_aborted>The user interrupted the previous turn on purpose.</turn_aborted>"),
            ChatEvent(type="user.message",threadId="t",eventId="history:t:3",text="<environment_context>用户引用示例</environment_context>")
        )
        assertEquals(listOf("真实问题","<environment_context>用户引用示例</environment_context>"),nativeTimeline(events,"t").map{it.event.text})
    }
}
