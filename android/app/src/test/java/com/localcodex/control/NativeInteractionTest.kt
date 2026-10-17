package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeInteractionTest {
    @Test fun compactionCompletionMatchesPendingItemsAndPreservesTheNextTurn(){
        fun compact(id:String,item:String,status:String)=ChatEvent(type="context.compaction",threadId="t",eventId=id,itemId=item,status=status)
        val blocks=nativeTimeline(listOf(
            ChatEvent(type="turn.started",threadId="t",eventId="start"),
            compact("first-start","one","running"),compact("second-start","two","running"),compact("first-end","one","ok"),
            compact("third-start","three","running"),compact("wildcard-end","","error"),
            ChatEvent(type="turn.completed",threadId="t",eventId="end",status="completed"),
            ChatEvent(type="turn.started",threadId="t",eventId="next"),compact("next-start","next","running")),"t",running=true)
        val compactions=blocks.filter{it.event.type=="context.compaction"}
        assertEquals(listOf("one" to "ok","two" to "cancelled","" to "error","next" to "running"),compactions.map{it.event.itemId to it.event.status})
        assertEquals("context.compaction:item:three",compactions[2].key)
    }
    @Test fun replacedSteeringReceiptStillAnchorsEarlierLiveOperations(){
        val operation=ChatEvent(type="tool.completed",threadId="t",eventId="live:operation",itemId="operation")
        val steer=ChatEvent(type="user.message",threadId="t",eventId="live:steer",requestId="steer-one",text="补充要求")
        val response=ChatEvent(type="message.delta",threadId="t",eventId="live:response",itemId="response",text="继续处理")
        val incoming=listOf(steer.copy(eventId="history:steer"),response.copy(eventId="history:response",textComplete=true))
        val merged=reconcileNativeHistory(listOf(operation,steer,response),incoming,false)
        assertEquals(listOf("live:operation","history:steer","history:response"),merged.map{it.eventId})
    }
    @Test fun steeringKeepsOldOperationsBeforeTheUserAndSummarizesChangesOnceAtCompletion(){
        val events=listOf(ChatEvent(type="turn.started",threadId="t",eventId="start"),
            ChatEvent(type="file.changed",threadId="t",eventId="old-operation",fileChanges=listOf(NativeFileChange("a.kt",1,0))),
            ChatEvent(type="user.message",threadId="t",eventId="steer",requestId="steer",text="继续优化"),
            ChatEvent(type="message.delta",threadId="t",eventId="ack",itemId="ack",text="继续检查"),
            ChatEvent(type="file.changed",threadId="t",eventId="new-operation",fileChanges=listOf(NativeFileChange("b.kt",2,1))),
            ChatEvent(type="message.delta",threadId="t",eventId="final",itemId="final",text="完成"))
        val active=nativeTimeline(events,"t",running=true)
        assertTrue(active.none{it.event.type=="files.summary"})
        val completed=nativeTimeline(events+ChatEvent(type="turn.completed",threadId="t",status="completed"),"t")
        assertEquals(listOf("a.kt","b.kt"),completed.single{it.event.type=="files.summary"}.event.fileChanges.map{it.path})
        for(blocks in listOf(active,completed)){
            val flat=blocks.flatMap{it.children.ifEmpty{listOf(it)}}
            assertTrue(flat.indexOfFirst{it.event.eventId=="old-operation"}<flat.indexOfFirst{it.event.eventId=="steer"})
        }
    }
    @Test fun desktopAnswerKeepsTheQuestionIdentityForClosingThePendingSheet(){
        val answer=ChatEvent(type="user.message",threadId="t",text="好了",questionReplyId="call-one")
        assertEquals("desktop-question:call-one",nativeAnsweredApproval(answer))
        assertEquals("question-42",nativeAnsweredApproval(answer.copy(questionReplyId="question-42")))
        assertNull(nativeAnsweredApproval(answer.copy(questionReplyId="")))
        assertNull(nativeAnsweredApproval(answer.copy(type="message.delta")))
    }
    @Test fun refreshedSubmissionIdentityRemovesTheOldLiveBubbleAndPreservesRepeatedSends(){
        val history=ChatEvent(type="user.message",threadId="t",eventId="history:one",text="继续",createdAt="2026-10-11T15:11:33.288Z")
        val receipt=history.copy(eventId="receipt:one",requestId="one",createdAt="2026-10-11T15:11:33.787Z")
        val refreshed=history.copy(requestId="one")
        val merged=reconcileNativeHistory(listOf(history,receipt),listOf(refreshed),false)
        assertEquals(listOf(refreshed),merged)
        val separate=receipt.copy(eventId="receipt:two",requestId="two")
        assertEquals(2,nativeTimeline(listOf(refreshed,receipt,separate),"t").count{it.event.type=="user.message"})
    }
    @Test fun compactionIdentitySurvivesHistoryIdChangesWithoutHidingLaterCompactions(){
        val original=ChatEvent(type="context.compaction",threadId="t",eventId="history:old",itemId="history:1",createdAt="2026-10-11T10:31:53.995Z",status="ok")
        val refreshed=original.copy(eventId="history:new",itemId="history:2")
        val tool=ChatEvent(type="tool.completed",threadId="t",eventId="tool")
        val later=original.copy(eventId="history:later",itemId="history:3",createdAt="2026-10-11T10:32:00Z")
        val events=nativeReconnectEvents(listOf(original,tool,refreshed,later))
        assertEquals(2,events.count{it.type=="context.compaction"})
        assertEquals("history:old",events.first().displayKey)
        assertEquals(2,nativeTimeline(events,"t",running=true).count{it.event.type=="context.compaction"})
        val first=original.copy(eventId="live:one",itemId="one")
        val second=original.copy(eventId="live:two",itemId="two")
        assertEquals(2,nativeReconnectEvents(listOf(first,refreshed,second)).count{it.type=="context.compaction"})
    }
    @Test fun savedCompactionReplacesLiveLifecycleAcrossPollingAndLateCompletion(){
        val start=ChatEvent(type="context.compaction",threadId="t",eventId="live:start",itemId="compact-one",createdAt="2026-10-13T11:12:16.650Z",status="running")
        val saved=start.copy(eventId="history:marker",itemId="history:2723",createdAt="2026-10-13T11:12:17.672Z",status="ok")
        val tool=ChatEvent(type="tool.completed",threadId="t",eventId="tool",createdAt="2026-10-13T11:12:23Z")
        val completed=start.copy(eventId="live:done",createdAt="2026-10-13T11:12:17.690Z",status="ok")
        val first=reconcileNativeHistory(listOf(start),listOf(saved),false)
        assertEquals("compact-one",first.single().itemId)
        assertEquals("running",first.single().status)
        assertTrue(nativeCompactionRunning(first,"t"))
        val late=first+tool+completed
        assertEquals(1,nativeTimeline(late,"t").count{it.event.type=="context.compaction"})
        val final=reconcileNativeHistory(late,listOf(saved,tool),false)
        assertEquals(1,final.count{it.type=="context.compaction"})
        assertFalse(nativeCompactionRunning(final,"t"))
        assertEquals(first.single().displayKey,final.first().displayKey)
        val both=reconcileNativeHistory(listOf(start,tool,completed),listOf(saved,tool),false)
        assertEquals(1,nativeTimeline(both,"t").count{it.event.type=="context.compaction"})

        val laterStart=start.copy(eventId="live:next",itemId="compact-two",createdAt="2026-10-13T11:12:24Z")
        val laterSaved=saved.copy(eventId="history:next",createdAt="2026-10-13T11:12:25Z")
        assertEquals(2,nativeTimeline(reconcileNativeHistory(final+laterStart,listOf(saved,tool,laterSaved),false),"t").count{it.event.type=="context.compaction"})
        val ambiguous=saved.copy(eventId="history:other",createdAt="2026-10-13T11:12:17.675Z")
        assertEquals(2,nativeTimeline(listOf(start,completed,saved,ambiguous),"t").count{it.event.type=="context.compaction"&&it.event.eventId.startsWith("history:")})
        val otherTurn=ChatEvent(type="turn.started",threadId="t",createdAt="2026-10-13T11:12:17Z")
        assertEquals(2,nativeTimeline(listOf(start,otherTurn,saved),"t").count{it.event.type=="context.compaction"})
    }
    @Test fun completedCompactionWithoutStartMatchesOnlyOneHistorySummary(){
        val history=ChatEvent(type="context.compaction",threadId="t",eventId="history:marker",itemId="history:42",createdAt="2026-10-16T12:52:13.586Z",status="ok",text="## 当前任务\n\n保留的完整摘要")
        val live=history.copy(eventId="live:done",itemId="compact-1",createdAt="2026-10-16T12:52:13.603Z",text=history.text+"<oai-mem-citation>source</oai-mem-citation>")
        val merged=reconcileNativeHistory(listOf(live),listOf(history),false)
        assertEquals(1,merged.size)
        assertEquals("compact-1",merged.single().itemId)
        assertEquals(1,nativeReconnectEvents(listOf(history,live)).size)
        assertEquals(3,nativeReconnectEvents(listOf(history,live,live.copy(eventId="live:other",itemId="compact-2"))).size)
        val later=history.copy(eventId="history:later",createdAt="2026-10-16T12:54:00Z")
        assertEquals(3,nativeReconnectEvents(listOf(history,live,later)).size)
        val boundary=ChatEvent(type="turn.started",threadId="t",turnId="next",createdAt="2026-10-16T12:53:00Z")
        assertEquals(3,nativeReconnectEvents(listOf(live,boundary,later)).size)
        val truncated=history.copy(text="内部摘要 `")
        val summary=ChatEvent(type="message.delta",threadId="t",eventId="summary",text=truncated.text+"<oai-mem-citation>`后续原文")
        assertEquals(listOf(truncated),foldNativeCompactionSummaries(listOf(summary,truncated)))
    }
    @Test fun retryNotificationsFoldAndFollowTheirOwnTurn(){
        val first=ChatEvent(type="error",threadId="t",turnId="one",eventId="retry2",title="正在重新连接 2/5",detail="Reconnecting... 2/5\nos error 10054",willRetry=true)
        val next=first.copy(eventId="retry3",title="正在重新连接 3/5",detail="Reconnecting... 3/5\nHTTP 502")
        val retries=listOf(first,first,next)
        fun errors(tail:List<ChatEvent> = emptyList())=nativeTimeline(retries+tail,"t",running=true).filter{it.event.type=="error"}.map{it.event}
        val active=errors(listOf(ChatEvent(type="tool.output",threadId="t",turnId="one",text="already running"))).single()
        assertEquals("正在重试",active.title)
        assertTrue(active.detail.contains("2/5"));assertTrue(active.detail.contains("3/5"));assertTrue(active.detail.contains("10054"));assertTrue(active.detail.contains("502"))
        assertEquals("执行已恢复",errors(listOf(ChatEvent(type="message.delta",threadId="t",turnId="one",text="继续处理"))).single().title)
        assertEquals("重试记录",errors(listOf(ChatEvent(type="turn.started",threadId="t",turnId="two"),ChatEvent(type="message.delta",threadId="t",turnId="two",text="next turn"))).single().title)
        assertEquals("重试已停止",errors(listOf(ChatEvent(type="turn.completed",threadId="t",turnId="one",status="interrupted"))).single().title)
        val failure=first.copy(eventId="failure",title="执行失败",willRetry=false)
        val failed=errors(listOf(failure))
        assertEquals(listOf("重试未成功","执行失败"),failed.map{it.title})
        assertEquals("正在重新连接 2/5",first.title)
    }
    @Test fun hiddenCloudTurnsDoNotLeaveOrphanEndTimes(){
        val start=ChatEvent(type="turn.started",threadId="cloud:t",createdAt="2026-10-07T00:00:00Z")
        val end=ChatEvent(type="turn.completed",threadId="cloud:t",status="completed",createdAt="2026-10-07T00:01:00Z")
        assertTrue(nativeTimeline(listOf(start,end,start,end),"cloud:t").isEmpty())
        val user=ChatEvent(type="user.message",threadId="cloud:t",text="继续迭代")
        assertEquals(listOf("user.message","run.ended"),nativeTimeline(listOf(start,user,end),"cloud:t").map{it.event.type})
        val error=ChatEvent(type="error",threadId="cloud:t",text="连接失败")
        assertEquals(listOf("error","run.ended"),nativeTimeline(listOf(start,error,end),"cloud:t").map{it.event.type})
    }
    @Test fun movingServerWindowRetainsPrefixButUsesNewOverlappingContent(){
        fun event(id:String,text:String=id)=ChatEvent(type="message.delta",threadId="t",eventId=id,text=text)
        val old=listOf(event("a"),event("b"),event("c"))
        assertEquals(listOf(event("a"),event("b","updated"),event("c"),event("d")),retainNativeHistoryPrefix(old,listOf(event("b","updated"),event("c"),event("d"))))
        val older=listOf(event("z"))+old
        assertEquals(older,retainNativeHistoryPrefix(old,older))
        assertEquals(listOf(event("unrelated")),retainNativeHistoryPrefix(old,listOf(event("unrelated"))))
    }
    @Test fun compactionSurvivesLaggingHistoryAndCompletesAcrossOtherEvents(){
        val start=ChatEvent(type="context.compaction",threadId="t",eventId="start",itemId="c",status="running")
        val tool=ChatEvent(type="tool.completed",threadId="t",eventId="tool",status="ok")
        val prior=listOf(start,tool)
        val restored=retainNativeCompaction(prior,listOf(tool))
        assertTrue(restored.contains(start))
        assertEquals(1,retainNativeCompaction(restored,restored).count{it.type=="context.compaction"})
        val done=start.copy(eventId="done",status="ok")
        assertEquals(listOf(tool,done),retainNativeCompaction(prior,listOf(tool,done)))
        val blocks=nativeTimeline(listOf(start,tool,done),"t")
        assertEquals(1,blocks.count{it.event.type=="context.compaction"})
        assertEquals("ok",blocks.single{it.event.type=="context.compaction"}.event.status)
        val stopped=nativeTimeline(listOf(start,tool,ChatEvent(type="turn.completed",threadId="t",eventId="end")),"t")
        assertEquals("cancelled",stopped.single{it.event.type=="context.compaction"}.event.status)
    }
    @Test fun onlyCurrentUnfinishedActivityPulses(){
        val old=ChatEvent(type="reasoning.summary",eventId="old")
        val active=ChatEvent(type="tool.started",eventId="active")
        assertFalse(nativeActivityRunning(listOf(old),listOf(old,active),true))
        assertTrue(nativeActivityRunning(listOf(active),listOf(old,active),true))
        assertFalse(nativeActivityRunning(listOf(active),listOf(old,active),false))
        val done=ChatEvent(type="tool.completed",eventId="done")
        assertFalse(nativeActivityRunning(listOf(active,done),listOf(old,active,done),true))
        assertFalse(nativeActivityRunning(listOf(active),listOf(active,ChatEvent(type="approval.requested")),true))
        val first=ChatEvent(type="reasoning.summary",eventId="r1",itemId="r",text="检查")
        val second=first.copy(eventId="r2",text="配置")
        assertTrue(nativeActivityRunning(listOf(first.copy(text="检查配置")),listOf(first,second),true))
    }
    @Test fun oldOperationGroupsDoNotScanHistoryForEveryTool(){
        val old=(0 until 5000).map{ChatEvent(type="tool.completed",threadId="t",eventId="old:$it",itemId="tool:$it",status="ok")}
        val active=ChatEvent(type="reasoning.summary",threadId="t",eventId="current",itemId="current",text="继续检查")
        var reads=0
        val events=object:AbstractList<ChatEvent>(){
            val rows=old+active
            override val size get()=rows.size
            override fun get(index:Int):ChatEvent{reads++;return rows[index]}
        }
        assertFalse(nativeActivityRunning(old.subList(4000,4200),events,true))
        assertEquals(1,reads)
        val unrelated=old.take(100)+active.copy(eventId="prior-reasoning",itemId="other")
        reads=0
        assertFalse(nativeActivityRunning(unrelated,events,true))
        assertEquals(1,reads)
    }
    @Test fun processDurationUsesValidLifecycleTimes(){
        assertEquals("用时 1分 5秒",nativeProcessDuration("2026-09-28T00:00:00Z","2026-09-28T00:01:05Z"))
        assertEquals("处理过程",nativeProcessDuration("","2026-09-28T00:01:05Z"))
        assertEquals("处理过程",nativeProcessDuration("2026-09-28T00:02:00Z","2026-09-28T00:01:05Z"))
    }
    @Test fun completedTurnFoldsCommentaryWithToolsAndKeepsOnlyTheConclusionVisible(){
        val events=listOf(
            ChatEvent(type="user.message",threadId="t",text="修复"),
            ChatEvent(type="message.delta",threadId="t",itemId="progress",text="正在检查"),
            ChatEvent(type="tool.started",threadId="t",itemId="tool"),
            ChatEvent(type="message.delta",threadId="t",itemId="final",text="已完成"))
        assertEquals(4,nativeTimeline(events,"t",running=true).size)
        val completed=nativeTimeline(events+ChatEvent(type="turn.completed",threadId="t",status="completed"),"t")
        assertEquals(listOf("user.message","process.completed","message.delta"),completed.map{it.event.type})
        assertEquals("正在检查",completed[1].children.first().event.text)
        assertEquals(2,completed[1].children.size)
        assertEquals("已完成",completed.last().event.text)
        assertFalse(completed[1].children.any{it.copyable})
        assertEquals(1,completed.count{it.copyable})
        val interrupted=nativeTimeline(events+ChatEvent(type="turn.completed",threadId="t",status="interrupted"),"t")
        assertEquals("process.completed",interrupted[2].event.type)
        assertEquals(listOf("正在检查","已完成"),interrupted.filter{it.event.type=="message.delta"}.map{it.event.text})
    }
    @Test fun onlyFinalMessageInEachTurnCanBeCopied(){
        val events=listOf(
            ChatEvent(type="user.message",threadId="t",eventId="u1",text="任务"),
            ChatEvent(type="message.delta",threadId="t",eventId="p1",itemId="progress",text="先检查"),
            ChatEvent(type="message.delta",threadId="t",eventId="f1",itemId="final",text="检查完成"))
        assertTrue(nativeTimeline(events,"t",running=true).none{it.copyable})
        val completed=nativeTimeline(events,"t",running=false)
        assertEquals(listOf("检查完成"),completed.filter{it.copyable}.map{it.event.text})
    }
    @Test fun retryBelongsOnlyToLatestCompletedAnswerAndKeepsItsOwnPrompt(){
        val first=ChatEvent(type="user.message",threadId="t",eventId="u1",text="第一个问题")
        val second=ChatEvent(type="user.message",threadId="t",eventId="u2",text="第二个问题",images=listOf(NativeImage("image-2","two.png")))
        val events=listOf(first,ChatEvent(type="turn.started",threadId="t"),ChatEvent(type="message.delta",threadId="t",eventId="a1",text="第一个回答"),ChatEvent(type="turn.completed",threadId="t",status="completed"),second,ChatEvent(type="turn.started",threadId="t"),ChatEvent(type="message.delta",threadId="t",eventId="a2",text="第二个回答"),ChatEvent(type="turn.completed",threadId="t",status="completed"))
        val answers=nativeTimeline(events,"t").filter{it.event.type=="message.delta"}
        assertTrue(answers.all{it.copyable})
        assertNull(answers.first().retryPrompt)
        assertEquals(second,answers.last().retryPrompt)
        assertTrue(nativeTimeline(events,"t",running=true).none{it.retryPrompt!=null})
        val failed=nativeTimeline(events.dropLast(1)+ChatEvent(type="turn.completed",threadId="t",status="failed"),"t").last()
        assertEquals(second,failed.retryPrompt)
        assertNull(nativeTimeline(events.drop(4).toMutableList().apply{this[0]=second.copy(attachments=listOf(NativeAttachment("screen.png","F:/screen.png")))},"t").last().retryPrompt)
    }
    @Test fun longStreamingReplyRetainsEveryDeltaAndFirstMessageIdentity(){
        val chunks=(0 until 1500).map{index->
            ChatEvent(type="message.delta",threadId="t",eventId="delta-$index",itemId="answer",text="片段$index|")
        }
        val blocks=nativeTimeline(chunks,"t",running=true)
        assertEquals(1,blocks.size)
        assertEquals("delta-0",blocks.single().event.eventId)
        assertEquals(chunks.joinToString(""){it.text},blocks.single().event.text)
    }
    @Test fun transcriptReplacementKeepsCodexItemRowIdentity(){
        val live=ChatEvent(type="message.delta",threadId="t",eventId="live:42",itemId="msg-42",text="正在回答")
        val saved=live.copy(eventId="history:t:session:18",text="正在回答，已经完成")
        assertEquals(nativeTimeline(listOf(live),"t",running=true).single().key,
            nativeTimeline(listOf(saved),"t",running=true).single().key)
        val next=ChatEvent(type="message.delta",threadId="t",eventId="live:43",itemId="msg-43",text="下一条")
        assertNotEquals(nativeTimeline(listOf(live),"t").single().key,nativeTimeline(listOf(next),"t").single().key)
    }
    @Test fun uniqueLiveEventsKeepDisplayIdentityWhenHistoryReplacesIds(){
        val live=listOf(
            ChatEvent(type="message.delta",threadId="t",eventId="live:progress",text="正在检查"),
            ChatEvent(type="tool.started",threadId="t",eventId="live:tool",title="运行命令"),
            ChatEvent(type="message.delta",threadId="t",eventId="live:final",text="已完成"))
        val saved=live.map{it.copy(eventId=it.eventId.replace("live:","history:t:session:"))}
        val matched=preserveNativeEventKeys(live,saved)
        assertEquals(saved.map{it.eventId},matched.map{it.eventId})
        assertEquals(nativeTimeline(live,"t").map{it.key},nativeTimeline(matched,"t").map{it.key})
        assertEquals(matched,preserveNativeEventKeys(matched,matched))
    }
    @Test fun duplicateEventTextDoesNotReuseAnUnrelatedRowKey(){
        val live=listOf("first","second").map{ChatEvent(type="message.delta",threadId="t",eventId="live:$it",text="相同输出")}
        val saved=listOf(ChatEvent(type="message.delta",threadId="t",eventId="history:t:session:new",text="相同输出"))
        assertEquals("",preserveNativeEventKeys(live,saved).single().displayKey)
    }
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
    @Test fun commentarySeparatesIndependentProcessGroups(){
        val events=listOf(
            ChatEvent(type="tool.started",threadId="t",eventId="1",itemId="a"),
            ChatEvent(type="message.delta",threadId="t",eventId="2",text="正在检查"),
            ChatEvent(type="file.changed",threadId="t",eventId="3",detail="changed.kt"),
            ChatEvent(type="tool.completed",threadId="t",eventId="4",itemId="a"),
            ChatEvent(type="message.delta",threadId="t",eventId="5",text="检查完成")
        )
        val blocks=nativeTimeline(events,"t",running=true)
        assertEquals(4,blocks.size)
        assertEquals(listOf("tool.started"),blocks[0].activities.map{it.type})
        assertEquals(listOf("file.changed","tool.completed"),blocks[2].activities.map{it.type})
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
        assertEquals(3,groups.size)
        assertEquals(7,groups[0].activities.size)
        assertEquals("再修改文件",nativeActivitySummary(groups[0].activities))
        assertEquals("context.compaction",groups[1].event.type)
        assertEquals("ok",groups[1].event.status)
    }
    @Test fun activeTurnShowsExpandableActivityAfterItsCommentary(){
        val events=listOf(ChatEvent(type="message.delta",threadId="t",eventId="m",text="我先检查"),ChatEvent(type="reasoning.summary",threadId="t",eventId="r",text="**Checking gateway configuration**"),ChatEvent(type="tool.started",threadId="t",eventId="x",itemId="tool"))
        val blocks=nativeTimeline(events,"t",running=true)
        assertEquals("message.delta",blocks.first().event.type)
        assertEquals(listOf("reasoning.summary","tool.started"),blocks.last().activities.map{it.type})
        assertEquals("Checking gateway configuration",nativeActivityLabel(events[1].text))
    }
    @Test fun processSegmentsKeepTheirKeysAndOrderAcrossStreamingAndCompletion(){
        val user=ChatEvent(type="user.message",threadId="t",eventId="u",text="检查")
        val events=listOf(user,
            ChatEvent(type="message.delta",threadId="t",itemId="intro",text="先读取"),
            ChatEvent(type="tool.completed",threadId="t",itemId="read",activityGroupId="read-group",activityCount=3),
            ChatEvent(type="message.delta",threadId="t",itemId="progress",text="再验证"),
            ChatEvent(type="tool.started",threadId="t",itemId="check"))
        val before=nativeTimeline(events.take(3),"t",running=true)
        val streaming=nativeTimeline(events,"t",running=true)
        assertEquals(before.last().key,streaming[2].key)
        assertEquals(3,streaming[2].activities.single().activityCount)
        assertNotEquals(streaming[2].key,streaming[4].key)
        for(status in listOf("completed","interrupted","failed")){
            val completed=nativeTimeline(events+ChatEvent(type="message.delta",threadId="t",itemId="final",text="结果")+
                ChatEvent(type="turn.completed",threadId="t",status=status,createdAt="2026-10-14T00:00:05Z"),"t")
            assertEquals(if(status=="completed")listOf("user.message","process.completed","message.delta") else listOf("user.message","message.delta","process.completed","message.delta","message.delta"),completed.map{it.event.type})
            assertEquals(if(status=="completed")listOf("结果") else listOf("先读取","再验证","结果"),completed.filter{it.event.type=="message.delta"}.map{it.event.text})
            if(status=="completed")assertEquals(listOf("先读取","再验证"),completed.flatMap{it.children}.filter{it.event.type=="message.delta"}.map{it.event.text})
            assertEquals(listOf("read","check"),completed.flatMap{it.children}.flatMap{it.activities}.map{it.itemId})
            assertEquals(listOf(streaming[2].key,streaming[4].key),completed.single{it.event.type=="process.completed"}.children.filter{it.activities.isNotEmpty()}.map{it.key})
            assertEquals(user,completed.last().retryPrompt)
            assertEquals("2026-10-14T00:00:05Z",completed.last().endedAt)
            assertEquals(1,completed.count{it.copyable})
        }
    }
    @Test fun lateReceiptsAndDuplicateCompletionRemainInsideTheirOriginalTurn(){
        val events=listOf(
            ChatEvent(type="turn.started",turnId="one"),ChatEvent(type="tool.started",itemId="edit",turnId="one"),
            ChatEvent(type="file.changed",files=listOf("a.kt")),ChatEvent(type="message.delta",itemId="answer",text="完成"),
            ChatEvent(type="turn.completed",turnId="one",eventId="live:end",status="completed"),
            ChatEvent(type="user.message",text="下一轮"),ChatEvent(type="turn.started",turnId="two"),
            ChatEvent(type="tool.started",itemId="new",turnId="two"),ChatEvent(type="tool.completed",itemId="edit"),
            ChatEvent(type="file.changed",turnId="one",files=listOf("b.kt")),
            ChatEvent(type="turn.completed",turnId="one",eventId="history:end",status="completed")
        ).mapIndexed{index,e->e.copy(threadId="t",eventId=e.eventId.ifBlank{"event:$index"})}
        val blocks=nativeTimeline(events,"t",running=true)
        assertEquals(listOf("process.completed","message.delta","files.summary","user.message","tool.started"),blocks.map{it.event.type})
        assertEquals(listOf("a.kt","b.kt"),blocks[2].event.fileChanges.map{it.path})
        assertTrue(blocks[0].children.flatMap{it.activities}.any{it.type=="tool.completed"&&it.itemId=="edit"})
        assertEquals("new",blocks.last().activities.single().itemId)
        assertEquals("完成",blocks[1].event.text)
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
