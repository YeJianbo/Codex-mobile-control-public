package com.localcodex.control
import org.junit.Assert.*
import org.junit.Test
class GoalFileSummaryTest {
 @Test fun headerTextInsideChangedCodeDoesNotInventFiles(){
  val patch=ChatEvent("diff.updated",diff="*** Begin Patch\n--- a/real.kt\n+++ b/real.kt\n@@ -0 +1 @@\n+value = \"+++ b/fake.kt\"\n+*** Update File: another-fake.kt\n*** End Patch")
  assertEquals(listOf(NativeFileChange("real.kt")),nativeFileChanges(listOf(patch),includeLineCounts=false))
  assertEquals(listOf(NativeFileChange("real.kt",2,0)),nativeFileChanges(listOf(patch)))
 }
 @Test fun closedLegacyPatchesKeepFileOrderAndDeferCounts(){
  val known=ChatEvent("file.changed",fileChanges=listOf(NativeFileChange("known.kt",8,3)))
  val patch=ChatEvent("diff.updated",files=listOf("declared.kt"),diff="--- a/first.kt\r\n+++ b/first.kt\r\n@@ -1 +1 @@\r\n-old\r\n+new\r\n*** Add File: second.kt\r\n+line\r\n")
  assertEquals(listOf(NativeFileChange("known.kt",8,3),NativeFileChange("declared.kt"),NativeFileChange("first.kt"),NativeFileChange("second.kt")),nativeFileChanges(listOf(known,patch),includeLineCounts=false))
  assertEquals(listOf(NativeFileChange("known.kt",8,3),NativeFileChange("declared.kt"),NativeFileChange("first.kt",1,1),NativeFileChange("second.kt",1,0)),nativeFileChanges(listOf(known,patch)))
 }
 @Test fun headerOnlySummaryHandlesCarriageReturnsDeletionAndReplacesOlderCounts(){
  val old=ChatEvent("file.changed",fileChanges=listOf(NativeFileChange("a.kt",8,3)))
  val update=ChatEvent("diff.updated",diff="--- a/a.kt\r+++ b/a.kt\r@@ -1 +1 @@\r-old\r+new\r+++ /dev/null\r*** Delete File: gone.kt\r")
  assertEquals(listOf(NativeFileChange("a.kt"),NativeFileChange("gone.kt")),nativeFileChanges(listOf(old,update),includeLineCounts=false))
 }
 @Test fun completedTimelineDefersLegacyCountsUntilFileDetailsAreRequested(){
  val patch=ChatEvent("file.changed","t",eventId="patch",diff="--- a/a.kt\n+++ b/a.kt\n@@ -1 +1 @@\n-old\n+new")
  val events=listOf(ChatEvent("user.message","t",text="修改"),patch,ChatEvent("message.delta","t",text="完成"),ChatEvent("turn.completed","t",status="completed"))
  val summary=nativeTimeline(events,"t").single{it.event.type=="files.summary"}
  assertEquals(listOf(NativeFileChange("a.kt")),summary.event.fileChanges)
  assertEquals(listOf(NativeFileChange("a.kt",1,1)),nativeFileChanges(summary.activities))
 }
 @Test fun runtimeIsOfficialCumulativeTime(){assertNull(goalRunTime(null));assertEquals("运行时间 1小时2分3秒",goalRunTime(3723))}
 @Test fun subagentAndReplayDoNotNotify(){assertNull(goalNotification(ChatEvent(type="goal.completed",threadId="t",subagent=true)));assertNull(goalNotification(ChatEvent(type="goal.completed",threadId="t",replayed=true)))}
 @Test fun repeatedDiffIsReplacement(){val event=ChatEvent(type="file.changed",files=listOf("a"),diff="--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new");assertEquals(listOf(NativeFileChange("a",1,1)),nativeFileChanges(listOf(event,event)))}
}
