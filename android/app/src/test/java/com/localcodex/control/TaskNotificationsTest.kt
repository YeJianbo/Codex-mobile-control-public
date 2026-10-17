package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class TaskNotificationsTest {
    private fun event(type:String,text:String="",id:String="",thread:String="t",status:String="",item:String="")=ChatEvent(type=type,text=text,eventId=id,threadId=thread,status=status,itemId=item)

    @Test fun completedMeansSuccessAndShowsThisRoundsFinalAnswer(){
        val done=event("turn.completed",id="done",status="completed")
        val history=listOf(event("user.message","旧提问"),event("message.delta","旧答复"),event("turn.completed"),event("user.message","这次的提问"),event("message.delta","正在检查",item="progress"),event("tool.completed"),event("message.delta","**已修复**：",item="final"),event("message.delta","[查看记录](https://example.test)",item="final"),done)
        val notice=taskNotification(done,history,emptyList(),"完善控制台")
        assertEquals("任务已完成 · 完善控制台",notice.title)
        assertEquals("已修复：查看记录",notice.body)
        assertEquals("t",notice.threadId)
    }

    @Test fun doesNotUseOldAnswerWhenTheNewRoundHasNoText(){
        val done=event("turn.completed",id="new",status="completed")
        val history=listOf(event("message.delta","旧答案"),event("turn.completed"),event("user.message","新请求"),event("tool.completed"),done)
        val notice=taskNotification(done,history,emptyList(),"新对话")
        assertEquals("任务已完成",notice.title)
        assertFalse(notice.body.contains("旧答案"))
        assertFalse(notice.body.contains("新请求"))
    }

    @Test fun findsTheCorrectRoundEvenWhenTheNextRoundHasStarted(){
        val done=event("turn.completed",id="done",status="completed")
        val history=listOf(event("user.message","本轮"),event("message.delta","本轮答案"),done,event("user.message","下一轮"),event("message.delta","下一轮答案"))
        assertEquals("本轮答案",taskNotification(done,history,emptyList(),"").body)
    }

    @Test fun liveStreamIsUsedWhenHistoryHasNotCaughtUp(){
        val tracker=TaskNotificationTracker()
        tracker.accept(event("user.message","本轮问题"))
        tracker.accept(event("message.delta","过程说明",item="progress"))
        tracker.accept(event("tool.started"))
        tracker.accept(event("message.delta","最后",item="answer"))
        tracker.accept(event("message.delta","的结果",item="answer"))
        val done=event("turn.completed",id="done",status="ok")
        assertTrue(tracker.accept(done))
        val old=listOf(event("message.delta","历史旧结果"),event("turn.completed",id="old"))
        assertEquals("最后的结果",tracker.content(done,old,"").body)
    }

    @Test fun duplicateCompletionsFromDifferentSourcesNotifyOnceButTheNextRoundNotifies(){
        val tracker=TaskNotificationTracker()
        tracker.accept(event("turn.started",id="start"))
        assertTrue(tracker.accept(event("turn.completed",id="desktop",status="completed")))
        assertFalse(tracker.accept(event("turn.completed",id="gateway",status="completed")))
        assertFalse(tracker.accept(event("turn.completed",id="desktop",status="completed")))
        tracker.accept(event("thread.started",id="new-start",status="running"))
        assertTrue(tracker.accept(event("turn.completed",id="next",status="completed")))
    }

    @Test fun reconnectReplayIsSilentAndDoesNotReissueTheFinishedTurn(){
        val tracker=TaskNotificationTracker()
        tracker.accept(event("message.delta","旧答案",id="answer").copy(replayed=true))
        assertFalse(tracker.accept(event("turn.completed",id="replay",status="completed").copy(replayed=true)))
        assertFalse(tracker.accept(event("turn.completed",id="duplicate",status="completed")))
        tracker.accept(event("user.message","新一轮",id="question"))
        assertTrue(tracker.accept(event("turn.completed",id="new",status="completed")))
    }

    @Test fun interleavedThreadsKeepTheirOwnResults(){
        val tracker=TaskNotificationTracker()
        tracker.accept(event("message.delta","A 的结果",thread="a"))
        tracker.accept(event("message.delta","B 的结果",thread="b"))
        val a=event("turn.completed",id="a-done",thread="a",status="completed")
        val b=event("turn.completed",id="b-done",thread="b",status="completed")
        assertTrue(tracker.accept(a));assertTrue(tracker.accept(b))
        assertEquals("A 的结果",tracker.content(a,emptyList(),"").body)
        assertEquals("B 的结果",tracker.content(b,emptyList(),"").body)
    }

    @Test fun duplicateHistoryTerminalKeepsTheAnswer(){
        val done=event("turn.completed",id="live",status="completed")
        val history=listOf(event("user.message","问题"),event("message.delta","结果"),event("turn.completed",id="history"),done)
        assertEquals("结果",taskNotification(done,history,emptyList(),"").body)
    }

    @Test fun interruptionAndFailureShowTheirActualState(){
        assertEquals("任务已中断",taskNotification(event("turn.completed",status="interrupted"),emptyList(),emptyList(),"").title)
        val failure=taskNotification(event("turn.completed",status="error"),emptyList(),listOf(event("error","服务容量不足")),"")
        assertEquals("任务失败",failure.title)
        assertEquals("服务容量不足",failure.body)
    }

    @Test fun doesNotNotifyUnidentifiedOrTerminalSessions(){
        val tracker=TaskNotificationTracker()
        listOf("","unknown","debug","terminal:one").forEach{assertFalse(tracker.accept(event("turn.completed",thread=it)))}
    }

    @Test fun failurePublishedAfterCompletionStaysInItsOwnRound(){
        val done=event("turn.completed",id="failed",status="error")
        val error=event("error","模型服务容量不足")
        val next=event("user.message","下一轮")
        val history=listOf(event("user.message","本轮"),done,error,next,event("error","下一轮错误"))
        assertEquals("模型服务容量不足",taskNotification(done,history,emptyList(),"").body)
        assertEquals("模型服务容量不足",taskNotification(done,history,emptyList(),"").failureReason)
    }
}
