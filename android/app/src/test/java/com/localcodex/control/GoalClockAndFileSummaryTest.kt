package com.localcodex.control
import org.junit.Assert.*
import org.junit.Test

class GoalClockAndFileSummaryTest {
 @Test fun repeatedSnapshotsDoNotResetTheRunningClockAndPauseDoesNotCountIdleTime(){
  val clock=GoalRunClock()
  assertEquals(10L,clock.sample(10,true,0))
  assertEquals(12L,clock.sample(10,true,2500))
  assertEquals(13L,clock.sample(11,false,3000))
  assertEquals(13L,clock.sample(11,false,30000))
  assertEquals(13L,clock.sample(11,true,30000))
  assertEquals(15L,clock.sample(11,true,32000))
  assertEquals(20L,clock.sample(20,false,33000))
  assertNull(GoalRunClock().sample(null,true,0))
 }
 @Test fun eachTurnHasOneFileSummaryAcrossCommentaryCompletionAndInterruption(){
  val edits=listOf(NativeFileChange("a.kt",2,1),NativeFileChange("b.kt",1,0))
  val events=listOf(ChatEvent("user.message","t",text="修改"),ChatEvent("tool.completed","t",eventId="edit1",fileChanges=edits),ChatEvent("message.delta","t",text="继续检查"),ChatEvent("tool.completed","t",eventId="edit2",fileChanges=edits.reversed()),ChatEvent("message.delta","t",text="完成"))
  for(status in listOf("", "completed", "interrupted")){
   val input=events+if(status.isEmpty())emptyList() else listOf(ChatEvent("turn.completed","t",status=status))
   val summaries=nativeTimeline(input,"t",running=status.isEmpty()).filter{it.event.type=="files.summary"}
   assertEquals(if(status.isEmpty())0 else 1,summaries.size)
   if(status.isNotEmpty())assertEquals(2,nativeFileChanges(summaries.single().activities).size)
  }
  assertEquals(2,nativeTimeline(events+ChatEvent("turn.completed","t",status="completed")+events.map{it.copy(eventId=it.eventId.takeIf{v->v.isNotBlank()}?.plus("-next").orEmpty())},"t").count{it.event.type=="files.summary"})
 }
}
