package com.localcodex.control
import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import org.junit.Rule
import org.junit.Test
class FileChangeCardUiTest {
 @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
 @Test fun selectingFileExcludesSimilarNamesAndUpdatesItsOpenPatch(){
  val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
  val patch=androidx.compose.runtime.mutableStateOf("*** Begin Patch\n*** Update File: a.kt\n@@\n-old\n+selected\n*** Add File: a.kt.bak\n+sibling\n*** End Patch")
  ui.setContent{MaterialTheme{NativeFileChangeCard(vm,NativeBlock("files",ChatEvent(type="files.summary",threadId="t"),activities=listOf(ChatEvent("file.changed","t",eventId="edit",diff=patch.value))))}}
  ui.onNodeWithText("已更改 2 个文件  +2 −1").performClick()
  ui.onNodeWithText("a.kt").performClick()
  ui.onNodeWithTag("changeDetail").assertIsDisplayed()
  ui.onNodeWithText("+selected").assertIsDisplayed();ui.onNodeWithText("+sibling").assertDoesNotExist()
  ui.runOnIdle{patch.value=patch.value.replace("+selected","+updated")}
  ui.waitUntil(5000){ui.onAllNodesWithText("+updated").fetchSemanticsNodes().isNotEmpty()}
  ui.onNodeWithText("+updated").assertIsDisplayed();ui.onNodeWithText("+selected").assertDoesNotExist();ui.onNodeWithText("+sibling").assertDoesNotExist()
  ui.onNodeWithContentDescription("关闭改动").performClick()
  ui.onNodeWithText("a.kt.bak").performClick()
  ui.onNodeWithText("+sibling").assertIsDisplayed();ui.onNodeWithText("+updated").assertDoesNotExist()
 }
 @Test fun summaryOnlyShowsRecordedSidesAndKeepsRecordedZero(){
  val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
  val file=androidx.compose.runtime.mutableStateOf(NativeFileChange("a.kt"))
  ui.setContent{MaterialTheme{NativeFileChangeCard(vm,NativeBlock("files",ChatEvent(type="files.summary",threadId="t"),activities=listOf(ChatEvent("tool.completed","t",fileChanges=listOf(file.value)))))}}
  ui.onNodeWithText("已更改 1 个文件").assertIsDisplayed()
  ui.runOnIdle{file.value=NativeFileChange("a.kt",7,null)}
  ui.onNodeWithText("已更改 1 个文件  +7").assertIsDisplayed()
  ui.runOnIdle{file.value=NativeFileChange("a.kt",null,2)}
  ui.onNodeWithText("已更改 1 个文件  −2").assertIsDisplayed()
  ui.runOnIdle{file.value=NativeFileChange("a.kt",0,0)}
  ui.onNodeWithText("已更改 1 个文件  +0 −0").assertIsDisplayed()
  ui.onAllNodes(hasText("未记录",substring=true)).assertCountEquals(0)
 }
 @Test fun diffSummaryOpensPatchWithoutSeparateViewChangesButton(){
  val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
  val event=ChatEvent("diff.updated","t",eventId="diff",files=listOf("example.kt"),diff="--- a/example.kt\n+++ b/example.kt\n@@ -1 +1 @@\n-old\n+new")
  val events=listOf(ChatEvent("message.delta","t",text="完成"),event,ChatEvent("turn.completed","t",status="completed"))
  ui.setContent{MaterialTheme{androidx.compose.foundation.layout.Column{nativeTimeline(events,"t").forEach{NativeTimelineBlock(vm,it,{})}}}}
  ui.onNodeWithText("查看改动").assertDoesNotExist()
  ui.waitForIdle()
  val image=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
  val app=ApplicationProvider.getApplicationContext<Application>()
  java.io.File(app.getExternalFilesDir(null),"native-file-summary.png").outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
  ui.onNodeWithText("已更改 1 个文件  +1 −1").performClick()
  ui.onNodeWithText("example.kt").performClick()
  ui.onNodeWithTag("changeDetail").assertIsDisplayed()
 }
 @Test fun fileSummaryAppearsOnceEvenAfterExpandingCompletedProcess(){
  val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
  val files=listOf(NativeFileChange("a.kt",2,1),NativeFileChange("b.kt",1,0))
  val completed=androidx.compose.runtime.mutableStateOf(false)
  val events=listOf(ChatEvent("tool.completed","t",eventId="a",fileChanges=files),ChatEvent("message.delta","t",text="继续检查"),ChatEvent("tool.completed","t",eventId="b",fileChanges=files.reversed()),ChatEvent("message.delta","t",text="完成"))
  ui.setContent{MaterialTheme{androidx.compose.foundation.layout.Column{
   nativeTimeline(events+if(completed.value)listOf(ChatEvent("turn.completed","t",status="completed"))else emptyList(),"t",running=!completed.value).forEach{NativeTimelineBlock(vm,it,{})}
  }}}
  ui.onAllNodes(hasText("已更改",substring=true)).assertCountEquals(0)
  ui.runOnIdle{completed.value=true}
  ui.onAllNodes(hasText("已更改",substring=true)).assertCountEquals(1)
  ui.onNodeWithContentDescription("展开详情").performClick()
  ui.onAllNodes(hasText("已更改",substring=true)).assertCountEquals(1)
 }
 @Test fun patchShowsLinesAndExpandsUnchangedContext(){
  val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
  val patch="*** Update File: example.kt\n@@ -36,12 +36,13 @@\n"+(0..11).joinToString("\n"){" context$it"}+"\n+new"
  val event=ChatEvent(type="file.changed",threadId="t",eventId="edit",files=listOf("example.kt"),diff=patch)
  ui.setContent{MaterialTheme{NativeFileChangeCard(vm,NativeBlock("files",ChatEvent(type="files.summary",threadId="t"),activities=listOf(event)))}}
  ui.onNodeWithText("已更改 1 个文件  +1 −0").performClick()
  ui.onNodeWithText("example.kt").performClick()
  ui.onNodeWithTag("changeDetail").assertIsDisplayed()
  ui.onNodeWithText(" context5").assertDoesNotExist()
  ui.onNodeWithText("6 行未修改 · 展开").performClick()
  ui.onNodeWithText(" context5").assertIsDisplayed()
 }
 @Test fun previewExpandsRemainingFilesAndOpensPatch(){
  val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
  val events=(1..4).map{ChatEvent(type="file.changed",threadId="t",eventId="f$it",files=listOf("file$it.kt"),diff="--- a/file$it.kt\n+++ b/file$it.kt\n@@ -1 +1 @@\n-old\n+new")}
  ui.setContent{MaterialTheme{NativeFileChangeCard(vm,NativeBlock("files",ChatEvent(type="files.summary",threadId="t"),activities=events))}}
  ui.onNodeWithText("已更改 4 个文件  +4 −4").assertIsDisplayed()
  ui.onNodeWithText("file4.kt").assertDoesNotExist()
  ui.onNodeWithText("file1.kt").assertDoesNotExist()
  ui.onNodeWithText("已更改 4 个文件  +4 −4").performClick()
  ui.onNodeWithText("file4.kt").assertIsDisplayed().performClick()
  ui.onAllNodesWithText("file4.kt").fetchSemanticsNodes().let{org.junit.Assert.assertTrue(it.size>=2)}
 }
}
