package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import androidx.compose.ui.test.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import okhttp3.*
import okhttp3.mockwebserver.*
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.CopyOnWriteArrayList

@RunWith(AndroidJUnit4::class)
class NativeFlowTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @get:Rule val testName=org.junit.rules.TestName()

    @Test fun leavingAccountReadCancelsItsCallAndRefreshKeepsExistingData(){
        stalledAccountService="codex"
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("设置").performClick()
        ui.onNodeWithTag("settings:accounts").performClick()
        ui.onNodeWithTag("accountService:codex").performClick()
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as OkHttpClient
        var old:Call?=null
        ui.waitUntil(5000){old=transport.dispatcher.runningCalls().firstOrNull{it.request().url.encodedPath=="/api/local-console/accounts/codex"&&!it.isCanceled()};old!=null}
        ui.onNodeWithContentDescription("返回").performClick()
        ui.waitUntil(5000){old!!.isCanceled()&&!vm.accountsState.loading}
        ui.onNodeWithTag("accountService:claude").performClick()
        ui.waitUntil(5000){!vm.accountsState.loading&&vm.accountsState.data?.optString("fixture")=="claude"}
        val retained=vm.accountsState.data
        stalledAccountService="claude"
        ui.onNodeWithText("刷新",substring=false).performClick()
        var refresh:Call?=null
        ui.waitUntil(5000){refresh=transport.dispatcher.runningCalls().firstOrNull{it.request().url.encodedPath=="/api/local-console/accounts/claude"&&!it.isCanceled()};refresh!=null}
        Assert.assertSame(retained,vm.accountsState.data)
        ui.runOnUiThread{vm.cancelAccountRead("codex")}
        Assert.assertFalse(refresh!!.isCanceled())
        Assert.assertTrue(vm.accountsState.loading)
        ui.onNodeWithContentDescription("返回").performClick()
        ui.waitUntil(5000){refresh!!.isCanceled()&&!vm.accountsState.loading}
        Assert.assertTrue(vm.state.connected)
        Assert.assertTrue(vm.accountsState.error.isBlank())
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun leavingAccountPreviewKeepsItsOperationAndHidesTheLateDialog(){
        holdAccountPreview=true
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("设置").performClick()
        ui.onNodeWithTag("settings:accounts").performClick()
        ui.onNodeWithTag("accountService:codex").performClick()
        ui.waitUntil(5000){!vm.accountsState.loading&&vm.accountsState.data!=null}
        ui.runOnUiThread{vm.accountAction("codex","switch-preview",JSONObject().put("id","fixture-account"))}
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as OkHttpClient
        var preview:Call?=null
        ui.waitUntil(5000){preview=transport.dispatcher.runningCalls().firstOrNull{it.request().url.encodedPath.endsWith("/switch-preview")&&!it.isCanceled()};preview!=null}
        ui.onNodeWithContentDescription("返回").performClick()
        ui.onNodeWithTag("accountsPage:").assertIsDisplayed()
        Assert.assertFalse(preview!!.isCanceled())
        releaseAccountPreview.countDown()
        ui.waitUntil(5000){vm.accountsState.confirmation!=null&&vm.accountsState.busy.isBlank()}
        ui.onNodeWithText("确认切换账号").assertDoesNotExist()
        ui.onNodeWithTag("accountService:claude").performClick()
        ui.waitUntil(5000){!vm.accountsState.loading&&vm.accountsState.data?.optString("fixture")=="claude"}
        ui.onNodeWithText("确认切换账号").assertDoesNotExist()
        Assert.assertTrue(vm.state.connected)
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun conversationHeaderTypographyPreview(){
        sidebarFixture="""{"threads":[{"id":"t","title":"自动科研","projectPath":"F:/new-chat","status":"running"}]}"""
        ui.runOnUiThread{androidx.core.view.WindowCompat.setDecorFitsSystemWindows(ui.activity.window,false);vm.connect(vm.state.address,"test")}
        ui.waitUntil(10000){vm.state.threads.any{it.title=="自动科研"}}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first{it.id=="t"})}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        fun inkLeft(tag:String):Float{
            val node=ui.onNodeWithTag(tag,useUnmergedTree=true)
            val pixels=node.captureToImage().toPixelMap()
            val left=(0 until pixels.width).first{x->(0 until pixels.height).any{y->val p=pixels[x,y];p.alpha>0.8f&&maxOf(p.red,p.green,p.blue)<0.7f}}
            return node.fetchSemanticsNode().boundsInRoot.left+left
        }
        Assert.assertTrue("标题与工作区的可见字形左边缘应对齐",kotlin.math.abs(inkLeft("conversationTitle")-inkLeft("conversationWorkspace"))<=1f)
        screenshot("native-header-298.png")
        ui.onNodeWithTag("connectionStatus").performClick()
        ui.onNodeWithContentDescription("关闭").assertIsDisplayed()
    }

    @Test fun lastMessageEditReplacesItsTurnAndKeepsTheComposerDraft(){
        historyStatus="completed"
        history="""[{"type":"turn.started","threadId":"t","turnId":"prior","eventId":"prior-start"},{"type":"user.message","threadId":"t","turnId":"prior","eventId":"prior-user","text":"上一条保留"},{"type":"turn.completed","threadId":"t","turnId":"prior","eventId":"prior-end","status":"completed"},{"type":"turn.started","threadId":"t","turnId":"last","eventId":"last-start"},{"type":"user.message","threadId":"t","turnId":"last","eventId":"last-user","text":"最后一条原文"},{"type":"turn.completed","threadId":"t","turnId":"last","eventId":"last-end","status":"completed"}]"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"));vm.draft("原草稿保留")}
        ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.events.any{it.eventId=="last-user"}}
        ui.onAllNodesWithTag("editLastMessage").assertCountEquals(0)
        ui.onNodeWithText("最后一条原文").performTouchInput{longClick()}
        ui.onNodeWithText("编辑",useUnmergedTree=true).performClick()
        val editor=ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("messageEditText")),useUnmergedTree=true)
        editor.performTextClearance();editor.performTextInput("取消的修改")
        ui.onNodeWithText("取消",useUnmergedTree=true).performClick()
        Assert.assertTrue(requests.isEmpty());Assert.assertEquals("原草稿保留",vm.state.draft)
        ui.onNodeWithText("最后一条原文").performTouchInput{longClick()}
        ui.onNodeWithText("编辑",useUnmergedTree=true).performClick()
        editor.performTextClearance();editor.performTextInput("修改后新文")
        ui.onNodeWithTag("messageEditSave").performClick()
        ui.waitUntil(10000){requests.any{it.optString("replaceTurnId")=="last"}&&!vm.state.sending&&vm.state.events.any{it.text=="修改后新文"}}
        Assert.assertEquals("修改后新文",requests.single{it.optString("replaceTurnId")=="last"}.getString("text"))
        Assert.assertEquals("原草稿保留",vm.state.draft)
        Assert.assertTrue(vm.state.events.none{it.text=="最后一条原文"})
        Assert.assertEquals(1,vm.state.events.count{it.type=="user.message"&&it.text=="修改后新文"})
        Assert.assertTrue(vm.state.events.any{it.text=="上一条保留"})
        screenshot("native-last-message-edit-320.png")
    }

    @Test fun currentCompletionIsSilentAndBackgroundCompletionIsTransientAndDeduplicated(){
        historyStatus="completed"
        ui.runOnUiThread{vm.openThread(ThreadRecord("t",title="本轮完成提示"))}
        ui.waitUntil(10000){!vm.state.loadingHistory&&chatSockets.isNotEmpty()}
        var source="t"
        fun event(type:String,id:String,replayed:Boolean=false)=JSONObject().put("type",type).put("threadId",source).put("eventId",id).put("status","completed").put("replayed",replayed).toString()
        chatSockets.last().send(event("turn.started","notice-start"))
        chatSockets.last().send(JSONObject(event("message.delta","notice-body")).put("text","本轮已经完成，结果保留在会话里。").toString())
        chatSockets.last().send(event("turn.completed","notice-end"))
        ui.waitUntil(5000){vm.state.events.any{it.eventId=="notice-end"}}
        Assert.assertNull(vm.state.taskNotice)
        ui.onNodeWithTag("taskCompletionNotice").assertDoesNotExist()
        source="background"
        chatSockets.last().send(event("turn.started","background-start"))
        chatSockets.last().send(event("turn.completed","background-end"))
        ui.waitUntil(5000){vm.state.taskNotice?.key=="background-end"}
        ui.onNodeWithTag("taskCompletionNotice").assertIsDisplayed()
        chatSockets.last().send(event("turn.completed","notice-end-duplicate"))
        ui.runOnUiThread{Assert.assertEquals("background-end",vm.state.taskNotice?.key)}
        ui.onNodeWithContentDescription("关闭完成提示").performClick()
        chatSockets.last().send(event("turn.completed","notice-replayed",true))
        ui.waitForIdle();Assert.assertNull(vm.state.taskNotice)
        chatSockets.last().send(event("turn.started","notice-next"))
        chatSockets.last().send(event("turn.completed","notice-next-end"))
        ui.waitUntil(5000){vm.state.taskNotice?.key=="notice-next-end"}
        ui.waitUntil(6500){vm.state.taskNotice==null}
        ui.onNodeWithTag("taskCompletionNotice").assertDoesNotExist()
    }

    @Test fun newConversationGroupsWorkspaceWithComposerAndKeepsItsDraft(){
        ui.runOnUiThread{androidx.core.view.WindowCompat.setDecorFitsSystemWindows(ui.activity.window,false);vm.newThread();vm.draft("准备新的任务")}
        ui.waitForIdle()
        ui.onNodeWithTag("conversationTitle").assertTextEquals("Codex")
        ui.onNodeWithTag("workspaceControl").performClick()
        ui.onNodeWithContentDescription("搜索工作区").performTextInput("Codex-mobile-control")
        ui.onNodeWithTag("workspace:p").performClick()
        ui.waitUntil(10000){vm.state.projectId=="p"}
        Assert.assertEquals("准备新的任务",vm.state.draft)
        ui.onNodeWithTag("workspaceControl").assertTextContains("Codex-mobile-control")
        val screenshot=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try{java.io.File(ui.activity.getExternalFilesDir(null),"new-conversation-296.png").outputStream().use{screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}}finally{screenshot.recycle()}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("新会话").performClick()
        ui.waitUntil(10000){vm.state.threadId.isBlank()&&vm.state.projectId=="p"}
        ui.onNodeWithTag("workspaceControl").performClick()
        ui.onNodeWithText("不选择工作区").performClick()
        ui.waitUntil(10000){vm.state.projectId.isBlank()}
        Assert.assertEquals("准备新的任务",vm.state.draft)
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun queueCancellationKeepsItsAcknowledgementAcrossAnOlderRead(){
        historyStatus="completed"
        queue="""[{"id":"cancel-one","text":"第一条待发消息","status":"queued"},{"id":"cancel-two","text":"第二条待发消息","status":"queued"}]"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.queue.size==2}
        holdOldQueueRead.set(true)
        ui.runOnUiThread{vm.retryHistory()}
        ui.waitUntil(10000){oldQueueReadStarted.count==0L}
        val first=vm.state.queue.first()
        ui.onNode(hasContentDescription("待发消息操作") and hasAnyAncestor(hasTestTag("queued:cancel-one"))).performClick()
        ui.onNodeWithText("取消发送").performClick()
        ui.waitUntil(5000){queueCancelRequests.get()==1}
        ui.onNodeWithText("处理中").assertExists()
        ui.onNode(hasContentDescription("待发消息操作") and hasAnyAncestor(hasTestTag("queued:cancel-one"))).assertIsEnabled().performClick()
        ui.onNodeWithText("复制文字").assertExists().performClick()
        ui.runOnUiThread{vm.queueAction(first,"delete")}
        Assert.assertEquals(1,queueCancelRequests.get())
        releaseQueueCancel.countDown()
        ui.waitUntil(10000){vm.state.queue.map{it.id}==listOf("cancel-two")&&!vm.state.workBusy}
        Assert.assertTrue("整批旧读取仍在等待时，队列应已经更新",vm.state.historySyncing)
        releaseOldQueueRead.countDown()
        ui.waitUntil(10000){!vm.state.historySyncing}
        Assert.assertEquals(listOf("cancel-two"),vm.state.queue.map{it.id})

        failQueueCancel=true
        ui.runOnUiThread{vm.queueAction(vm.state.queue.single(),"delete")}
        ui.waitUntil(10000){!vm.state.workBusy&&vm.queuedOperationId().isEmpty()&&vm.state.error.contains("取消暂未成功")}
        Assert.assertEquals(listOf("cancel-two"),vm.state.queue.map{it.id})
        failQueueCancel=false;failHistoryQueue=true
        ui.runOnUiThread{vm.queueAction(vm.state.queue.single(),"delete")}
        ui.waitUntil(10000){!vm.state.workBusy&&vm.state.queue.isEmpty()&&"queue" in vm.state.historyErrors}
        Assert.assertEquals(3,queueCancelRequests.get())
        ui.onNodeWithTag("historyFeedback").assertExists()
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun historyPartsFailIndependentlyAndRetryKeepsExistingReplies(){
        historyStatus="completed";failHistoryApprovals=true;failHistoryQueue=true
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&!vm.state.loadingHistory&&vm.state.historyErrors.keys==setOf("approvals","queue")}
        Assert.assertTrue(vm.state.events.any{it.eventId=="answer"})
        ui.onNodeWithTag("historyFeedback").assertExists()
        ui.onNodeWithTag("retryHistory").assertIsEnabled()

        failHistory=true;failHistoryApprovals=false;failHistoryQueue=false
        approvalsJson="""[{"id":"partial-approval","threadId":"t","status":"pending","title":"待确认命令"}]"""
        queue="""[{"id":"partial-queue","text":"稍后执行","status":"queued"}]"""
        ui.onNodeWithTag("retryHistory").performClick()
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.historyErrors.keys==setOf("history")}
        Assert.assertTrue(vm.state.events.any{it.eventId=="answer"})
        Assert.assertEquals("partial-approval",vm.state.pendingApprovals.single().approvalId)
        Assert.assertEquals("partial-queue",vm.state.queue.single().id)

        failHistory=false
        history="""[{"type":"user.message","threadId":"t","text":"原生发送","eventId":"user"},{"type":"message.delta","threadId":"t","text":"恢复后读取的回复","eventId":"answer"}]"""
        ui.onNodeWithTag("retryHistory").performClick()
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.historyErrors.isEmpty()&&vm.state.events.any{it.text=="恢复后读取的回复"}}
        ui.onNodeWithTag("historyFeedback").assertDoesNotExist()
        Assert.assertTrue(requests.none{it.optString("type") in setOf("chat.send","turn.start","message.send")})
    }

    @Test fun headerDetailsOpenThroughTouchAfterLoadingAndMenuClose(){
        historyStatus="completed"
        ui.onNodeWithTag("connectionStatus").assertExists()
        ui.onNodeWithTag("statusComputer",useUnmergedTree=true).assertExists()
        ui.onNodeWithTag("statusContextRing",useUnmergedTree=true).assertDoesNotExist()
        ui.onNodeWithTag("connectionStatus").performTouchInput{click()}
        ui.onNodeWithText("连接状态").assertIsDisplayed()
        ui.onNodeWithTag("sessionConnectionSection").assertExists()
        ui.onNodeWithTag("sessionContextSection").assertDoesNotExist()
        ui.onNodeWithContentDescription("关闭").performTouchInput{click()}

        val id="01a07e7c-8f28-7a53-9825-0152b461a685"
        usageDelayMs=1500
        ui.runOnUiThread{vm.openThread(ThreadRecord(id,title="Codex控制台",projectPath="F:/Code/Codex-mobile-control"))}
        ui.waitUntil(10000){vm.state.usageLoading}
        ui.onNodeWithTag("statusComputer",useUnmergedTree=true).assertExists()
        ui.waitUntil(10000){!vm.state.usageLoading&&vm.state.usage!=null}
        ui.onNodeWithTag("statusContextRing",useUnmergedTree=true).assertExists()
        ui.onNodeWithTag("statusComputer",useUnmergedTree=true).assertDoesNotExist()
        ui.onAllNodesWithTag("connectionStatus").assertCountEquals(1)
        usageDelayMs=0
        ui.onNodeWithTag("connectionStatus").performTouchInput{click()}
        ui.onNodeWithTag("sheetPanel").assertIsDisplayed()
        ui.onNodeWithText("会话状态").assertIsDisplayed()
        ui.onNodeWithTag("sessionContextSection").assertExists()
        ui.onNodeWithTag("sessionConnectionSection").assertDoesNotExist()
        ui.onNodeWithTag("usageToken:input").assertIsDisplayed()
        ui.onNodeWithTag("usageToken:cached").assertIsDisplayed()
        ui.onNodeWithTag("usageToken:hit").assertTextEquals("50.0%")
        ui.onNodeWithTag("usageToken:total").assertTextEquals("1.2万").assertIsDisplayed()
        screenshot("native-session-usage-333.png")
        ui.onNodeWithTag("sessionDetailsToggle").performScrollTo().performClick()
        ui.mainClock.advanceTimeBy(400)
        ui.waitForIdle()
        ui.onNodeWithTag("sessionContextId",useUnmergedTree=true).performScrollTo().assertIsDisplayed().assertTextEquals(id)
        val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
        ui.onNodeWithTag("sessionContextId",useUnmergedTree=true).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult){it(layouts)}
        Assert.assertEquals(1,layouts.single().lineCount)
        val bounds=ui.onNodeWithTag("sessionContextId",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
        val label=ui.onNodeWithTag("sessionContextIdLabel",useUnmergedTree=true).assertTextEquals("ID").fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("ID 标签与编号应在同一行",kotlin.math.abs(label.center.y-bounds.center.y)<=1f&&label.right<=bounds.left+1f)
        screenshot("native-session-status-319.png")
        Assert.assertTrue("UUID 最后一位应完整显示：text=${layouts.single().getLineRight(0)}, visible=${bounds.width}",layouts.single().getLineRight(0)<=bounds.width+1f)
        ui.onNodeWithText("连接",useUnmergedTree=true).performScrollTo().performClick()
        ui.onNodeWithTag("sessionContextSection").assertDoesNotExist()
        ui.onNodeWithTag("sessionConnectionSection").assertIsDisplayed()
        ui.onNodeWithTag("connectionDetails").assertDoesNotExist()
        ui.onNodeWithText("Clash · OpenAI 节点").performScrollTo().assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performTouchInput{click()}
        ui.onNodeWithTag("sheetPanel").assertDoesNotExist()
        ui.onNodeWithContentDescription("会话菜单").performTouchInput{click()}
        ui.onNodeWithText("上下文与连接").performTouchInput{click()}
        ui.onNodeWithText("会话状态").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performTouchInput{click()}
        ui.onNodeWithContentDescription("会话菜单").performTouchInput{click()}
        ui.onNodeWithText("设置").performClick()
        ui.onNodeWithTag("settings:quota").performClick()
        ui.onAllNodesWithText("账号额度").onFirst().assertIsDisplayed()
        ui.onNodeWithContentDescription("返回").performClick()
        ui.onNodeWithContentDescription("返回").performClick()
        ui.runOnUiThread{vm.disconnect()}
        ui.onNodeWithTag("statusContextRing",useUnmergedTree=true).assertDoesNotExist()
        val icon=ui.onNodeWithTag("statusComputer",useUnmergedTree=true).captureToImage().toPixelMap()
        Assert.assertTrue("断开后电脑图标应变红",(0 until icon.width).any{x->(0 until icon.height).any{y->val p=icon[x,y];p.alpha>0.5f&&p.red>p.green*1.3f&&p.red>p.blue*1.3f}})
    }

    @Test fun slowHistoryDoesNotTriggerNetworkErrorAndSwitchCancelsRead(){
        historyStatus="completed";historyDelayMs=11000
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(18000){!vm.state.loadingHistory&&vm.state.events.any{it.eventId=="answer"}}
        Assert.assertFalse("记录超过旧 10 秒时限仍应读回", "history" in vm.state.historyErrors)
        historyDelayMs=30000
        ui.runOnUiThread{vm.retryHistory()}
        ui.waitUntil(3000){vm.state.historySyncing}
        historyDelayMs=0
        ui.runOnUiThread{vm.openThread(ThreadRecord("other"))}
        ui.waitUntil(5000){!vm.state.historySyncing&&!vm.state.loadingHistory}
        Assert.assertEquals("other",vm.state.threadId)
        Assert.assertTrue(vm.state.historyErrors.isEmpty())
    }

    @Test fun missingSocketConfirmationUsesSubmissionReceiptWithoutResending(){
        historyStatus="completed";dropAcknowledgement=true;submissionState="accepted"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running&&chatSockets.isNotEmpty()}
        ui.runOnUiThread{vm.draft("确认不能丢失");vm.send()}
        ui.waitUntil(20000){requests.any{it.optString("text")=="确认不能丢失"}&&!vm.state.sending}
        Assert.assertEquals(1,requests.count{it.optString("text")=="确认不能丢失"})
        Assert.assertTrue(vm.failedMessages().isEmpty())
        Assert.assertTrue(ApplicationProvider.getApplicationContext<Application>().getSharedPreferences("native",0).all.keys.none{it.startsWith("send:")})
    }

    @Test fun timedOutSendKeepsOriginalAndNewDraftAndSurvivesViewModelRecreation(){
        historyStatus="completed";dropAcknowledgement=true;submissionState="failed"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running&&chatSockets.isNotEmpty()}
        ui.runOnUiThread{vm.draft("超时也保留原文");vm.send();vm.draft("发送后新写的草稿")}
        ui.waitUntil(20000){vm.failedMessages().any{it.text=="超时也保留原文"}&&!vm.state.sending}
        Assert.assertEquals("发送后新写的草稿",vm.state.draft)
        Assert.assertTrue(vm.failedMessages().single().detail.contains("请求超时"))
        ui.onNodeWithTag("failedSend").assertExists()
        ui.runOnUiThread{
            val restored=NativeViewModel(ApplicationProvider.getApplicationContext())
            restored.openThread(ThreadRecord("t"))
            Assert.assertEquals("超时也保留原文",restored.failedMessages().single().text)
            Assert.assertEquals("发送后新写的草稿",restored.state.draft)
            restored.disconnect()
        }
    }

    @Test fun retryChecksLateAcceptanceAndDoesNotSendTheMessageAgain(){
        historyStatus="completed";dropAcknowledgement=true;submissionState="unknown"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running&&chatSockets.isNotEmpty()}
        ui.runOnUiThread{vm.draft("网络断开后的确认");vm.send()}
        ui.waitUntil(20000){vm.failedMessages().isNotEmpty()&&!vm.state.sending}
        val id=vm.failedMessages().single().requestId
        submissionState="accepted"
        ui.runOnUiThread{vm.retryFailedMessage(id)}
        ui.waitUntil(10000){!vm.state.sending&&vm.failedMessages().isEmpty()}
        Assert.assertEquals(1,requests.count{it.optString("text")=="网络断开后的确认"})
        Assert.assertEquals("",vm.state.draft)
    }

    @Test fun completedOperationsLoadCategoriesThenBodiesAndReuseBothAcrossPolling(){
        historyStatus="completed"
        history="""[{"type":"user.message","threadId":"t","eventId":"u-lazy","text":"按需查看命令"},{"type":"tool.completed","threadId":"t","eventId":"lazy-tool","itemId":"operation","detailsDeferred":true,"activityGroupId":"lazy-group","activitySummary":"处理过程 · 1 项操作","activityCount":1},{"type":"message.delta","threadId":"t","eventId":"a-lazy","text":"处理完成"},{"type":"turn.completed","threadId":"t","eventId":"done-lazy"}]"""
        activityMetadata="""[{"type":"tool.completed","threadId":"t","eventId":"lazy-tool","itemId":"operation","title":"运行命令","detailsDeferred":true}]"""
        activityBody="""[{"type":"tool.completed","threadId":"t","eventId":"lazy-tool","itemId":"operation","title":"运行命令","command":"echo deferred-body","text":"deferred-body"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        Assert.assertTrue(activityQueries.isEmpty())
        ui.onNode(hasContentDescription("展开详情") or hasContentDescription("收起详情")).performClick()
        Assert.assertTrue(activityQueries.isEmpty())
        ui.onNodeWithTag("activityGroupHeader").performClick()
        ui.waitUntil(10000){activityQueries.size==1&&!vm.state.events.any{it.activityGroupId.isNotBlank()}}
        Assert.assertTrue(activityQueries.single().contains("groupId="))
        Assert.assertTrue(vm.state.events.none{it.command.contains("deferred-body")})
        ui.onNodeWithTag("activityDetail").onChildren().onFirst().performClick()
        ui.waitUntil(10000){vm.state.events.any{it.command=="echo deferred-body"}}
        Assert.assertEquals(2,activityQueries.size)
        ui.waitUntil(10000){historyCounts.size>=2&&!vm.state.loadingHistory}
        Assert.assertEquals(2,activityQueries.size)
        Assert.assertTrue(vm.state.events.any{it.command=="echo deferred-body"})
    }

    @Test fun switchingConversationsCancelsActivityReadsAndKeepsReplacementLoading(){
        historyStatus="completed"
        history="""[{"type":"tool.completed","threadId":"t","eventId":"lazy-tool","itemId":"operation","title":"运行命令","detailsDeferred":true},{"type":"message.delta","threadId":"t","eventId":"activity-final","text":"完成"},{"type":"turn.completed","threadId":"t","eventId":"activity-end"}]"""
        activityBody="""[{"type":"tool.completed","threadId":"t","eventId":"lazy-tool","itemId":"operation","title":"运行命令","command":"echo replacement-body","text":"replacement-body"}]"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.events.any{it.eventId=="lazy-tool"}}
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as okhttp3.OkHttpClient
        stalledActivityThread="t"
        ui.runOnUiThread{
            vm.loadActivityGroups(listOf(ChatEvent(type="tool.completed",threadId="t",activityGroupId="cancel-group")))
            vm.loadActivityDetails("t",listOf("lazy-tool"))
        }
        var oldCalls=emptyList<okhttp3.Call>()
        ui.waitUntil(5000){
            oldCalls=transport.dispatcher.runningCalls().filter{it.request().url.encodedPath=="/api/threads/t/activity"&&!it.isCanceled()}
            oldCalls.size==2&&activityQueries.size==2
        }
        ui.runOnUiThread{
            vm.openThread(ThreadRecord("activity-away"));vm.openThread(ThreadRecord("t"))
            vm.loadActivityDetails("t",listOf("lazy-tool"))
        }
        ui.waitUntil(5000){oldCalls.all{it.isCanceled()}&&activityQueries.size==3}
        ui.waitForIdle()
        Assert.assertEquals(setOf("lazy-tool"),vm.state.activityLoading)
        val replacement=transport.dispatcher.runningCalls().single{it.request().url.encodedPath=="/api/threads/t/activity"&&!it.isCanceled()}
        ui.runOnUiThread{vm.newThread()}
        ui.waitUntil(5000){replacement.isCanceled()&&vm.state.activityLoading.isEmpty()}
        stalledActivityThread=""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing}
        ui.runOnUiThread{vm.loadActivityDetails("t",listOf("lazy-tool"))}
        ui.waitUntil(5000){vm.state.events.any{it.command=="echo replacement-body"}&&vm.state.activityLoading.isEmpty()}
        Assert.assertEquals(4,activityQueries.size)
        Assert.assertTrue(vm.state.activityErrors.isEmpty())
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun expandedOperationGroupRestartsAfterImmediateConversationReturn(){
        historyStatus="completed"
        history="""[{"type":"user.message","threadId":"t","eventId":"u-resume","text":"恢复展开操作"},{"type":"tool.completed","threadId":"t","eventId":"resume-tool","itemId":"operation","detailsDeferred":true,"activityGroupId":"resume-group","activitySummary":"处理过程 · 1 项操作","activityCount":1},{"type":"message.delta","threadId":"t","eventId":"resume-final","text":"完成"},{"type":"turn.completed","threadId":"t","eventId":"resume-end"}]"""
        activityMetadata="""[{"type":"tool.completed","threadId":"t","eventId":"resume-tool","itemId":"operation","title":"运行命令","detailsDeferred":true}]"""
        activityBody="""[{"type":"tool.completed","threadId":"t","eventId":"resume-tool","itemId":"operation","title":"运行命令","command":"echo resumed-body","text":"resumed-body"}]"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as okhttp3.OkHttpClient
        stalledActivityThread="t"
        ui.onNode(hasContentDescription("展开详情") or hasContentDescription("收起详情")).performClick()
        ui.onNodeWithTag("activityGroupHeader").performClick()
        ui.waitUntil(5000){activityQueries.size==1}
        val oldCall=transport.dispatcher.runningCalls().single{it.request().url.encodedPath=="/api/threads/t/activity"&&!it.isCanceled()}
        stalledActivityThread=""
        ui.runOnUiThread{vm.openThread(ThreadRecord("resume-away"));vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(8000){oldCall.isCanceled()&&activityQueries.size==2&&vm.state.events.none{it.activityGroupId.isNotBlank()}}
        // The restored disclosure restarts metadata only; opening the row requests its body.
        ui.onNodeWithTag("activityDetail").onChildren().onFirst().performClick()
        ui.waitUntil(5000){vm.state.events.any{it.command=="echo resumed-body"}}
        Assert.assertEquals(3,activityQueries.size)
        Assert.assertTrue(vm.state.activityErrors.isEmpty())
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun selectedFileRestartsAfterImmediateConversationReturn(){
        historyStatus="completed"
        history="""[{"type":"tool.completed","threadId":"t","eventId":"file-a","itemId":"edit-a","detailsDeferred":true,"activityGroupId":"files-a","fileChanges":[{"path":"a.kt","added":1,"removed":1}]},{"type":"message.delta","threadId":"t","eventId":"file-progress","text":"继续修改"},{"type":"tool.completed","threadId":"t","eventId":"file-b","itemId":"edit-b","detailsDeferred":true,"activityGroupId":"files-b","fileChanges":[{"path":"b.kt","added":2,"removed":0}]},{"type":"message.delta","threadId":"t","eventId":"file-final","text":"完成"},{"type":"turn.completed","threadId":"t","eventId":"file-end"}]"""
        activityMetadata="""[{"type":"tool.completed","threadId":"t","eventId":"file-a","itemId":"edit-a","fileChanges":[{"path":"a.kt","added":1,"removed":1}]},{"type":"file.changed","threadId":"t","eventId":"patch-a","itemId":"edit-a","detailsDeferred":true,"files":["a.kt"],"fileChanges":[{"path":"a.kt","added":1,"removed":1}]}]"""
        activityBody="""[{"type":"file.changed","threadId":"t","eventId":"patch-a","itemId":"edit-a","files":["a.kt"],"diff":"--- a/a.kt\n+++ b/a.kt\n@@ -1 +1 @@\n-old\n+new"}]"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as okhttp3.OkHttpClient
        stalledActivityThread="t"
        ui.onNodeWithText("已更改 2 个文件  +3 −1").performClick()
        ui.onNodeWithText("a.kt").performClick()
        ui.waitUntil(5000){activityQueries.size==1}
        val oldCall=transport.dispatcher.runningCalls().single{it.request().url.encodedPath=="/api/threads/t/activity"&&!it.isCanceled()}
        stalledActivityThread=""
        ui.runOnUiThread{vm.openThread(ThreadRecord("file-away"));vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(8000){oldCall.isCanceled()&&vm.state.events.any{it.diff.contains("+new")}}
        ui.onNodeWithTag("changeDetail").assertIsDisplayed()
        Assert.assertEquals(3,activityQueries.size)
        Assert.assertTrue(activityQueries.none{it.contains("files-b")||it.contains("file-b")})
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun fileDetailRetriesEmptyAndFailedReadsWithoutLosingItsRecordedPatch(){
        historyStatus="completed"
        history="""[{"type":"file.changed","threadId":"t","eventId":"kept-a","itemId":"kept","files":["a.kt"],"diff":"--- a/a.kt\n+++ b/a.kt\n@@ -10,0 +11 @@\n+kept","fileChanges":[{"path":"a.kt","added":1,"removed":0}]},{"type":"tool.completed","threadId":"t","eventId":"file-a","itemId":"edit-a","detailsDeferred":true,"activityGroupId":"files-a","fileChanges":[{"path":"a.kt","added":1,"removed":1}]},{"type":"tool.completed","threadId":"t","eventId":"file-b","itemId":"edit-b","detailsDeferred":true,"activityGroupId":"files-b","fileChanges":[{"path":"b.kt","added":2,"removed":0}]},{"type":"message.delta","threadId":"t","eventId":"feedback-final","text":"完成"},{"type":"turn.completed","threadId":"t","eventId":"feedback-end"}]"""
        activityMetadata="""[{"type":"tool.completed","threadId":"t","eventId":"file-a","itemId":"edit-a","fileChanges":[{"path":"a.kt","added":1,"removed":1}]},{"type":"file.changed","threadId":"t","eventId":"patch-a","itemId":"edit-a","detailsDeferred":true,"files":["a.kt"],"fileChanges":[{"path":"a.kt","added":1,"removed":1}]}]"""
        activityBody="""[{"type":"file.changed","threadId":"t","eventId":"patch-a","itemId":"edit-a","files":["a.kt"],"diff":"--- a/a.kt\n+++ b/a.kt\n@@ -1 +1 @@\n-old\n+new"}]"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithText("已更改 2 个文件  +3 −1").performClick()
        ui.onNodeWithText("a.kt").performClick()
        ui.waitUntil(5000){vm.state.activityErrors.containsKey("files-a")}
        ui.onNodeWithText("改动详情读取失败").assertIsDisplayed()
        ui.onNodeWithTag("changeLoading").assertDoesNotExist()
        ui.onNodeWithText("+kept").assertIsDisplayed()
        ui.onNodeWithText("复制补丁").assertIsEnabled()
        ui.onNodeWithTag("changeRetry").performClick()
        ui.waitUntil(5000){activityQueries.size==3&&vm.state.activityErrors.containsKey("patch-a")}
        ui.onNodeWithTag("changeLoading").assertDoesNotExist()
        ui.onNodeWithText("+kept").assertIsDisplayed()
        ui.onNodeWithTag("changeRetry").performClick()
        ui.waitUntil(5000){vm.state.activityErrors["patch-a"]?.contains("补丁暂不可用")==true}
        ui.onNodeWithText("补丁暂不可用",substring=true).assertIsDisplayed()
        ui.onNodeWithText("+kept").assertIsDisplayed()
        ui.onNodeWithTag("changeRetry").performClick()
        ui.waitUntil(5000){vm.state.events.any{it.diff.contains("+new")}&&vm.state.activityLoading.isEmpty()}
        ui.onNodeWithTag("changeDetail").assertIsDisplayed()
        ui.onNodeWithText("+kept").assertIsDisplayed();ui.onNodeWithText("+new").assertIsDisplayed()
        ui.onNodeWithTag("changeFeedback").assertDoesNotExist()
        Assert.assertEquals(5,activityQueries.size)
        Assert.assertTrue(activityQueries.none{it.contains("files-b")||it.contains("file-b")})
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun fileChangeSummaryLoadsOnlySelectedFileBody(){
        historyStatus="completed"
        history="""[{"type":"tool.completed","threadId":"t","eventId":"file-a","itemId":"edit-a","detailsDeferred":true,"activityGroupId":"files-a","fileChanges":[{"path":"a.kt","added":1,"removed":1}]},{"type":"message.delta","threadId":"t","eventId":"progress-files","itemId":"progress","text":"继续修改"},{"type":"tool.completed","threadId":"t","eventId":"file-b","itemId":"edit-b","detailsDeferred":true,"activityGroupId":"files-b","fileChanges":[{"path":"b.kt","added":2,"removed":0}]},{"type":"message.delta","threadId":"t","eventId":"final-files","itemId":"final","text":"修改完成"},{"type":"turn.completed","threadId":"t","eventId":"end-files","status":"completed"}]"""
        activityMetadata="""[{"type":"tool.completed","threadId":"t","eventId":"file-a","itemId":"edit-a","fileChanges":[{"path":"a.kt","added":1,"removed":1}]},{"type":"file.changed","threadId":"t","eventId":"patch-a","itemId":"edit-a","detailsDeferred":true,"files":["a.kt"],"fileChanges":[{"path":"a.kt","added":1,"removed":1}]}]"""
        activityBody="""[{"type":"file.changed","threadId":"t","eventId":"patch-a","itemId":"edit-a","files":["a.kt"],"diff":"--- a/a.kt\n+++ b/a.kt\n@@ -1 +1 @@\n-old\n+new"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        Assert.assertTrue(activityQueries.isEmpty())
        ui.onNodeWithText("已更改 2 个文件  +3 −1").performClick()
        Assert.assertTrue(activityQueries.isEmpty())
        ui.onNodeWithText("a.kt").performClick()
        ui.waitUntil(10000){activityQueries.size==2&&vm.state.events.any{it.diff.contains("+new")}}
        Assert.assertTrue(activityQueries.first().contains("groupId=files-a"))
        Assert.assertTrue(activityQueries.last().contains("patch-a"))
        Assert.assertTrue(activityQueries.none{it.contains("files-b")||it.contains("file-b")})
        ui.onNodeWithTag("changeDetail").assertIsDisplayed()
    }

    @Test fun workspaceFilesEntryOpensBrowser(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first().copy(projectPath="F:/Code/Codex-mobile-control"))}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("导入云端快照").assertDoesNotExist()
        ui.onNodeWithText("工作区文件").performClick()
        ui.waitUntil(10000){vm.state.files.any{it.name=="workspace-check.txt"}}
        ui.waitUntil(5000){ui.onNodeWithText("workspace-check.txt").isDisplayed()}
        ui.onNodeWithText("workspace-check.txt").assertIsDisplayed()
    }

    @Test fun workspaceFilesResolveOutsideSidebarAndRetry(){
        sidebarFixture="""{"threads":[{"id":"t","projectPath":"F:/Code/Codex-mobile-control","status":"completed"}]}"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t",projectPath="F:/Code/Codex-mobile-control"))}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.loadingSidebar}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("工作区文件").performClick()
        ui.waitUntil(10000){vm.state.fileError.isNotBlank()&&!vm.state.fileBusy}
        Assert.assertEquals(1,slowFileRequests.get())
        ui.onNode(hasText("重试") and hasAnyAncestor(hasTestTag("sheetPanel")),useUnmergedTree=true).performClick()
        ui.waitUntil(10000){vm.state.files.any{it.name=="nested"}}
        Assert.assertEquals("p",vm.state.fileProjectId)
        ui.onNodeWithTag("workspaceFile:nested").performClick()
        ui.waitUntil(10000){vm.state.filePath=="nested"&&!vm.state.fileBusy}
        ui.onNodeWithTag("workspaceFile:nested/note.txt").performClick()
        ui.waitUntil(10000){vm.state.file?.content=="工作区文件正文"}
        ui.onNodeWithTag("fileEditor").assertExists()
        ui.onNodeWithText("返回目录").performScrollTo().performClick()
        ui.waitUntil(10000){vm.state.file==null&&!vm.state.fileBusy}
        ui.onNodeWithText("上一级").performClick()
        ui.waitUntil(10000){vm.state.filePath.isEmpty()&&!vm.state.fileBusy}
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun localConsoleAgentManagementShowsStatusAndRestartEntry(){
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("设置").performClick()
        ui.onNodeWithTag("settings:agents").performClick()
        ui.waitUntil(10000){vm.agentHealth.agents.isNotEmpty()&&!vm.agentHealth.loading}
        ui.onNodeWithTag("agentHealth:codex").assertExists()
        ui.onNodeWithTag("agentRestart:codex").assertExists()
        ui.onNodeWithTag("agentHealth:hermes").assertExists()
        ui.onNodeWithText("Hermes 1.0").assertExists()
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun localConsoleBackendRestartPreviewsBeforeConfirmation(){
        ui.onNodeWithTag("connectionStatus").performClick()
        ui.onNodeWithTag("sharedBackendRestart").performClick()
        ui.waitUntil(10000){vm.state.backendRestart.planId.isNotBlank()}
        Assert.assertEquals(0,backendRestartRequests.get())
        ui.onNodeWithTag("confirmSharedBackendRestart").performClick()
        ui.waitUntil(10000){vm.state.backendRestart.done}
        Assert.assertEquals(1,backendRestartRequests.get())
        ui.onNodeWithText("共享后端已重启").assertExists()
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun localConsolePricingRefreshKeepsScroll(){
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("设置").performClick()
        ui.onNodeWithTag("settings:quota").performClick()
        ui.onNodeWithText("统计").performClick()
        ui.waitUntil(10000){vm.state.localConsole.statistics!=null&&!vm.state.localConsole.statisticsLoading}
        ui.onNodeWithText("API 计价").performScrollTo()
        fun position()=ui.onNodeWithTag("consoleScroll").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        val before=position()
        Assert.assertTrue(before>0f)
        consoleDelayMs=1800L
        ui.onNodeWithText("API 计价").performClick()
        ui.waitUntil(1000){vm.state.localConsole.statisticsLoading}
        Assert.assertNotNull(vm.state.localConsole.statistics)
        Assert.assertEquals(before,position(),1f)
        ui.waitUntil(10000){!vm.state.localConsole.statisticsLoading&&vm.state.localConsole.pricing=="api"}
        Assert.assertEquals(before,position(),1f)
        consoleDelayMs=0L
        ui.onNodeWithText("Codex 计价").performClick()
        ui.waitUntil(10000){!vm.state.localConsole.statisticsLoading&&vm.state.localConsole.pricing=="codex"}
        Assert.assertEquals(before,position(),1f)
        Assert.assertTrue(consoleQueries.contains("codex:week:api"))
        ui.onNodeWithTag("consoleDailyChart").performScrollTo().performTouchInput{down(center);advanceEventTime(100)}
        ui.onNodeWithTag("chartCallout").assertExists()
        ui.onNodeWithTag("consoleDailyChart").performTouchInput{up()}
        ui.onNodeWithTag("chartCallout").assertDoesNotExist()
    }
    @Test fun localConsoleQuotaShortcutAndUnifiedSettings(){
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("账号额度").performClick()
        ui.onNodeWithTag("sheetPanel").assertIsDisplayed()
        ui.onNodeWithTag("settingsHome").assertDoesNotExist()
        ui.waitUntil(10000){vm.state.usage!=null}
        ui.onNodeWithTag("accountQuotaCard").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.onNodeWithText("账号额度").assertIsDisplayed()
        ui.onNodeWithText("工作区文件").assertDoesNotExist()
        val quotaTop=ui.onNodeWithText("账号额度").fetchSemanticsNode().boundsInRoot.top
        val tasksTop=ui.onNodeWithText("定时任务").fetchSemanticsNode().boundsInRoot.top
        Assert.assertTrue(quotaTop<tasksTop)
        ui.onNodeWithText("定时任务").performClick()
        ui.onNodeWithTag("automationsSheetContent").assertIsDisplayed()
        ui.onNodeWithTag("automation:own").assertExists()
        ui.onNodeWithTag("automation:other").assertExists()
        ui.onNodeWithText("执行会话 · 其他目标会话").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.onNodeWithText("设置").performClick()
        ui.onNodeWithText("电脑控制台").assertDoesNotExist()
        ui.onNodeWithTag("settings:quota").performClick()
        ui.onNodeWithText("用量与额度").assertIsDisplayed()
        ui.onNodeWithTag("accountQuotaCard").assertIsDisplayed()
        ui.onNodeWithText("统计").performClick()
        ui.waitUntil(10000){vm.state.localConsole.statistics!=null}
        ui.onNodeWithText("Token 总量 · 12 条计量记录").assertExists()
        ui.onNodeWithTag("consoleScroll").performTouchInput{swipeUp()}
        val statisticsPosition=ui.onNodeWithTag("consoleScroll").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        Assert.assertTrue(statisticsPosition>0f)
        ui.onNodeWithText("额度").performClick()
        ui.onNodeWithTag("accountQuotaCard").assertIsDisplayed()
        ui.onNodeWithText("统计").performClick()
        val restoredPosition=ui.onNodeWithTag("consoleScroll").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        Assert.assertEquals(statisticsPosition,restoredPosition,1f)
    }

    @Test fun sessionAutomationEntryFiltersAndOpensEditor(){
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("本会话定时任务").performClick()
        ui.waitUntil(10000){!vm.state.automationsLoading&&vm.state.automations.size==2}
        ui.onNodeWithTag("automationsSheetContent").assertIsDisplayed()
        ui.onNodeWithTag("automation:own").assertIsDisplayed()
        ui.onNodeWithTag("automation:other").assertDoesNotExist()
        ui.onNodeWithTag("automation:own").performClick()
        ui.onNodeWithTag("automationEditor").assertIsDisplayed()
        ui.onNodeWithTag("automationTarget:own").assertIsDisplayed()
        ui.onNodeWithContentDescription("返回任务列表").performClick()
        ui.onNodeWithContentDescription("新建定时任务").performClick()
        ui.onNodeWithTag("automationEditor").assertIsDisplayed()
        ui.onNodeWithTag("automationTarget:new").assertIsDisplayed()
        ui.onNodeWithContentDescription("返回任务列表").performClick()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.onNodeWithTag("settingsHome").assertDoesNotExist()
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun usagePeriodKeepsDataAndPageBoundsDuringDelayedRefresh(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first());vm.loadUsage()}
        ui.waitUntil(10000){vm.state.usage!=null&&!vm.state.usageLoading}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("设置").performClick();ui.onNodeWithTag("settings:quota").performClick()
        ui.waitForIdle()
        val before=ui.onNodeWithTag("accountQuotaCard").fetchSemanticsNode().boundsInRoot
        val trendBefore=ui.onNodeWithTag("quota-trend").fetchSemanticsNode().boundsInRoot
        val original=vm.state.usage
        usageDelayMs=1800
        ui.onNodeWithText("近 7 天").performClick()
        ui.waitUntil(5000){vm.state.usageLoading}
        Assert.assertSame(original,vm.state.usage)
        ui.onNodeWithTag("quotaRefreshing").assertExists()
        val heading=ui.onNodeWithTag("accountQuotaHeading").fetchSemanticsNode().boundsInRoot
        val indicator=ui.onNodeWithTag("quotaRefreshing").fetchSemanticsNode().boundsInRoot
        Assert.assertTrue(indicator.left>heading.right&&indicator.left-heading.right<24*ui.activity.resources.displayMetrics.density)
        Assert.assertEquals(heading.center.y,indicator.center.y,1f)
        val waiting=ui.onNodeWithTag("accountQuotaCard").fetchSemanticsNode().boundsInRoot
        Assert.assertEquals(before,waiting)
        Assert.assertEquals(trendBefore,ui.onNodeWithTag("quota-trend").fetchSemanticsNode().boundsInRoot)
        ui.waitUntil(10000){!vm.state.usageLoading&&vm.state.usageDataDays==7}
        Assert.assertEquals(before,ui.onNodeWithTag("accountQuotaCard").fetchSemanticsNode().boundsInRoot)
        Assert.assertEquals(trendBefore,ui.onNodeWithTag("quota-trend").fetchSemanticsNode().boundsInRoot)
        ui.onNodeWithTag("quotaRefreshing").assertDoesNotExist()
    }

    @Test fun usageRefreshFollowsTheModelSelectedDuringAnInFlightRead(){
        historyStatus="completed";consoleNewModel=true
        ui.runOnUiThread{vm.refreshBackends(force=true)}
        ui.waitUntil(10000){vm.state.models.any{it.id=="new-model"}}
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&!vm.state.usageLoading&&vm.state.usage?.optString("requestedModel")=="test"}
        val original=vm.state.usage;val before=usageQueries.size
        usageDelayMs=1400
        ui.runOnUiThread{vm.loadUsage(7)}
        ui.waitUntil(5000){usageQueries.size>before&&vm.state.usageLoading}
        Assert.assertSame(original,vm.state.usage)
        usageDelayMs=0
        ui.runOnUiThread{vm.chooseModel("new-model")}
        ui.waitUntil(8000){!vm.state.usageLoading&&vm.state.usage?.optString("requestedModel")=="new-model"}
        Assert.assertEquals(7,vm.state.usageDataDays)
        Assert.assertTrue(vm.state.usageError.isBlank())
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun switchingConversationsCancelsTheStalledUsageCall(){
        historyStatus="completed"
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&!vm.state.usageLoading&&vm.state.usage!=null}
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as okhttp3.OkHttpClient
        stalledUsageThread="t"
        ui.runOnUiThread{vm.loadUsage()}
        var oldUsage:okhttp3.Call?=null
        ui.waitUntil(5000){
            oldUsage=transport.dispatcher.runningCalls().firstOrNull{it.request().url.encodedPath=="/api/usage"&&it.request().url.queryParameter("threadId")=="t"&&!it.isCanceled()}
            oldUsage!=null&&vm.state.usageLoading
        }
        ui.runOnUiThread{vm.openThread(ThreadRecord("usage-next"))}
        ui.waitUntil(8000){oldUsage!!.isCanceled()&&vm.state.threadId=="usage-next"&&!vm.state.historySyncing&&!vm.state.usageLoading&&vm.state.usage!=null}
        Assert.assertTrue(vm.state.connected)
        Assert.assertTrue(vm.state.usageError.isBlank())
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun modelQuotaAndCapacityFailuresShowDismissibleInPageNotices(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&chatSockets.isNotEmpty()}
        ui.onNodeWithTag("composer").performTextInput("保留这条草稿")
        fun push(type:String,id:String,message:String="",status:String="",replayed:Boolean=false){
            Assert.assertTrue(chatSockets.last().send(JSONObject().put("type",type).put("eventId",id).put("threadId","t").put("message",message).put("status",status).put("replayed",replayed).toString()))
        }
        historyStatus="error"
        push("turn.completed","quota-completed",status="error")
        push("error","quota-error","You've hit your usage limit. Try again later.")
        ui.waitUntil(10000){vm.state.modelServiceNotice?.kind=="quota"}
        ui.onNodeWithText("额度已用完").assertIsDisplayed()
        screenshot("native-quota-notice.png")
        ui.onNodeWithContentDescription("关闭模型提醒").performClick()
        push("error","quota-duplicate","usage_limit_reached")
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="quota-duplicate"}}
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
        push("turn.started","next-start")
        push("error","capacity-error","UNAVAILABLE (code 503): No capacity available")
        push("turn.completed","capacity-completed",status="error")
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="capacity-completed"}&&vm.state.modelServiceNotice?.kind=="capacity"}
        ui.onNodeWithText("模型暂时没有可用容量").assertIsDisplayed()
        ui.onNodeWithText("请稍后重试，或切换其他模型。").assertIsDisplayed()
        ui.onNodeWithTag("composer").performTextInput("，还能继续编辑")
        Assert.assertEquals("保留这条草稿，还能继续编辑",vm.state.draft)
        screenshot("native-capacity-notice.png")
        ui.onNodeWithContentDescription("关闭模型提醒").performClick()
        push("error","old-error","No capacity available",replayed=true)
        push("message.delta","barrier","继续")
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="barrier"}}
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
    }

    @Test fun freshZeroQuotaShowsResetTimeButStaleQuotaDoesNotWarn(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        quotaFixture="""{"quota":{"stale":true,"windows":[{"name":"Codex","durationMins":300,"remainingPercent":0,"resetsAt":1900000000}]}}"""
        ui.runOnUiThread{vm.loadUsage()}
        ui.waitUntil(10000){!vm.state.usageLoading}
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
        quotaFixture=quotaFixture.replace("true","false")
        ui.runOnUiThread{vm.loadUsage()}
        ui.waitUntil(10000){vm.state.modelServiceNotice?.kind=="quota"}
        ui.onNodeWithText("额度已用完").assertIsDisplayed()
        Assert.assertTrue(vm.state.modelServiceNotice!!.message.contains("预计"))
        screenshot("native-quota-reset-notice.png")
        ui.onNodeWithContentDescription("关闭模型提醒").performClick()
        ui.runOnUiThread{vm.loadUsage()}
        ui.waitUntil(10000){!vm.state.usageLoading}
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
    }

    @Test fun tenPercentQuotaWarnsUpdatesAndUpgradesWithoutRepeatedNotices(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        fun load(remaining:String){
            quotaFixture="""{"quota":{"stale":false,"windows":[{"name":"Codex","durationMins":300,"remainingPercent":$remaining,"resetsAt":1900000000}]}}"""
            ui.runOnUiThread{vm.loadUsage()}
            ui.waitUntil(10000){!vm.state.usageLoading}
        }
        load("10.1")
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
        load("10")
        ui.onNodeWithText("额度剩余不多").assertIsDisplayed()
        Assert.assertTrue(vm.state.modelServiceNotice!!.message.contains("10%"))
        screenshot("native-low-quota-notice.png")
        load("5")
        Assert.assertTrue(vm.state.modelServiceNotice!!.message.contains("5%"))
        ui.onNodeWithContentDescription("关闭模型提醒").performClick()
        load("4")
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
        load("0")
        ui.onNodeWithText("额度已用完").assertIsDisplayed()
        load("50")
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
        load("9")
        ui.onNodeWithText("额度剩余不多").assertIsDisplayed()
    }

    @Test fun stopWaitsForConfirmationAndCannotBeSentTwice(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.running&&!vm.state.loadingHistory}
        ui.onNodeWithContentDescription("停止任务").performClick()
        ui.onNodeWithContentDescription("正在停止任务").assertIsNotEnabled()
        ui.onNodeWithText("正在停止，等待电脑确认…").assertIsDisplayed()
        ui.runOnUiThread{vm.stop()}
        ui.waitUntil(5000){requests.count{it.optString("type")=="turn.interrupt"}==1}
        screenshot("native-stop-pending.png")
        releaseInterrupt.countDown()
        ui.waitUntil(10000){!vm.state.running&&!vm.state.stopping}
        ui.onNodeWithContentDescription("停止任务").assertDoesNotExist()
        ui.onNodeWithContentDescription("发送消息").assertIsNotEnabled()
        Assert.assertTrue(vm.state.events.any{it.type=="turn.completed"})
    }

    @Test fun stopFailureDoesNotPretendTheTurnStopped(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.running&&!vm.state.loadingHistory}
        ui.onNodeWithContentDescription("停止任务").performClick()
        ui.waitUntil(10000){vm.state.stopError.isNotBlank()&&!vm.state.stopping}
        Assert.assertTrue(vm.state.running)
        ui.onNodeWithText("电脑暂时无法停止任务").assertIsDisplayed()
        ui.onNodeWithContentDescription("停止任务").performClick()
        ui.waitUntil(10000){!vm.state.running&&!vm.state.stopping}
        Assert.assertEquals(2,requests.count{it.optString("type")=="turn.interrupt"})
    }

    @Test fun stopTimeoutReportsUnconfirmedAndAllowsRetry(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.running&&!vm.state.loadingHistory}
        ui.onNodeWithContentDescription("停止任务").performClick()
        ui.waitUntil(16000){vm.state.stopError.isNotBlank()&&!vm.state.stopping}
        Assert.assertTrue(vm.state.running)
        ui.onNodeWithText("停止尚未确认，请检查网络后重试").assertIsDisplayed()
        ui.onNodeWithContentDescription("停止任务").performClick()
        ui.waitUntil(10000){!vm.state.running&&!vm.state.stopping}
    }

    @Test fun delayedHistoryConfirmationClearsTheStopTimeout(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.running&&!vm.state.loadingHistory}
        ui.onNodeWithContentDescription("停止任务").performClick()
        ui.waitUntil(16000){vm.state.stopError.isNotBlank()&&!vm.state.stopping}
        Assert.assertTrue(vm.state.running)
        historyStatus="interrupted"
        ui.waitUntil(10000){!vm.state.running&&vm.state.stopError.isBlank()}
        Assert.assertEquals("",vm.state.error)
        ui.onNodeWithText("停止尚未确认，请检查网络后重试").assertDoesNotExist()
        ui.onNodeWithContentDescription("停止任务").assertDoesNotExist()
    }

    @Test fun cachedModelsSurviveRecreationAndEmptyCatalogUsesDefaultHigh(){
        ui.waitUntil(10000){vm.state.models.any{it.id=="test"}}
        val application=ApplicationProvider.getApplicationContext<Application>()
        val address=server.url("/").toString().trimEnd('/')
        val store=ConnectionStore(application)
        Assert.assertEquals("test",store.models(address).first().id)
        ui.runOnUiThread{
            vm.disconnect()
            val cached=NativeViewModel(application)
            Assert.assertEquals("test",cached.state.model)
            Assert.assertFalse(cached.state.modelsFallback)
            Assert.assertTrue(store.models("https://another-computer").isEmpty())
            application.getSharedPreferences("connection",0).edit().remove("models:$address").commit()
            val fallback=NativeViewModel(application)
            Assert.assertTrue(fallback.state.modelsFallback)
            Assert.assertEquals("",fallback.state.model)
            Assert.assertEquals("high",fallback.state.effort)
            fallback.switchHarness("antigravity")
            Assert.assertEquals("antigravity::default",fallback.state.model)
            Assert.assertEquals("high",fallback.state.effort)
        }
    }

    @Test fun readerFileFeedbackRemainsVisibleAndPdfReturnsToMarkdown(){
        ui.runOnUiThread{vm.openOutput("F:/Code/Codex-mobile-control/guide.md")}
        ui.waitUntil(10000){vm.state.markdown!=null&&!vm.state.fileBusy}
        androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("打开慢文档"))
            .perform(object:androidx.test.espresso.ViewAction{
                override fun getConstraints()=androidx.test.espresso.matcher.ViewMatchers.isAssignableFrom(android.widget.TextView::class.java)
                override fun getDescription()="Activate the document's native Markdown link"
                override fun perform(controller:androidx.test.espresso.UiController,view:android.view.View){
                    val text=(view as android.widget.TextView).text as android.text.Spanned
                    text.getSpans(0,text.length,android.text.style.ClickableSpan::class.java).single().onClick(view)
                    controller.loopMainThreadUntilIdle()
                }
            })
        ui.onNodeWithText("正在打开 slow.md").assertIsDisplayed()
        ui.waitUntil(12000){!vm.state.fileBusy&&vm.state.fileError.isNotBlank()}
        ui.onNodeWithText("文件操作失败：电脑服务暂不可用，请稍后重试").assertIsDisplayed()
        Thread.sleep(5500)
        ui.onNodeWithTag("fileFeedback").assertIsDisplayed()
        ui.onNodeWithText("重试").performClick()
        ui.waitUntil(10000){vm.state.markdown?.content=="# 重试成功"&&!vm.state.fileBusy}
        ui.onNodeWithTag("fileFeedback").assertDoesNotExist()
        ui.runOnUiThread{vm.openOutput("F:/Code/Codex-mobile-control/report.pdf")}
        ui.waitUntil(10000){vm.state.pdf!=null&&!vm.state.fileBusy}
        ui.waitUntil(10000){ui.onAllNodesWithTag("pdfPages").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithTag("pdfPages").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭 PDF 预览").performClick()
        androidx.test.espresso.Espresso.onView(androidx.test.espresso.matcher.ViewMatchers.withText("重试成功"))
            .check(androidx.test.espresso.assertion.ViewAssertions.matches(androidx.test.espresso.matcher.ViewMatchers.isDisplayed()))
    }

    @Test fun slowFileShowsWaitingThenFailureAndRetry(){
        ui.runOnUiThread{vm.openOutput("F:/Code/Codex-mobile-control/slow.md")}
        ui.onNodeWithText("正在打开 slow.md").assertIsDisplayed()
        ui.onNodeWithTag("composer").performTextInput("文件加载时可继续输入")
        ui.waitUntil(8000){vm.state.fileMessage.contains("网络较慢")}
        ui.onNodeWithText("正在打开 slow.md… 网络较慢，正在等待电脑响应").assertIsDisplayed()
        screenshot("native-file-slow-network.png")
        ui.waitUntil(12000){!vm.state.fileBusy&&vm.state.fileError.isNotBlank()}
        ui.onNodeWithText("文件操作失败：电脑服务暂不可用，请稍后重试").assertIsDisplayed()
        screenshot("native-file-network-error.png")
        ui.onNodeWithText("重试").performClick()
        ui.waitUntil(10000){vm.state.markdown?.content=="# 重试成功"&&!vm.state.fileBusy}
        ui.onNodeWithTag("fileFeedback").assertDoesNotExist()
    }

    @Test fun modelListRecoversAfterFailureAndSlowReplyWithoutReconnecting(){
        ui.waitUntil(25000){vm.state.models.any{it.id=="test"}}
        Assert.assertEquals(2,modelRequests.get())
        Assert.assertTrue(vm.state.connected)
        Assert.assertEquals("test",vm.state.model)
        ui.onNodeWithText("Test model · 中").assertIsDisplayed()
        ui.onNodeWithText("Test model · 中").performClick()
        ui.onNodeWithText("Test model",useUnmergedTree=true).assertExists()
        screenshot("native-model-list-recovered.png")
    }

    @Test fun fileChangeOpensReadablePatchOutsideTheChatList(){
        val patch="diff --git a/src/example.kt b/src/example.kt\n@@ -1 +1 @@\n-old\n+new"
        history=org.json.JSONArray().put(JSONObject().put("type","file.changed").put("threadId","t").put("eventId","changed").put("itemId","patch-1").put("files",org.json.JSONArray().put("src/example.kt")).put("diff",patch)).toString()
        historyStatus="completed"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.events.any{it.type=="file.changed"}}
        ui.onNodeWithContentDescription("展开详情").performClick()
        ui.onNodeWithTag("activityChange").performClick()
        ui.onNodeWithTag("changeDetail").assertIsDisplayed()
        ui.onNode(hasText("src/example.kt") and hasAnyAncestor(hasTestTag("changeDetail"))).assertExists()
        ui.onNodeWithText("+new").assertIsDisplayed()
        ui.onNodeWithText("-old").assertIsDisplayed()
        screenshot("native-change-detail.png")
        ui.onNodeWithContentDescription("关闭改动").performClick()
        ui.onNodeWithTag("changeDetail").assertDoesNotExist()
    }

    @Test fun localConsoleStatisticsFiltersAndChartKeepTheChatDraft(){
        ui.onNodeWithTag("composer").performTextReplacement("保留这条草稿")
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("设置").performClick();ui.onNodeWithTag("settings:quota").performClick();ui.onNodeWithText("统计").performClick()
        ui.waitUntil(10000){vm.state.localConsole.statistics!=null&&vm.state.localConsole.info!=null}
        ui.onNodeWithText("Token 总量 · 12 条计量记录").assertExists()
        ui.onNodeWithText("本月").performClick()
        ui.waitUntil(10000){consoleQueries.contains("codex:month:codex")&&!vm.state.localConsole.statisticsLoading}
        ui.onNodeWithTag("consoleScroll").performScrollToNode(hasTestTag("consoleDailyChart"))
        ui.onNodeWithTag("consoleDailyChart").performTouchInput{down(center);advanceEventTime(100)}
        ui.onNodeWithTag("chartCallout").assertExists()
        screenshot("native-console-statistics.png")
        ui.onNodeWithTag("consoleDailyChart").performTouchInput{up()}
        ui.onNodeWithTag("chartCallout").assertDoesNotExist()
        ui.onNodeWithTag("consoleScroll").performScrollToNode(hasText("AGY"))
        ui.onNodeWithText("AGY").performClick()
        ui.waitUntil(10000){vm.state.localConsole.statistics?.source=="agy"&&!vm.state.localConsole.statisticsLoading}
        ui.onNodeWithContentDescription("返回").performClick()
        ui.runOnIdle{Assert.assertEquals("保留这条草稿",vm.state.draft)}
    }

    @Test fun localConsoleRefreshDefaultAndVisibilityUpdateThePicker(){
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("设置").performClick();ui.onNodeWithTag("settings:quota").performClick();ui.onNodeWithText("统计").performClick()
        ui.waitUntil(10000){vm.state.localConsole.info!=null}
        ui.onNodeWithText("模型").performClick()
        ui.onNodeWithTag("consoleRefreshModels").performClick()
        ui.waitUntil(10000){vm.state.localConsole.info?.models?.size==2&&vm.state.models.any{it.id=="new-model"}}
        ui.onNodeWithTag("consoleScroll").performScrollToNode(hasTestTag("consoleDefault:new-model"))
        ui.onNodeWithTag("consoleDefault:new-model").performClick()
        ui.waitUntil(10000){vm.state.localConsole.info?.model=="new-model"&&vm.state.localConsole.busyAction.isBlank()}
        ui.onNodeWithTag("consoleScroll").performScrollToNode(hasTestTag("consoleToggle:test"))
        ui.onNodeWithTag("consoleToggle:test").performClick()
        ui.waitUntil(10000){vm.state.localConsole.info?.models?.first()?.enabled==false&&vm.state.models.none{it.id=="test"}}
        Assert.assertTrue(consoleActions.any{it.optString("action")=="toggle"&&!it.optBoolean("enabled")})
        ui.onNodeWithTag("consoleToggle:test").assertIsOff()
        screenshot("native-console-model-management.png")
    }

    @Test fun localConsoleOfflineStateRecoversWithoutZeroStatistics(){
        consoleOffline=true
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("设置").performClick();ui.onNodeWithTag("settings:quota").performClick();ui.onNodeWithText("统计").performClick()
        ui.waitUntil(10000){vm.state.localConsole.statisticsError.isNotBlank()&&!vm.state.localConsole.infoLoading}
        Assert.assertNull(vm.state.localConsole.statistics)
        ui.onNodeWithText("电脑控制台暂不可用，请检查电脑上的 25819 服务后重试").assertIsDisplayed()
        screenshot("native-console-offline.png")
        consoleOffline=false
        ui.onNodeWithContentDescription("刷新电脑控制台").performClick()
        ui.waitUntil(10000){vm.state.localConsole.statistics!=null&&vm.state.localConsole.statisticsError.isBlank()}
        ui.onNodeWithText("Token 总量 · 12 条计量记录").assertExists()
    }

    @Test fun compactCommandUsesDedicatedEndpointAndShowsContext(){
        historyStatus="completed"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running}
        ui.onNodeWithTag("composer").performTextReplacement("/compact")
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){compactRequests.get()==1}
        ui.onNodeWithText("上下文：1% · 1.2千 / 12.8万 tokens").assertExists()
        Assert.assertTrue(requests.none{it.optString("text")=="/compact"||it.optString("initialText")=="/compact"})
        screenshot("native-context-status.png")
    }
    @Test fun sentBubbleUsesLongPressAndRunningAnswerHasNoCopy(){
        history="""[{"type":"user.message","threadId":"t","eventId":"user","text":"长按这条消息"},{"type":"message.delta","threadId":"t","eventId":"answer","text":"正在回复"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.text=="长按这条消息"}}
        ui.onNodeWithContentDescription("复制消息").assertDoesNotExist()
        ui.onNodeWithContentDescription("复制回复").assertDoesNotExist()
        ui.onNodeWithContentDescription("回复菜单").assertDoesNotExist()
        screenshot("native-bubble-corners-061.png")
        ui.onNodeWithText("长按这条消息").performTouchInput{longClick()}
        ui.onNodeWithText("复制",useUnmergedTree=true).assertIsDisplayed()
        screenshot("native-bubble-menu-glass.png")
        ui.onNodeWithText("再次使用").performClick()
        ui.runOnIdle{Assert.assertEquals("长按这条消息",vm.state.draft)}
        historyStatus="completed"
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){!vm.state.running}
        ui.onNodeWithContentDescription("复制回复").assertExists()
        ui.onNodeWithContentDescription("回复菜单").performClick()
        ui.onNodeWithText("选择文本",useUnmergedTree=true).assertIsDisplayed()
        screenshot("native-answer-menu.png")
        ui.onNodeWithText("选择文本",useUnmergedTree=true).performClick()
        ui.onNodeWithText("选择文本",useUnmergedTree=true).assertIsDisplayed()
    }
    @Test fun retryLatestAnswerResendsItsPromptWithoutClearingDraft(){
        history="""[{"type":"user.message","threadId":"t","eventId":"retry-user","text":"原来的问题"},{"type":"message.delta","threadId":"t","eventId":"retry-answer","text":"已经完成的回答"}]"""
        historyStatus="completed"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running&&vm.state.events.any{it.eventId=="retry-answer"}}
        ui.onNodeWithTag("composer").performTextReplacement("未发送的草稿")
        ui.onNodeWithContentDescription("回复菜单").performClick()
        ui.onNode(hasText("重试") and hasAnyAncestor(hasTestTag("sheetPanel")),useUnmergedTree=true).performClick()
        ui.waitUntil(10000){requests.any{it.optString("type")=="turn.start"&&it.optString("text")=="原来的问题"}}
        ui.runOnIdle{Assert.assertEquals("未发送的草稿",vm.state.draft)}
    }
    @Test fun capacityFailureRetriesOriginalPromptAndKeepsNewDraft(){
        history="""[{"type":"user.message","threadId":"t","eventId":"capacity-user","text":"容量不足前的问题"},{"type":"error","threadId":"t","eventId":"capacity-error","text":"Selected model is at capacity. Please try a different model.","errorCode":"serverOverloaded"},{"type":"turn.completed","threadId":"t","eventId":"capacity-ended","status":"failed"}]"""
        historyStatus="failed"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running&&vm.state.events.any{it.eventId=="capacity-error"}}
        ui.runOnUiThread{vm.draft("新的草稿不要丢")}
        ui.onNodeWithTag("retryTurn").performScrollTo().performClick()
        ui.waitUntil(10000){requests.any{it.optString("type")=="turn.start"&&it.optString("text")=="容量不足前的问题"}}
        Assert.assertEquals(1,requests.count{it.optString("text")=="容量不足前的问题"})
        ui.runOnIdle{Assert.assertEquals("新的草稿不要丢",vm.state.draft)}
    }
    @Test fun lateConfirmationClearsRecoveredDraftAfterSwitchingConversations(){
        historyStatus="completed";dropAcknowledgement=true;submissionState="failed"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running&&chatSockets.isNotEmpty()}
        ui.runOnUiThread{vm.draft("已发送的旧草稿");vm.send()}
        ui.waitUntil(20000){vm.failedMessages().isNotEmpty()&&!vm.state.sending}
        val id=vm.failedMessages().single().requestId
        Assert.assertEquals("已发送的旧草稿",vm.state.draft)
        ui.runOnUiThread{vm.openThread(ThreadRecord("other"));vm.draft("另一个会话的新草稿")}
        chatSockets.last().send(JSONObject().put("type","user.message").put("threadId","t").put("eventId","late-receipt").put("requestId",id).put("text","已发送的旧草稿").toString())
        ui.waitUntil(10000){ApplicationProvider.getApplicationContext<Application>().getSharedPreferences("native",0).all.keys.none{it.startsWith("send:")}}
        ui.runOnIdle{Assert.assertEquals("另一个会话的新草稿",vm.state.draft)}
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.runOnIdle{Assert.assertEquals("",vm.state.draft)}
        Assert.assertEquals(1,requests.count{it.optString("text")=="已发送的旧草稿"})
    }
    @Test fun longComposerWithTwoImagesKeepsActionsAboveKeyboard(){
        ui.runOnUiThread{androidx.core.view.WindowCompat.setDecorFitsSystemWindows(ui.activity.window,false)}
        val context=ApplicationProvider.getApplicationContext<Application>()
        val file=java.io.File(context.cacheDir,"composer-two-images.png").apply{writeBytes(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==",0))}
        try{
            releaseUpload.countDown()
            ui.runOnUiThread{vm.uploadImages(List(2){android.net.Uri.fromFile(file)})}
            ui.waitUntil(10000){!vm.state.uploading&&vm.state.images.size==2}
            val draft="长文字输入时，模型和发送按钮应始终完整可见。".repeat(20)
            ui.onNodeWithTag("composer").performClick().performTextReplacement(draft)
            ui.waitUntil(5000){(ui.activity.window.decorView.rootWindowInsets?.getInsets(android.view.WindowInsets.Type.ime())?.bottom?:0)>0}
            ui.waitForIdle()
            ui.onNodeWithTag("composerActions").assertIsDisplayed()
            ui.onNodeWithContentDescription("添加附件").assertIsDisplayed()
            val send=ui.onNodeWithContentDescription("发送消息").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
            val actions=ui.onNodeWithTag("composerActions").fetchSemanticsNode().boundsInRoot
            Assert.assertTrue("按钮不应被输入区裁切",send.top>=actions.top&&send.bottom<=actions.bottom+1f)
            val field=ui.onNodeWithTag("composer").fetchSemanticsNode().layoutInfo.coordinates
            val body=ui.onNodeWithTag("composerBody").fetchSemanticsNode().boundsInRoot
            val fieldTop=field.localToRoot(Offset.Zero).y
            Assert.assertTrue("输入区域及光标应滚动到可见位置",fieldTop>=body.top-1f&&fieldTop+field.size.height<=body.bottom+1f)
            ui.runOnIdle{Assert.assertEquals(draft,vm.state.draft)}
            screenshot("native-long-composer-315.png")
        }finally{file.delete()}
    }
    @Test fun failedGoalContinuationOffersRetryWithoutRepeatingAUserMessage(){
        goalStatus="paused";historyStatus="failed"
        history="""[{"type":"error","threadId":"t","eventId":"goal-capacity","text":"Selected model is at capacity.","errorCode":"serverOverloaded"},{"type":"turn.completed","threadId":"t","eventId":"goal-ended","status":"failed"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first());vm.draft("保留目标会话草稿")}
        ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.threads.first{it.id=="t"}.goal?.status=="paused"}
        ui.onNodeWithTag("retryTurn").performScrollTo().performClick()
        ui.waitUntil(10000){goalContinueBody.get()!=null}
        ui.runOnIdle{Assert.assertEquals("保留目标会话草稿",vm.state.draft)}
        Assert.assertTrue(requests.none{it.optString("type")=="turn.start"})
    }
    @Test fun openAINodePanelWaitsForSwitchAcknowledgement(){
        ui.onNodeWithTag("connectionStatus").performClick()
        ui.onNodeWithTag("connectionDetails").assertDoesNotExist()
        ui.onNodeWithText("Clash · OpenAI 节点").performScrollTo().performClick()
        ui.waitUntil(10000){vm.networkState.groups.isNotEmpty()&&!vm.networkState.busy}
        Assert.assertEquals("测试节点 A",vm.networkState.groups.single().selected)
        ui.onNodeWithTag("proxy:OpenAI:测试节点 B").performScrollTo().performClick()
        ui.waitUntil(10000){vm.networkState.groups.single().selected=="测试节点 B"&&!vm.networkState.busy}
        Assert.assertEquals("节点已切换",vm.networkState.message)
        ui.onNodeWithTag("testProxy:测试节点 B").performScrollTo().performClick()
        ui.waitUntil(10000){!vm.networkState.busy&&vm.networkState.groups.single().nodes.last().delay==31}
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun emptyComposerHintSharesTheCaretOrigin(){
        ui.onNodeWithTag("composer").performClick()
        val field=ui.onNodeWithTag("composer").fetchSemanticsNode().boundsInRoot
        val hint=ui.onNodeWithText("描述任务…",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("占位文字应与输入区域顶端对齐：${field.top} vs ${hint.top}",kotlin.math.abs(field.top-hint.top)<4f*ui.activity.resources.displayMetrics.density)
        screenshot("native-composer-caret-alignment.png")
    }
    @Test fun attachmentMenuKeepsKeyboardAndClosesOnSecondTap(){
        fun imeVisible()=ui.activity.window.decorView.rootWindowInsets?.getInsets(android.view.WindowInsets.Type.ime())?.bottom?.let{it>0}?:false
        ui.onNodeWithTag("composer").performClick()
        ui.waitUntil(5000){imeVisible()}
        ui.onNodeWithContentDescription("添加附件").performClick()
        ui.onNodeWithText("图片与视频").assertIsDisplayed()
        ui.onNodeWithTag("composer").assertIsFocused()
        ui.waitForIdle()
        Assert.assertTrue("加号菜单不应收起输入法",imeVisible())
        screenshot("native-attachment-with-ime.png")
        ui.onNodeWithContentDescription("添加附件").performTouchInput{click()}
        ui.onNodeWithText("图片与视频").assertDoesNotExist()
        Assert.assertTrue("关闭加号菜单后输入法应保持原状态",imeVisible())
    }
    @Test fun openingDrawerFromKeyboardHidesImeBeforeDrawer(){
        fun imeVisible()=ui.activity.window.decorView.rootWindowInsets?.getInsets(android.view.WindowInsets.Type.ime())?.bottom?.let{it>0}?:false
        ui.onNodeWithTag("composer").performClick()
        ui.waitUntil(5000){imeVisible()}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithContentDescription("收起侧栏").assertIsDisplayed()
        ui.onNodeWithTag("composer").assertIsNotFocused()
        ui.waitUntil(5000){!imeVisible()}
        screenshot("native-drawer-after-ime.png")
    }
    @Test fun topMenuSecondTapClosesWithoutReopening(){
        ui.waitForIdle()
        val bounds=ui.onNodeWithContentDescription("会话菜单").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("上下文与状态").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭会话菜单").assertExists()
        val location=IntArray(2)
        ui.runOnIdle{
            fun host(view:android.view.View):android.view.View? {
                if(view.javaClass.simpleName=="AndroidComposeView")return view
                if(view is android.view.ViewGroup)for(i in 0 until view.childCount)host(view.getChildAt(i))?.let{return it}
                return null
            }
            host(ui.activity.window.decorView)!!.getLocationOnScreen(location)
        }
        val instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        screenshot("native-menu-before-retap.png")
        val now=android.os.SystemClock.uptimeMillis()
        for(action in listOf(android.view.MotionEvent.ACTION_DOWN,android.view.MotionEvent.ACTION_UP)){
            val event=android.view.MotionEvent.obtain(now,now+if(action==android.view.MotionEvent.ACTION_UP)50 else 0,action,bounds.center.x+location[0],bounds.center.y+location[1],0)
            event.source=android.view.InputDevice.SOURCE_TOUCHSCREEN
            instrumentation.uiAutomation.injectInputEvent(event,true);event.recycle()
        }
        ui.waitForIdle()
        screenshot("native-menu-after-retap.png")
        ui.onNodeWithText("上下文与状态").assertDoesNotExist()
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("上下文与状态").assertIsDisplayed()
    }
    @Test fun topMenuStaysWithinScreenAndLastActionIsReachable(){
        ui.onNodeWithContentDescription("会话菜单").performClick()
        val menu=ui.onNodeWithTag("modernDropdown")
        val maxPixels=420f*ui.activity.resources.displayMetrics.density
        Assert.assertTrue("菜单不应遮住整页内容",menu.fetchSemanticsNode().boundsInRoot.height<=maxPixels+2f)
        menu.performScrollToNode(hasText("连接电脑"))
        ui.onNodeWithText("连接电脑").assertIsDisplayed()
        ui.onNodeWithText("连接电脑").performClick()
        ui.onNodeWithText("扫描电脑二维码").assertExists()
    }
    @Test fun viewingStatusKeepsDraftAndContextRingOpensStatus(){
        historyStatus="completed"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.usage!=null}
        ui.onNodeWithTag("composer").performTextReplacement("还没发送的内容")
        ui.onNodeWithContentDescription("上下文已用 1%，查看状态").performClick()
        ui.onNodeWithText("上下文：1% · 1.2千 / 12.8万 tokens").assertExists()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.runOnIdle{Assert.assertEquals("还没发送的内容",vm.state.draft)}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("上下文与状态").performClick()
        ui.runOnIdle{Assert.assertEquals("还没发送的内容",vm.state.draft)}
    }

    @Test fun hiddenAnswerFooterDoesNotLeaveBlankLines(){
        historyStatus="completed"
        val answer="回答正文。".repeat(35)+"\n\n末尾结论。\n\n<citation_entries> MEMORY.md:1-2|note=[项目范围]\nrollout_summaries/session.md:8-8|note=[图像预览] </citation_entries> <rollout_ids>test-id</rollout_ids>\n\n"
        history=org.json.JSONArray().put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","answer").put("text",answer)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.text==answer}}
        ui.onNodeWithContentDescription("复制回复").assertExists()
        ui.onNodeWithContentDescription("查看记忆引用").assertExists()
        ui.onNodeWithText("已参考记忆").assertDoesNotExist()
        val copyBounds=ui.onNodeWithContentDescription("复制回复").fetchSemanticsNode().boundsInRoot
        val memoryBounds=ui.onNodeWithContentDescription("查看记忆引用").fetchSemanticsNode().boundsInRoot
        val menuBounds=ui.onNodeWithContentDescription("回复菜单").fetchSemanticsNode().boundsInRoot
        Assert.assertTrue(kotlin.math.abs(copyBounds.center.y-memoryBounds.center.y)<2f)
        Assert.assertTrue(kotlin.math.abs(menuBounds.center.y-memoryBounds.center.y)<2f)
        Assert.assertTrue("Copy $copyBounds, memory $memoryBounds, menu $menuBounds",copyBounds.center.x<memoryBounds.center.x&&memoryBounds.center.x<menuBounds.center.x)
        ui.runOnIdle{
            fun texts(view:android.view.View):List<android.widget.TextView> = if(view is android.view.ViewGroup)(0 until view.childCount).flatMap{texts(view.getChildAt(it))} else if(view is android.widget.TextView)listOf(view) else emptyList()
            val rendered=texts(ui.activity.window.decorView).first{it.text.toString().startsWith("回答正文。")}
            Assert.assertTrue(rendered.text.toString().endsWith("末尾结论。"))
            Assert.assertFalse(rendered.text.toString().contains("citation_entries"))
            Assert.assertFalse(rendered.text.last().isWhitespace())
        }
        screenshot("native-answer-copy-spacing.png")
        ui.onNodeWithContentDescription("查看记忆引用").performClick()
        ui.onNodeWithText("参考的记忆").assertIsDisplayed()
        ui.onNodeWithText("项目范围").assertIsDisplayed()
        ui.onNodeWithText("MEMORY.md · 第 1–2 行").assertIsDisplayed()
        ui.onNodeWithText("图像预览").assertIsDisplayed()
        ui.onNodeWithText("rollout_summaries/session.md · 第 8 行").assertIsDisplayed()
        screenshot("native-memory-reference-info.png")
    }

    @Test fun compactionRemainsVisibleAcrossHistoryRefresh(){
        history="""[{"type":"context.compaction","threadId":"t","eventId":"compact-start","itemId":"compact","status":"running","createdAt":"2026-10-15T01:00:00Z"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="compact-start"}}
        ui.onNodeWithText("正在压缩上下文").assertIsDisplayed()
        history="""[{"type":"context.compaction","threadId":"t","eventId":"history:marker","itemId":"history:42","status":"ok","createdAt":"2026-10-15T01:00:01Z"},{"type":"tool.completed","threadId":"t","eventId":"tool","status":"ok","title":"运行命令","createdAt":"2026-10-15T01:00:02Z"}]"""
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.onNodeWithText("正在压缩上下文").assertIsDisplayed()
        screenshot("native-compaction-running.png")
        history="""[{"type":"tool.completed","threadId":"t","eventId":"tool","status":"ok"},{"type":"context.compaction","threadId":"t","eventId":"compact-done","itemId":"compact","status":"ok"}]"""
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.onNodeWithText("正在压缩上下文").assertDoesNotExist()
        ui.onNodeWithText("上下文已自动压缩").assertIsDisplayed()
    }

    @Test fun pairingSheetHasScannerEntry(){
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("连接电脑").performScrollTo().assertIsDisplayed().performClick()
        ui.waitUntil(5000){ui.onAllNodesWithText("扫描电脑二维码").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithText("扫描电脑二维码").assertExists()
    }
    private val server=MockWebServer()
    private val modelRequests=java.util.concurrent.atomic.AtomicInteger()
    private val slowFileRequests=java.util.concurrent.atomic.AtomicInteger()
    private val releaseInterrupt=java.util.concurrent.CountDownLatch(1)
    private lateinit var vm:NativeViewModel
    private val displayedVm=androidx.compose.runtime.mutableStateOf<NativeViewModel?>(null)
    private val requests=CopyOnWriteArrayList<JSONObject>()
    private val chatSockets=CopyOnWriteArrayList<WebSocket>()
    private val socketAttempts=java.util.concurrent.atomic.AtomicInteger()
    @Volatile private var rejectSocket=false
    @Volatile private var stallSocket=false
    @Volatile private var socketDelayMs=0L
    @Volatile private var healthDelayMs=0L
    private val healthRequests=java.util.concurrent.atomic.AtomicInteger()
    private val fastReadRequests=java.util.concurrent.atomic.AtomicInteger()
    @Volatile private var stallModelRead=false
    @Volatile private var stallSidebarRead=false
    @Volatile private var stalledHistoryThread=""
    private val sidebarReadCount=java.util.concurrent.atomic.AtomicInteger()
    private val searchRetryCount=java.util.concurrent.atomic.AtomicInteger()
    @Volatile private var stalledAccountService=""
    @Volatile private var holdAccountPreview=false
    private val releaseAccountPreview=java.util.concurrent.CountDownLatch(1)
    @Volatile private var fastFixture=false
    @Volatile private var stallFastRead=false
    @Volatile private var failFastWrite=false
    @Volatile private var quotaFixture=""
    @Volatile private var dropAcknowledgement=false
    @Volatile private var proxySelected="测试节点 A"
    @Volatile private var submissionState="unknown"
    @Volatile private var activityMetadata="[]"
    @Volatile private var activityBody="[]"
    @Volatile private var usageDelayMs=0L
    @Volatile private var stalledUsageThread=""
    private val usageQueries=CopyOnWriteArrayList<String>()
    @Volatile private var historyDelayMs=0L
    private val activityQueries=CopyOnWriteArrayList<String>()
    @Volatile private var stalledActivityThread=""
    private val changeFeedbackGroups=java.util.concurrent.atomic.AtomicInteger()
    private val changeFeedbackBodies=java.util.concurrent.atomic.AtomicInteger()
    private var queue="[]"
    @Volatile private var queueCanSteer=false
    private val steerRequests=java.util.concurrent.atomic.AtomicInteger()
    private val compactRequests=java.util.concurrent.atomic.AtomicInteger()
    private val goalContinueBody=java.util.concurrent.atomic.AtomicReference<JSONObject>()
    private val goalPauseRequests=java.util.concurrent.atomic.AtomicInteger()
    @Volatile private var goalStatus=""
    @Volatile private var goalObjective="核对运行目标"
    @Volatile private var failGoalSave=false
    @Volatile private var holdGoalSave=false
    @Volatile private var missingGoalSaveReply=false
    private val goalSaveRequests=java.util.concurrent.atomic.AtomicInteger()
    private val goalSaveStarted=java.util.concurrent.CountDownLatch(1)
    private val releaseGoalSave=java.util.concurrent.CountDownLatch(1)
    @Volatile private var threadTitle="原生测试"
    @Volatile private var threadPinned=false
    @Volatile private var pinSyncEnabled=false
    private val mobilePinRequests=java.util.concurrent.atomic.AtomicInteger()
    @Volatile private var sidebarFixture=""
    private val readRequests=CopyOnWriteArrayList<Long>()
    @Volatile private var pagedSidebar=false
    private val sidebarRequests=CopyOnWriteArrayList<String>()
    @Volatile private var historyMore=false
    @Volatile private var olderHistory=""
    @Volatile private var oldestHistory=""
    @Volatile private var olderDelayMs=0L
    private val historyCounts=CopyOnWriteArrayList<Int>()
    private var saveTarget:android.net.Uri?=null
    private var savePickerRequests=0
    private val consoleActions=CopyOnWriteArrayList<JSONObject>()
    private val consoleQueries=CopyOnWriteArrayList<String>()
    @Volatile private var consoleOffline=false
    @Volatile private var consoleDelayMs=0L
    private val backendRestartRequests=java.util.concurrent.atomic.AtomicInteger()
    @Volatile private var consoleDefault="test"
    @Volatile private var consoleNewModel=false
    @Volatile private var consoleTestEnabled=true
    private fun consoleFixture():String {
        val now=java.time.Instant.now().toString()
        return """{"available":true,"version":"0.12.0","updatedAt":"$now","config":{"model":"$consoleDefault","provider":"openai","nativeCatalog":true},"catalog":{"automatic":true,"intervalHours":6,"lastChecked":"$now","lastUpdated":"$now","changed":$consoleNewModel,"added":${if(consoleNewModel)"[\"new-model\"]" else "[]"}},"models":[{"id":"test","name":"Test model","context":128000,"official":true,"enabled":$consoleTestEnabled,"isDefault":${consoleDefault=="test"}}${if(consoleNewModel)",{\"id\":\"new-model\",\"name\":\"New model\",\"context\":256000,\"official\":true,\"enabled\":true,\"isDefault\":${consoleDefault=="new-model"}}" else ""}],"service":{"requests":12,"errors":1,"activeRequests":0,"startedAt":"$now","memoryMB":80}}"""
    }
    private val uploadCount=java.util.concurrent.atomic.AtomicInteger()
    private val rawFileCount=java.util.concurrent.atomic.AtomicInteger()
    private val historyImageRequests=java.util.concurrent.atomic.AtomicInteger()
    private val previewImageRequests=java.util.concurrent.atomic.AtomicInteger()
    private val releaseFullImage=java.util.concurrent.CountDownLatch(1)
    @Volatile private var holdFullImage=false
    @Volatile private var failFirstImage=false
    @Volatile private var imageBodyDelayMs=0L
    @Volatile private var failFirstFullImage=false
    private lateinit var pdfBytes:ByteArray
    private val utf16Markdown="# 编码标题\n\n中文 🌏\n"
    private val utf16Json="{\"title\":\"中文 🌏\"}\n"
    private fun utf16Fixture(name:String)=if(name=="utf16-le-notes.md")byteArrayOf(-1,-2)+utf16Markdown.toByteArray(Charsets.UTF_16LE) else byteArrayOf(-2,-1)+utf16Json.toByteArray(Charsets.UTF_16BE)
    private val largeMarkdownBytes by lazy { ByteArray(6*1024*1024){if(it%80==79)10 else 97} }
    private val releaseUpload=java.util.concurrent.CountDownLatch(1)
    @Volatile private var history="""[{"type":"user.message","threadId":"t","text":"原生发送","eventId":"user"},{"type":"message.delta","threadId":"t","text":"这是原生 Markdown 回复。","eventId":"answer"}]"""
    @Volatile private var historyStatus="running"
    @Volatile private var approvalsJson="[]"
    @Volatile private var failHistory=false
    @Volatile private var failHistoryApprovals=false
    @Volatile private var failHistoryQueue=false
    private val holdOldQueueRead=java.util.concurrent.atomic.AtomicBoolean(false)
    private val oldQueueReadStarted=java.util.concurrent.CountDownLatch(1)
    private val releaseOldQueueRead=java.util.concurrent.CountDownLatch(1)
    private val releaseQueueCancel=java.util.concurrent.CountDownLatch(1)
    private val queueCancelRequests=java.util.concurrent.atomic.AtomicInteger()
    @Volatile private var failQueueCancel=false
    @Volatile private var queueDrafts="[]"
    @Volatile private var failRestoreResponse=false
    @Volatile private var failRestoreComplete=false
    private val restoreRequests=java.util.concurrent.atomic.AtomicInteger()
    private val restoreCompleteRequests=java.util.concurrent.atomic.AtomicInteger()
    @Before fun setup(){
        val application=ApplicationProvider.getApplicationContext<Application>()
        val document=android.graphics.pdf.PdfDocument()
        try {
            for(index in 1..2){val page=document.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(400,600,index).create());page.canvas.drawText("Page $index",40f,80f,android.graphics.Paint());document.finishPage(page)}
            pdfBytes=java.io.ByteArrayOutputStream().use{output->document.writeTo(output);output.toByteArray()}
        } finally {document.close()}
        application.getSharedPreferences("appearance",0).edit().clear().commit()
        application.getSharedPreferences("native",0).edit().clear().commit()
        application.getSharedPreferences("connection",0).edit().clear().commit()
        // Isolate persisted sidebar choices so prior cases cannot change the fixture layout.
        application.getSharedPreferences("sidebar",0).edit().clear().commit()
        ui.runOnUiThread {
            ui.activity.window.setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
            ui.activity.window.statusBarColor=android.graphics.Color.WHITE
            ui.activity.window.navigationBarColor=android.graphics.Color.WHITE
            ui.activity.window.decorView.systemUiVisibility=android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        }
        server.dispatcher=object:okhttp3.mockwebserver.Dispatcher(){override fun dispatch(r:RecordedRequest):MockResponse {
            fun json(s:String)=MockResponse().setHeader("Content-Type","application/json").setBody(s)
            val path=r.requestUrl!!.encodedPath
            if(path.startsWith("/api/local-console/accounts/")){
                val service=path.removePrefix("/api/local-console/accounts/")
                if(r.method=="GET")return if(service==stalledAccountService)MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE) else json(JSONObject().put("fixture",service).put("items",org.json.JSONArray()).toString())
                if(path.endsWith("/switch-preview")){
                    if(holdAccountPreview)releaseAccountPreview.await(15,java.util.concurrent.TimeUnit.SECONDS)
                    return json("""{"canSwitch":true,"id":"fixture-account","planId":"00000000-0000-4000-8000-000000000001","label":"隔离预览"}""")
                }
            }
            if(path=="/api/network/openai/test")return json("{\"delay\":31}")
            if(path=="/api/network/openai"||path=="/api/network/openai/node"){
                if(r.method=="PUT"){val body=JSONObject(r.body.readUtf8());Assert.assertEquals("OpenAI",body.getString("group"));proxySelected=body.getString("node")}
                return json(JSONObject().put("groups",org.json.JSONArray().put(JSONObject().put("name","OpenAI").put("selected",proxySelected).put("nodes",org.json.JSONArray().put(JSONObject().put("name","测试节点 A").put("delay",40)).put(JSONObject().put("name","测试节点 B").put("delay",JSONObject.NULL))))).toString())
            }
            if(path=="/api/sidebar"||path=="/api/threads")sidebarReadCount.incrementAndGet()
            if(path=="/api/threads/search"&&testName.methodName in setOf("changingSearchCancelsItsOldHttpReadAndKeepsTheLatestMatches","sidebarSearchShowsLoadingRetriesAndCancelsWhenClosed")){
                return if(r.requestUrl!!.queryParameter("q")=="old-query")MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
                else if(r.requestUrl!!.queryParameter("q")=="fail-query"&&searchRetryCount.incrementAndGet()==1)MockResponse().setResponseCode(503).setBody("Search unavailable")
                else json("""{"matches":[{"threadId":"latest-search","title":"最新搜索","snippet":"new-query","updatedAt":"2026-10-16T00:00:00Z"}]}""")
            }
            if(stallSidebarRead&&(path=="/api/sidebar"||path=="/api/threads"))return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
            if(stalledHistoryThread.isNotBlank()&&path=="/api/threads/$stalledHistoryThread/events")return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
            if(path=="/api/settings/fast"||path.endsWith("/fast")){
                if(r.method=="GET"){
                    fastReadRequests.incrementAndGet()
                    if(stallFastRead)return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
                }else if(failFastWrite)return json("""{"error":"Fast 切换失败"}""").setResponseCode(503)
                return json("""{"fast":$fastFixture}""")
            }
            if(failHistory&&path.endsWith("/events")||failHistoryApprovals&&path=="/api/approvals"||failHistoryQueue&&path.endsWith("/queue")&&r.method=="GET")return MockResponse().setResponseCode(503).setHeader("Content-Type","application/json").setBody("""{"error":"暂时无法读取，请重试"}""")
            if(path.endsWith("/activity")){
                activityQueries.add(r.requestUrl!!.encodedQuery.orEmpty())
                if(stalledActivityThread.isNotBlank()&&path=="/api/threads/$stalledActivityThread/activity")return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
                if(testName.methodName=="fileDetailRetriesEmptyAndFailedReadsWithoutLosingItsRecordedPatch"){
                    if(r.requestUrl!!.queryParameter("groupId")!=null){if(changeFeedbackGroups.incrementAndGet()==1)return json("""{"events":[]}""")}
                    else when(changeFeedbackBodies.incrementAndGet()){
                        1->return json("""{"events":[]}""")
                        2->return json("""{"error":"补丁暂不可用"}""").setResponseCode(503)
                    }
                }
                return json("""{"events":${if(r.requestUrl!!.queryParameter("groupId")!=null)activityMetadata else activityBody}}""")
            }
            if(path.endsWith("/submission"))return json("""{"submission":{"state":"$submissionState","threadId":"t","error":"请求超时：thread/resume"},"status":"completed"}""")
            if(testName.methodName in setOf("slowFileShowsWaitingThenFailureAndRetry","readerFileFeedbackRemainsVisibleAndPdfReturnsToMarkdown")&&r.requestUrl!!.queryParameter("path")=="slow.md"){
                return if(slowFileRequests.incrementAndGet()==1)MockResponse().setResponseCode(503).setBody("{\"error\":\"文件暂不可用，请稍后重试\"}").setHeadersDelay(6,java.util.concurrent.TimeUnit.SECONDS)
                else MockResponse().setHeader("Content-Type","text/markdown").setBody("# 重试成功")
            }
            if(path=="/api/agents/health")return json("""{"checkedAt":"2026-10-15T05:00:00Z","agents":[{"agent":"codex","name":"Codex","state":"ready","installed":true,"version":"Codex 1.0","pendingRequests":0},{"agent":"hermes","name":"Hermes","state":"ready","installed":true,"version":"Hermes 1.0","activeCount":0,"modelCount":2}]}""")
            if(path.startsWith("/api/local-console/")){
                if(path=="/api/local-console/backend/restart-preview")return json("""{"planId":"123e4567-e89b-42d3-a456-426614174000","canRestart":true,"blockingCount":0}""")
                if(path=="/api/local-console/backend/restart"){
                    Assert.assertEquals("123e4567-e89b-42d3-a456-426614174000",JSONObject(r.body.readUtf8()).getString("planId"))
                    backendRestartRequests.incrementAndGet();return json("""{"restarted":true}""")
                }
                if(consoleOffline)return MockResponse().setResponseCode(503).setHeader("Content-Type","application/json").setBody("""{"error":"电脑控制台暂不可用，请检查电脑上的 25819 服务后重试"}""")
                if(path=="/api/local-console/state")return json(consoleFixture())
                if(path=="/api/local-console/actions"){
                    val body=JSONObject(r.body.readUtf8());consoleActions.add(body)
                    when(body.optString("action")){"refresh"->consoleNewModel=true;"default"->consoleDefault=body.getString("id");"toggle"->consoleTestEnabled=body.getBoolean("enabled")}
                    return json(consoleFixture())
                }
                val source=r.requestUrl!!.queryParameter("source")?:"codex";val range=r.requestUrl!!.queryParameter("range")?:"week";val pricing=r.requestUrl!!.queryParameter("pricing")?:"codex"
                consoleQueries.add("$source:$range:$pricing")
                val now=System.currentTimeMillis();val date=java.time.LocalDate.now().toString()
                return json("""{"source":"$source","range":"$range","since":${now-86400000},"until":$now,"updatedAt":"${java.time.Instant.now()}","totals":{"input":10000,"cached":4000,"cacheWrite":0,"output":2345,"reasoning":345,"total":12345,"records":12},"cost":{"usd":0.31,"basis":"$pricing","priceDate":"2026-09-29","unpricedRecords":1},"activity":${if(source=="codex")"{\"minutes\":120,\"sessions\":3,\"days\":1,\"toolCalls\":35}" else "null"},"models":[{"id":"test","input":10000,"cached":4000,"output":2345,"total":12345,"records":12,"usd":0.31}],"series":[{"date":"$date","total":12345,"input":10000,"output":2345,"records":12}],"tools":[],"index":{"running":false},"coverage":{"available":true}}""").setHeadersDelay(consoleDelayMs,java.util.concurrent.TimeUnit.MILLISECONDS)
            }
            if(path=="/api/uploads/images"&&r.method=="POST"){
                val number=uploadCount.incrementAndGet()
                if(number==2)releaseUpload.await(10,java.util.concurrent.TimeUnit.SECONDS)
                return json("""{"id":"image-$number","name":"image-$number.png"}""")
            }
            if(path=="/api/uploads/files"&&r.method=="POST"){
                if(r.getHeader("X-File-Name")=="draft-notes.md")return json("""{"id":"markdown-test","name":"draft-notes.md","mime":"text/markdown","size":${r.body.size}}""")
                val name=r.getHeader("X-File-Name")
                if(name=="large-draft.md")return json(JSONObject().put("id","large-markdown-test").put("name",name).put("mime","application/octet-stream").put("size",r.body.size).toString())
                if(name=="draft-code.KT"||name=="unknown-mime.bin")return json(JSONObject().put("id",if(name=="draft-code.KT")"uploaded-code-test" else "uploaded-unknown-test").put("name",name).put("mime"," Application/Octet-Stream; fixture=1 ").put("size",r.body.size).toString())
                if(name=="utf16-le-notes.md"||name=="utf16-be-data.json")return json(JSONObject().put("id",if(name=="utf16-le-notes.md")"utf16-le-test" else "utf16-be-test").put("name",name).put("mime",if(name=="utf16-le-notes.md")"text/markdown" else "application/json").put("size",r.body.size).toString())
                if(name=="draft-log.txt"||name=="draft-data.JSON")return json(JSONObject().put("id",if(name=="draft-log.txt")"uploaded-text-test" else "uploaded-json-test").put("name",name).put("mime",if(name=="draft-log.txt")"text/plain" else "application/octet-stream").put("size",r.body.size).toString())
                if(name=="draft-report.PDF"||name=="draft-document")return json(JSONObject().put("id","uploaded-pdf-test").put("name",name).put("mime",if(name=="draft-report.PDF")"application/octet-stream" else " Application/PDF; charset=binary ").put("size",r.body.size).toString())
                return json("""{"id":"123e4567-e89b-12d3-a456-426614174000","name":"clip.mp4","mime":"video/mp4","size":${r.body.size}}""")
            }
            if(path=="/api/uploads/files/uploaded-pdf-test")return MockResponse().setHeader("Content-Type","application/octet-stream").setBody(okio.Buffer().write(pdfBytes))
            if(path=="/api/uploads/files/utf16-le-test"||path=="/api/uploads/files/utf16-be-test")return MockResponse().setHeader("Content-Type","application/octet-stream").setBody(okio.Buffer().write(utf16Fixture(if(path.endsWith("utf16-le-test"))"utf16-le-notes.md" else "utf16-be-data.json")))
            if(path=="/api/uploads/files/uploaded-text-test")return MockResponse().setHeader("Content-Type","text/plain").setBody("# 原样保留\n<em>这不是排版</em>\n")
            if(path=="/api/uploads/files/uploaded-json-test")return MockResponse().setHeader("Content-Type","application/octet-stream").setBody("{\n  \"title\": \"# 原文\"\n}\n")
            if(path=="/api/uploads/files/123e4567-e89b-12d3-a456-426614174000")return MockResponse().setHeader("Content-Type","video/mp4").setBody("video-bytes")
            if(path=="/api/uploads/files/markdown-test")return MockResponse().setHeader("Content-Type","text/markdown").setBody("# 附件阅读\n\n正文")
            if(path=="/api/uploads/files/large-markdown-test")return MockResponse().setHeader("Content-Type","text/markdown").setBody(okio.Buffer().write(largeMarkdownBytes))
            if(path=="/api/uploads/files/uploaded-code-test")return MockResponse().setHeader("Content-Type","application/octet-stream").setBody("fun main() { println(\"中文 <em>原文</em>\") }\n")
            if(path=="/api/uploads/files/uploaded-unknown-test")return MockResponse().setHeader("Content-Type","application/octet-stream").setBody(okio.Buffer().write(byteArrayOf(0,-128,-1)))
            if(path=="/ws"){
                socketAttempts.incrementAndGet()
                if(rejectSocket)return MockResponse().setResponseCode(503)
                if(stallSocket)return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
            }
            if(path=="/ws")return MockResponse().setHeadersDelay(socketDelayMs,java.util.concurrent.TimeUnit.MILLISECONDS).withWebSocketUpgrade(object:WebSocketListener(){override fun onOpen(ws:WebSocket,response:Response){chatSockets.add(ws)};override fun onClosing(webSocket:WebSocket,code:Int,reason:String){webSocket.close(code,reason)};override fun onMessage(ws:WebSocket,text:String){val m=JSONObject(text);requests.add(m);val id=m.optString("requestId");if(dropAcknowledgement)return;
                if(m.optString("replaceTurnId").isNotBlank()){
                    history="""[{"type":"turn.started","threadId":"t","turnId":"prior","eventId":"prior-start"},{"type":"user.message","threadId":"t","turnId":"prior","eventId":"prior-user","text":"上一条保留"},{"type":"turn.completed","threadId":"t","turnId":"prior","eventId":"prior-end","status":"completed"},{"type":"turn.started","threadId":"t","turnId":"edited","eventId":"edited-start"},{"type":"user.message","threadId":"t","turnId":"edited","eventId":"edited-user","requestId":"$id","text":"修改后新文"},{"type":"turn.completed","threadId":"t","turnId":"edited","eventId":"edited-end","status":"completed"}]"""
                    ws.send(JSONObject().put("type","thread.history.changed").put("threadId","t").put("turnId",m.getString("replaceTurnId")).toString())
                    ws.send(JSONObject().put("type","user.message").put("threadId","t").put("turnId","edited").put("eventId","edited-user").put("requestId",id).put("text",m.getString("text")).put("status","completed").toString())
                    ws.send(JSONObject().put("type","command.accepted").put("threadId","t").put("requestId",id).put("status","completed").toString());return
                }
                if(m.optString("type")=="turn.interrupt"){
                    val count=requests.count{it.optString("type")=="turn.interrupt"}
                    if(testName.methodName=="stopWaitsForConfirmationAndCannotBeSentTwice")releaseInterrupt.await(10,java.util.concurrent.TimeUnit.SECONDS)
                    if(testName.methodName in listOf("stopTimeoutReportsUnconfirmedAndAllowsRetry","delayedHistoryConfirmationClearsTheStopTimeout")&&count==1)return
                    if(testName.methodName=="stopFailureDoesNotPretendTheTurnStopped"&&count==1){ws.send(JSONObject().put("type","error").put("threadId","t").put("requestId",id).put("message","电脑暂时无法停止任务").toString());return}
                    historyStatus="interrupted"
                    ws.send(JSONObject().put("type","turn.completed").put("threadId","t").put("eventId","interrupted-$count").put("status","interrupted").toString());return
                }
if(m.optString("text").contains("WRITER")){queue="""[{"id":"$id","text":"WRITER 冲突测试","status":"queued","error":"桌面版仍持有此会话的写入权"}]""";ws.send(JSONObject().put("type","message.queued").put("threadId","t").put("requestId",id).put("message","消息已排队").toString());return};ws.send(JSONObject().put("type","thread.started").put("threadId","t").put("requestId",id).put("thread",JSONObject().put("id","t").put("title","原生测试")).toString());ws.send(JSONObject().put("type","user.message").put("threadId","t").put("text",m.optString("initialText",m.optString("text"))).put("eventId","user").toString())}})
            if(path=="/health"){
                healthRequests.incrementAndGet()
                return json("""{"ok":true,"minAndroidProtocolVersion":1,"capabilities":${if(testName.methodName.startsWith("workspaceFiles"))"[\"files\",\"cloud-snapshot-readonly\",\"queue-draft-recovery\"]" else if(testName.methodName=="sessionAutomationEntryFiltersAndOpensEditor")"[\"automations\",\"queue-draft-recovery\"]" else if(testName.methodName.startsWith("localConsole"))"[\"automations\",\"local-console-management\",\"shared-backend-restart\",\"agent-health\",\"queue-draft-recovery\"]" else if(testName.methodName=="lastMessageEditReplacesItsTurnAndKeepsTheComposerDraft")"[\"last-message-edit\",\"queue-draft-recovery\"]" else if(testName.methodName=="completedUnreadFollowsDesktopAndVisibleLatestResult")"[\"thread-read-state\",\"queue-draft-recovery\"]" else if(pinSyncEnabled)"[\"sidebar-pin-sync\",\"queue-draft-recovery\"]" else "[\"queue-draft-recovery\"]"}}""").setBodyDelay(healthDelayMs,java.util.concurrent.TimeUnit.MILLISECONDS)
            }
            if(path=="/api/sidebar/pins")return json("""{"pinned":${if(threadPinned)"[\"t\"]" else "[]"}}""")
            if(testName.methodName=="longComposerWithTwoImagesKeepsActionsAboveKeyboard"&&path.matches(Regex("/api/uploads/images/image-[12]"))){
                val image=android.graphics.Bitmap.createBitmap(128,128,android.graphics.Bitmap.Config.ARGB_8888)
                try{image.eraseColor(android.graphics.Color.rgb(160,190,210));val bytes=java.io.ByteArrayOutputStream().use{output->image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);output.toByteArray()};return MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(bytes))}finally{image.recycle()}
            }
            if(path=="/api/uploads/images/pixel.png"){
                val request=previewImageRequests.incrementAndGet()
                if(failFirstImage&&request==1||failFirstFullImage&&request==2)return MockResponse().setResponseCode(503)
                if(holdFullImage&&request==2){
                    releaseFullImage.await(10,java.util.concurrent.TimeUnit.SECONDS)
                    val image=android.graphics.Bitmap.createBitmap(16,8,android.graphics.Bitmap.Config.ARGB_8888)
                    val bytes=java.io.ByteArrayOutputStream().use{output->image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,output);output.toByteArray()}
                    image.recycle()
                    return MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(bytes))
                }
                return MockResponse().setBodyDelay(imageBodyDelayMs,java.util.concurrent.TimeUnit.MILLISECONDS).setHeader("Content-Type","image/png").setBody(okio.Buffer().write(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==",0)))
            }
            if(path=="/api/threads/t/history-image"){historyImageRequests.incrementAndGet();return MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==",0)))}
            if(pagedSidebar&&(path=="/api/threads"||path=="/api/sidebar")){
                val limit=r.requestUrl!!.queryParameter("limit")!!.toInt()
                sidebarRequests.add("$path:$limit")
                val count=if(path=="/api/threads")24 else 13
                val rows=org.json.JSONArray()
                for(i in 0 until minOf(count,limit))rows.put(if(path=="/api/threads")JSONObject().put("id",if(i==0)"t" else "page-$i").put("title","分页会话 $i").put("status","completed") else JSONObject().put("id","p$i").put("name","最近项目 $i").put("path","F:/p$i").put("trusted",true))
                return json(JSONObject().put(if(path=="/api/threads")"threads" else "projects",rows).put("allowedProjects",if(path=="/api/sidebar")rows else org.json.JSONArray()).put("hasMore",limit<count).toString())
            }
            if(path=="/api/sidebar"&&testName.methodName=="workspaceFilesResolveOutsideSidebarAndRetry")return json("""{"projects":[{"id":"other","name":"其他项目","path":"F:/other","trusted":true}],"allowedProjects":[{"id":"other","name":"其他项目","path":"F:/other","trusted":true}]}""")
            if(path=="/api/projects/p/files"&&testName.methodName=="workspaceFilesResolveOutsideSidebarAndRetry"){
                if(slowFileRequests.incrementAndGet()==1)return MockResponse().setResponseCode(503).setBody("{\"error\":\"busy\"}")
                return if(r.requestUrl!!.queryParameter("path")=="nested")json("""{"files":[{"name":"note.txt","path":"nested/note.txt","kind":"file"}]}""")
                else json("""{"files":[{"name":"nested","path":"nested","kind":"directory"}]}""")
            }
            if(path=="/api/projects/p/file")return json("""{"content":"工作区文件正文"}""")
            if(path=="/api/automations")return json("""{"automations":[{"id":"own","name":"当前会话任务","threadTitle":"当前目标会话","threadPath":"F:/new-chat","threadId":"t","status":"ACTIVE","kind":"thread","prompt":"检查进度","rrule":"FREQ=HOURLY;INTERVAL=1"},{"id":"other","name":"其他会话任务","threadTitle":"其他目标会话","threadPath":"F:/other-project","threadId":"other","status":"ACTIVE","kind":"thread","prompt":"其他任务","rrule":"FREQ=HOURLY;INTERVAL=1"}]}""")
            if(path=="/api/sidebar")return json("""{"projects":[{"id":"p","name":"Codex-mobile-control","path":"F:/Code/Codex-mobile-control","trusted":true}],"allowedProjects":[{"id":"p","name":"Codex-mobile-control","path":"F:/Code/Codex-mobile-control","trusted":true}]}""")
            if(path=="/api/projects/p/files")return json("""{"files":[{"name":"workspace-check.txt","path":"workspace-check.txt","kind":"file"}]}""")
            if(path=="/api/projects")return json("""{"projects":[{"id":"p","name":"Codex-mobile-control","path":"F:/Code/Codex-mobile-control","trusted":true}]}""")
            if(path=="/api/approvals")return json("""{"approvals":$approvalsJson}""")
            if(testName.methodName=="readerFileFeedbackRemainsVisibleAndPdfReturnsToMarkdown"&&r.requestUrl!!.queryParameter("path")=="guide.md")return MockResponse().setHeader("Content-Type","text/markdown").setBody("[打开慢文档](slow.md)")
            if(path=="/raw/projects/p/file"){
                rawFileCount.incrementAndGet()
                return when{
                    r.requestUrl!!.queryParameter("path")=="large-output.md"->MockResponse().setHeader("Content-Type","text/markdown").setBody(okio.Buffer().write(largeMarkdownBytes))
                    r.requestUrl!!.queryParameter("path")?.endsWith(".png")==true->MockResponse().setHeader("Content-Type","image/png").setBody(okio.Buffer().write(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==",0)))
                    r.requestUrl!!.queryParameter("path")?.endsWith(".pdf")==true->MockResponse().setHeader("Content-Type","application/pdf").setBody(okio.Buffer().write(pdfBytes))
                    r.requestUrl!!.queryParameter("path")?.endsWith(".md")==true->MockResponse().setHeader("Content-Type","text/markdown").setBody("# 阅读器标题\n\n**正文内容**")
                    else->MockResponse().setHeader("Content-Type","text/plain").setBody("linked output")
                }
            }
            if(path=="/api/threads/t/goal/continue"&&r.method=="POST"){
                val body=JSONObject(r.body.readUtf8());Assert.assertTrue(body.optString("requestId").isNotBlank());goalContinueBody.set(body);goalStatus="active";historyStatus="running"
                return json(JSONObject().put("goal",JSONObject().put("objective",goalObjective).put("status","active").put("tokensUsed",42).put("timeUsedSeconds",15001)).toString())
            }
            if(path=="/api/threads/t/goal"&&r.method=="PATCH"){
                val body=JSONObject(r.body.readUtf8())
                if(body.has("objective")){
                    goalSaveRequests.incrementAndGet()
                    if(holdGoalSave){goalSaveStarted.countDown();releaseGoalSave.await(15,java.util.concurrent.TimeUnit.SECONDS)}
                    if(failGoalSave)return MockResponse().setResponseCode(503).setBody("{\"error\":\"电脑暂时无法保存目标\"}")
                    if(missingGoalSaveReply)return json("{}")
                }
                goalStatus=body.optString("status",goalStatus);goalObjective=body.optString("objective",goalObjective)
                if(body.optString("status")=="paused"){
                    val attempt=goalPauseRequests.incrementAndGet()
                    if(testName.methodName=="pauseResponseFailureRefreshesGoalWithoutStoppingTurn"&&attempt==1)return MockResponse().setResponseCode(503).setBody("{\"error\":\"目标更新响应暂时失败\"}")
                }
                return json(JSONObject().put("goal",JSONObject().put("objective",goalObjective).put("status",goalStatus).put("tokensUsed",42).put("timeUsedSeconds",15001).put("tokenBudget",JSONObject.NULL)).toString())
            }
            if(path=="/api/threads/t/pin"&&r.method=="POST"){mobilePinRequests.incrementAndGet();threadPinned=JSONObject(r.body.readUtf8()).optBoolean("pinned");return json("""{"ok":true}""")}
            if(path=="/api/threads/t"&&r.method=="PATCH"){threadTitle=JSONObject(r.body.readUtf8()).getString("title");return json("""{"thread":{"id":"t","title":"$threadTitle"}}""")}
            if(path=="/api/threads/t/read"&&r.method=="POST"){
                val at=JSONObject(r.body.readUtf8()).getLong("completedAt");readRequests.add(at)
                val fixture=JSONObject(sidebarFixture);val thread=fixture.getJSONArray("threads").getJSONObject(0)
                if(thread.optLong("completedAt")<=at){thread.put("unread",false);sidebarFixture=fixture.toString()}
                return json(JSONObject().put("readThrough",at).toString())
            }
            if(path=="/api/threads"&&sidebarFixture.isNotBlank())return json(sidebarFixture)
            if(path=="/api/threads")return json("""{"threads":[{"id":"t","title":"$threadTitle","status":"${if(goalStatus=="paused")historyStatus else "running"}","pinnedIndex":${if(threadPinned)0 else -1}${if(goalStatus.isNotBlank()&&goalStatus!="complete")",\"goal\":{\"objective\":\"$goalObjective\",\"status\":\"$goalStatus\",\"tokensUsed\":42,\"timeUsedSeconds\":15001}" else ""}}]}""")
            if(path.substringBefore('?')=="/api/models"){
                val count=modelRequests.incrementAndGet()
                if(stallModelRead)return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
                if(testName.methodName=="modelListRecoversAfterFailureAndSlowReplyWithoutReconnecting"&&count==1)return MockResponse().setResponseCode(503).setBody("{\"error\":\"temporary model catalog failure\"}")
                val models=org.json.JSONArray()
                if(consoleTestEnabled)models.put(JSONObject("""{"model":"test","displayName":"Test model","defaultReasoningEffort":"medium","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"medium"},{"reasoningEffort":"high"}]}"""))
                if(consoleNewModel)models.put(JSONObject("""{"model":"new-model","displayName":"New model","defaultReasoningEffort":"medium","supportedReasoningEfforts":[{"reasoningEffort":"medium"}]}"""))
                val reconnectFixture=testName.methodName=="reconnectKeepsConversationSelectionUntilCatalogRemovesItsEffort"
                if(reconnectFixture&&count>1&&models.length()>0){
                    models.getJSONObject(0).put("displayName","Refreshed model $count")
                    if(count>=3)models.getJSONObject(0).put("supportedReasoningEfforts",org.json.JSONArray().put(JSONObject().put("reasoningEffort","medium")))
                }
                val response=json(JSONObject().put("models",models).toString())
                return if(testName.methodName=="modelListRecoversAfterFailureAndSlowReplyWithoutReconnecting")response.setBodyDelay(11,java.util.concurrent.TimeUnit.SECONDS) else if(reconnectFixture&&count>1)response.setBodyDelay(1200,java.util.concurrent.TimeUnit.MILLISECONDS) else response
            }
            if(path.substringBefore('?' )=="/api/usage"){
                val delay=usageDelayMs;usageQueries.add(r.path.orEmpty())
                if(stalledUsageThread.isNotBlank()&&r.requestUrl!!.queryParameter("threadId")==stalledUsageThread)return MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE)
                if(delay>0)Thread.sleep(delay)
                if(testName.methodName=="usageRefreshFollowsTheModelSelectedDuringAnInFlightRead")return json(JSONObject().put("requestedModel",r.requestUrl!!.queryParameter("model")).put("tokens",JSONObject().put("total",12345)).toString())
                if(quotaFixture.isNotBlank())return json(quotaFixture)
                val now=System.currentTimeMillis()
                return json("""{"quota":{"plan":"pro","stale":false,"windows":[{"name":"Codex","durationMins":10080,"remainingPercent":77,"resetsAt":1900000000}]},"quotaTrend":[{"at":${now-3600000},"name":"Codex","durationMins":300,"remainingPercent":90},{"at":${now-1800000},"name":"Codex","durationMins":10080,"remainingPercent":78},{"at":$now,"name":"Codex","durationMins":10080,"remainingPercent":77}],"tokens":{"total":12345,"input":10000,"cached":5000,"output":2345,"reasoning":345,"last":1200,"contextWindow":128000}}""")
            }
            if(path.endsWith("/compact")&&r.method=="POST"){compactRequests.incrementAndGet();return json("{}")}
            if(path.endsWith("/events")){if(historyDelayMs>0)Thread.sleep(historyDelayMs);val count=r.requestUrl!!.queryParameter("turns")?.toIntOrNull()?:-1;historyCounts.add(count);val oldest=count>20&&oldestHistory.isNotEmpty();val expanded=count>10&&olderHistory.isNotEmpty();if(expanded&&olderDelayMs>0)Thread.sleep(olderDelayMs);return json("""{"status":"$historyStatus","hasMore":${historyMore&&(!expanded||oldestHistory.isNotEmpty()&&!oldest)},"events":${if(oldest)oldestHistory else if(expanded)olderHistory else history}}""")}
            if(path.endsWith("/queue")&&r.method=="POST"){val body=JSONObject(r.body.readUtf8());queue="""[{"id":"q","text":"${body.getString("text")}","status":"queued"}]""";return json("{}")}
            if(path.contains("/queue/")&&path.endsWith("/restore/complete")&&r.method=="POST"){
                restoreCompleteRequests.incrementAndGet()
                if(failRestoreComplete)return MockResponse().setResponseCode(503).setBody("""{"error":"恢复确认暂未送达"}""")
                queueDrafts="[]";return json("{}")
            }
            if(path.contains("/queue/")&&path.endsWith("/restore")&&r.method=="POST"){
                restoreRequests.incrementAndGet()
                if(queueDrafts=="[]"){
                    val item=org.json.JSONArray(queue).getJSONObject(0).put("status","editing")
                    queueDrafts=org.json.JSONArray().put(item).toString();queue="[]"
                }
                if(failRestoreResponse)return MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AFTER_REQUEST)
                return json(JSONObject().put("message",org.json.JSONArray(queueDrafts).getJSONObject(0)).toString())
            }
            if(path.endsWith("/retry")&&r.method=="POST"){queue="[]";return json("{}")}
            if(path.endsWith("/steer")&&r.method=="POST"){steerRequests.incrementAndGet();queue="[]";return json("{}")}
            if(path.contains("/queue/")&&r.method=="DELETE"){
                if(testName.methodName=="queueCancellationKeepsItsAcknowledgementAcrossAnOlderRead"){
                    if(queueCancelRequests.incrementAndGet()==1)releaseQueueCancel.await(15,java.util.concurrent.TimeUnit.SECONDS)
                    if(failQueueCancel)return MockResponse().setResponseCode(503).setBody("""{"error":"取消暂未成功，请重试"}""")
                    val rows=org.json.JSONArray(queue);val remaining=org.json.JSONArray()
                    for(i in 0 until rows.length())if(rows.getJSONObject(i).optString("id")!=path.substringAfterLast('/'))remaining.put(rows.getJSONObject(i))
                    queue=remaining.toString()
                }else queue="[]"
                return json("{}")
            }
            if(path.endsWith("/queue")){
                val snapshot=queue
                if(holdOldQueueRead.compareAndSet(true,false)){
                    oldQueueReadStarted.countDown()
                    releaseOldQueueRead.await(15,java.util.concurrent.TimeUnit.SECONDS)
                }
                return json("""{"canSteer":$queueCanSteer,"messages":$snapshot,"drafts":$queueDrafts}""")
            }
            return json("{}")
        }}
        server.start()
        val address=server.url("/").toString().trimEnd('/')
        ui.runOnUiThread {vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>());vm.connect(address,"test")}
        val registry=object:androidx.activity.result.ActivityResultRegistry(){
            override fun <I,O> onLaunch(requestCode:Int,contract:androidx.activity.result.contract.ActivityResultContract<I,O>,input:I,options:androidx.core.app.ActivityOptionsCompat?){
                val intent=contract.createIntent(application,input)
                Assert.assertEquals(android.content.Intent.ACTION_CREATE_DOCUMENT,intent.action)
                Assert.assertEquals("image/png",intent.type)
                savePickerRequests++
                dispatchResult(requestCode,android.app.Activity.RESULT_OK,android.content.Intent().setData(saveTarget))
            }
        }
        val owner=object:androidx.activity.result.ActivityResultRegistryOwner{override val activityResultRegistry=registry}
        ui.setContent{androidx.compose.runtime.CompositionLocalProvider(androidx.activity.compose.LocalActivityResultRegistryOwner provides owner){NativeApp(displayedVm.value?:vm)}}
        ui.waitUntil(15000){vm.state.connected&&vm.state.threads.isNotEmpty()}
    }
    @After fun cleanup(){releaseAccountPreview.countDown();releaseGoalSave.countDown();releaseInterrupt.countDown();releaseUpload.countDown();releaseFullImage.countDown();releaseOldQueueRead.countDown();releaseQueueCancel.countDown();ui.runOnUiThread{vm.disconnect()};server.shutdown()}
    @Test fun imageBatchKeepsSendingLockedBeyondEightImages(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val file=java.io.File(context.cacheDir,"batch-test.jpg").apply{writeBytes(byteArrayOf(1,2,3))}
        val uri=android.net.Uri.fromFile(file)
        try {
            ui.runOnUiThread{vm.uploadImages(List(9){uri})}
            ui.waitUntil(10000){uploadCount.get()==2&&vm.state.images.size==1}
            Assert.assertTrue(vm.state.uploading)
            ui.runOnUiThread{vm.draft("等待全部图片");vm.send()}
            Assert.assertTrue(requests.isEmpty())
            releaseUpload.countDown()
            ui.waitUntil(10000){!vm.state.uploading}
            Assert.assertEquals(9,vm.state.images.size)
            ui.runOnUiThread{vm.send()}
            ui.waitUntil(10000){requests.isNotEmpty()}
            Assert.assertEquals(9,requests.last().getJSONArray("images").length())
        } finally {file.delete()}
    }
    @Test fun cachedConversationAppearsBeforeBackgroundRefresh(){
        historyStatus="completed";history="""[{"type":"message.delta","threadId":"t","eventId":"cached-a","text":"缓存中的 A 正文"}]"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"));vm.draft("A 的草稿")}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="cached-a"}&&!vm.state.loadingHistory}
        history="[]";ui.runOnUiThread{vm.openThread(ThreadRecord("b"))}
        ui.waitUntil(10000){vm.state.threadId=="b"&&!vm.state.loadingHistory}
        historyDelayMs=1800;history="""[{"type":"message.delta","threadId":"t","eventId":"fresh-a","text":"后台更新后的 A 正文"}]"""
        ui.runOnUiThread{
            vm.openThread(ThreadRecord("t"))
            Assert.assertTrue(vm.state.events.any{it.eventId=="cached-a"})
            Assert.assertFalse(vm.state.loadingHistory)
            Assert.assertEquals("A 的草稿",vm.state.draft)
        }
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="fresh-a"}}
        Assert.assertFalse(vm.state.events.any{it.eventId=="cached-a"})
    }
    @Test fun compressedUsageShowsContextAndLifetimeSeparately(){
        quotaFixture="""{"quota":{"windows":[]},"quotaTrend":[],"tokens":{"total":1716876430,"input":1712825353,"cached":1684242176,"output":4051077,"reasoning":1580606,"last":null,"context":30920,"contextWindow":380000,"contextPercent":8.1368,"contextState":"compacted"}}"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.onNodeWithContentDescription("会话菜单").performClick();ui.onNodeWithText("上下文与连接").performClick()
        ui.waitUntil(10000){vm.state.usage?.optJSONObject("tokens")?.optLong("context")==30920L&&!vm.state.usageLoading}
        ui.onNodeWithText("30.9K / 380K").assertIsDisplayed()
        ui.onNodeWithTag("sessionUsageSection").performScrollTo().assertIsDisplayed()
        ui.onNodeWithTag("sessionDetailsToggle").performScrollTo().performClick()
        ui.onNodeWithTag("usageToken:total").assertTextEquals("17.2亿")
        screenshot("native-compressed-token-usage.png")
        androidx.test.platform.app.InstrumentationRegistry.getArguments().getString("visualHoldMs")?.toLongOrNull()?.coerceIn(0,30000)?.let{android.os.SystemClock.sleep(it)}
        ui.onNodeWithContentDescription("关闭").performClick()
    }
    @Test fun usageShowsQuotaAndTokens(){
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("设置").performClick();ui.onNodeWithTag("settings:quota").performClick()
        ui.waitUntil(10000){vm.state.usage!=null}
        // The one-hour-old fixture can fall on yesterday when tests run near midnight.
        ui.onNodeWithText("近 7 天").performClick()
        ui.waitUntil(10000){vm.state.usageDays==7&&vm.state.usage!=null&&!vm.state.usageLoading}
        ui.onAllNodesWithText("77%").onFirst().assertIsDisplayed()
        ui.onAllNodesWithText("7d 额度").onFirst().assertIsDisplayed()
        ui.onNodeWithText("配额剩余趋势").assertIsDisplayed()
        ui.onNodeWithTag("quota-trend").performScrollTo()
        ui.onNodeWithTag("quota-trend").performScrollTo().performTouchInput{down(Offset(width.toFloat()-1,centerY));advanceEventTime(100)}
        ui.onNodeWithTag("quotaSelection").assertIsDisplayed()
        ui.onNodeWithText("7d 额度 · 剩余 77%",substring=true).assertExists()
        screenshot("native-quota-selected.png")
        ui.onNodeWithTag("quota-trend").performTouchInput{up()}
        ui.onNodeWithTag("quotaSelection").assertDoesNotExist()
        ui.onNodeWithTag("sessionUsageSection").assertDoesNotExist()
        ui.onNodeWithContentDescription("返回").performClick()
    }
    @Test fun desktopAndGatewayPermissionsOfferPhoneActions(){
        approvalsJson="""[{"id":"desktop:1:7-item-7","threadId":"t","status":"pending","approvalType":"command","title":"运行命令","detail":"确认执行桌面端命令"}]"""
        history="""[{"type":"approval.requested","threadId":"t","eventId":"desktop-approval:t:call","approvalId":"desktop:1:7-item-7","approvalType":"command","title":"运行命令","detail":"确认执行桌面端命令"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.approvalId=="desktop:1:7-item-7"}}
        ui.onNodeWithText("需要你的确认").assertIsDisplayed()
        ui.onNodeWithText("确认执行桌面端命令").assertIsDisplayed()
        ui.onAllNodesWithText("允许").onLast().assertIsDisplayed()
        ui.onAllNodesWithText("拒绝").onLast().assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        approvalsJson="""[{"id":"approval-1","threadId":"t","status":"pending","approvalType":"command","title":"运行命令","detail":"确认执行此命令"}]"""
        history="""[{"type":"approval.requested","threadId":"t","eventId":"gateway-approval:t:1","approvalId":"approval-1","approvalType":"command","title":"运行命令","detail":"确认执行此命令"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.approvalId=="approval-1"}}
        ui.onNodeWithText("需要你的确认").assertIsDisplayed()
    }
    @Test fun approvalResultsShowBothDecisionsAndRestoreFromGateway(){
        val app=ApplicationProvider.getApplicationContext<Application>()
        fun approvals(accepted:Boolean=false,declined:Boolean=false)=org.json.JSONArray()
            .put(JSONObject().put("id","allow-result").put("threadId","t").put("status",if(accepted)"accepted" else "pending").put("approvalType","command").put("title","读取文件").put("detail","批准请求说明"))
            .put(JSONObject().put("id","deny-result").put("threadId","t").put("status",if(declined)"declined" else "pending").put("approvalType","command").put("title","删除文件").put("detail","拒绝请求说明")).toString()
        approvalsJson=approvals()
        history="""[{"type":"approval.requested","threadId":"t","eventId":"approval-allow","approvalId":"allow-result","approvalType":"command","title":"读取文件","detail":"批准请求说明"},{"type":"approval.requested","threadId":"t","eventId":"approval-deny","approvalId":"deny-result","approvalType":"command","title":"删除文件","detail":"拒绝请求说明"}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.pendingApprovals.size==2}
        ui.onAllNodesWithText("拒绝").onLast().performClick()
        ui.waitUntil(5000){vm.state.approvalResults[nativeApprovalKey("t","deny-result")]=="declined"}
        approvalsJson=approvals(declined=true)
        ui.onAllNodesWithText("允许").onLast().performClick()
        ui.waitUntil(5000){vm.state.approvalResults[nativeApprovalKey("t","allow-result")]=="accepted"}
        approvalsJson=approvals(accepted=true,declined=true)
        ui.onNodeWithTag("approvalResult:allow-result",useUnmergedTree=true).assertTextEquals("已批准")
        ui.onNodeWithTag("approvalResult:deny-result",useUnmergedTree=true).assertTextEquals("已拒绝")
        screenshot("native-approval-results.png")
        lateinit var restored:NativeViewModel
        ui.runOnUiThread{vm.disconnect();restored=NativeViewModel(app);restored.connect(server.url("/").toString().trimEnd('/'),"test")}
        try{
            ui.waitUntil(10000){restored.state.connected}
            ui.runOnUiThread{restored.openThread(ThreadRecord("t"))}
            ui.waitUntil(10000){!restored.state.loadingHistory&&restored.state.approvalResults.size>=2}
            Assert.assertEquals("accepted",restored.state.approvalResults[nativeApprovalKey("t","allow-result")])
            Assert.assertEquals("declined",restored.state.approvalResults[nativeApprovalKey("t","deny-result")])
        }finally{ui.runOnUiThread{restored.disconnect()}}
    }
    @Test fun answeredDesktopQuestionStaysClosedAcrossStaleSnapshotsAndRecreation(){
        val question=JSONObject().put("type","approval.requested").put("threadId","t").put("eventId","desktop-question:t:call-test").put("approvalId","desktop-question:call-test").put("approvalType","question").put("title","需要你的回答").put("detail",JSONObject().put("questions",org.json.JSONArray().put(JSONObject().put("id","0").put("question","是否继续处理"))).toString())
        history=org.json.JSONArray().put(question).toString()
        approvalsJson=org.json.JSONArray().put(JSONObject().put("id","desktop-question:call-test").put("threadId","t").put("status","pending").put("approvalType","question").put("title","需要你的回答").put("detail",question.getString("detail"))).toString()
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.pendingApprovals.isNotEmpty()}
        val answer=JSONObject().put("type","user.message").put("threadId","t").put("eventId","desktop-answer").put("questionReplyId","call-test").put("text","继续")
        chatSockets.last().send(answer.toString())
        ui.waitUntil(10000){vm.state.approvalResults[nativeApprovalKey("t","desktop-question:call-test")]=="answered"&&vm.state.pendingApprovals.isEmpty()}
        ui.runOnUiThread{vm.retryHistory()}
        ui.waitUntil(10000){!vm.state.historySyncing}
        Assert.assertTrue("已回答问题不能被旧待答快照恢复",vm.state.pendingApprovals.isEmpty())
        Assert.assertTrue("desktop-question:call-test" in vm.state.approvals)
        history=org.json.JSONArray().put(question).put(answer).toString()
        lateinit var restored:NativeViewModel
        ui.runOnUiThread{vm.disconnect();restored=NativeViewModel(ApplicationProvider.getApplicationContext());displayedVm.value=restored;restored.connect(server.url("/").toString().trimEnd('/'),"test")}
        try{
            ui.waitUntil(10000){restored.state.connected}
            ui.runOnUiThread{restored.openThread(ThreadRecord("t"))}
            ui.waitUntil(10000){!restored.state.historySyncing&&restored.state.approvalResults[nativeApprovalKey("t","desktop-question:call-test")]=="answered"}
            Assert.assertTrue(restored.state.pendingApprovals.isEmpty())
            ui.onNodeWithText("需要你的回答").assertDoesNotExist()
        }finally{ui.runOnUiThread{restored.disconnect()}}
    }
    @Test fun editedBlockedGoalContinuesDespiteStaleRunningAndUnrelatedBusyWork(){
        goalStatus="blocked";historyStatus="running"
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.threads.first().goal?.status=="blocked"}
        ui.onNodeWithTag("goalExpand").performClick()
        ui.onNodeWithText("编辑").performClick()
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("goalEditor"))).performTextReplacement("修改后的受阻目标")
        ui.onNodeWithTag("goalSave").performClick()
        ui.waitUntil(10000){!vm.goalWorkBusy("t")&&vm.state.threads.first().goal?.objective=="修改后的受阻目标"}
        Assert.assertTrue(vm.state.running)
        lateinit var unrelated:kotlinx.coroutines.Job
        ui.runOnUiThread{unrelated=vm.work{kotlinx.coroutines.awaitCancellation()}}
        try{
            ui.waitUntil(10000){vm.currentWorkBusy()}
            ui.onNodeWithTag("goalContinue").assertIsEnabled().performClick()
            ui.waitUntil(10000){goalContinueBody.get()!=null}
            Assert.assertEquals("修改后的受阻目标",goalObjective)
            ui.waitUntil(10000){vm.state.threads.first().goal?.status=="active"}
            Assert.assertEquals("修改后的受阻目标",vm.state.threads.first().goal?.objective)
        }finally{unrelated.cancel()}
    }
    @Test fun goalEditorKeepsFailedDraftAndWaitsForRetryAcknowledgement(){
        goalStatus="paused";historyStatus="completed";failGoalSave=true
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.threads.first().goal!=null}
        ui.onNodeWithTag("goalExpand").performClick()
        ui.onNodeWithText("编辑").performClick()
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("goalEditor"))).performTextReplacement("失败后仍保留这个目标")
        ui.onNodeWithTag("goalSave").performClick()
        ui.waitUntil(10000){goalSaveRequests.get()==1&&!vm.currentWorkBusy()&&ui.onAllNodesWithTag("goalSaveError").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithText("编辑目标").assertIsDisplayed()
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("goalEditor"))).assertTextEquals("失败后仍保留这个目标")
        ui.onNodeWithTag("goalSaveError").assertTextContains("电脑暂时无法保存目标",substring=true)
        Assert.assertEquals("核对运行目标",vm.state.threads.first().goal?.objective)
        screenshot("native-goal-save-error-309.png")
        failGoalSave=false;holdGoalSave=true
        ui.onNodeWithTag("goalSave").performClick()
        ui.waitUntil(10000){goalSaveStarted.count==0L}
        ui.onNodeWithTag("goalSave").assertIsNotEnabled()
        ui.onNodeWithContentDescription("关闭").assertIsNotEnabled()
        ui.onNodeWithContentDescription("目标内容").assertIsNotEnabled()
        ui.onNodeWithTag("sheetDragHeader").performTouchInput{swipe(center,center+Offset(0f,320f),250)}
        ui.onNodeWithText("编辑目标").assertIsDisplayed()
        Assert.assertEquals(2,goalSaveRequests.get())
        releaseGoalSave.countDown()
        ui.waitUntil(10000){vm.state.threads.first().goal?.objective=="失败后仍保留这个目标"&&!vm.currentWorkBusy()}
        ui.onNodeWithText("编辑目标").assertDoesNotExist()
        Assert.assertEquals(2,goalSaveRequests.get())
    }
    @Test fun goalCommandFormKeepsTextWhenAcknowledgementIsMissing(){
        goalStatus="paused";historyStatus="completed";missingGoalSaveReply=true
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing}
        ui.onNodeWithTag("composer").performTextReplacement("/goal")
        ui.onNode(hasText("/goal") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("goalEditor"))).performTextReplacement("命令表单的目标草稿")
        ui.onNodeWithTag("goalSave").performClick()
        ui.waitUntil(10000){goalSaveRequests.get()==1&&!vm.currentWorkBusy()&&ui.onAllNodesWithTag("goalSaveError").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithText("会话目标").assertIsDisplayed()
        ui.onNodeWithTag("goalSaveError").assertTextContains("电脑未返回目标状态",substring=true)
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("goalEditor"))).assertTextEquals("命令表单的目标草稿")
        missingGoalSaveReply=false
        ui.onNodeWithTag("goalSave").performClick()
        ui.waitUntil(10000){vm.state.threads.first().goal?.objective=="命令表单的目标草稿"&&!vm.currentWorkBusy()}
        ui.onNodeWithText("会话目标").assertDoesNotExist()
        Assert.assertEquals(2,goalSaveRequests.get())
    }
    @Test fun goalEditorStaysAboveKeyboardWithHeaderAndSaveVisible(){
        goalStatus="paused";historyStatus="completed"
        ui.runOnUiThread{androidx.core.view.WindowCompat.setDecorFitsSystemWindows(ui.activity.window,false);vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.threads.first().goal!=null}
        ui.onNodeWithTag("goalExpand").performClick()
        ui.onNodeWithText("编辑").performClick()
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("goalEditor"))).performClick().performTextReplacement("继续核对输入框位置")
        ui.waitUntil(10000){ui.activity.window.decorView.rootWindowInsets?.isVisible(android.view.WindowInsets.Type.ime())==true}
        ui.onNodeWithText("编辑目标").assertIsDisplayed()
        ui.onNodeWithText("保存").assertIsDisplayed()
        val panel=ui.onNodeWithTag("sheetPanel").fetchSemanticsNode().boundsInWindow
        val insets=ui.activity.window.decorView.rootWindowInsets
        val keyboardTop=ui.activity.window.decorView.height-insets.getInsets(android.view.WindowInsets.Type.ime()).bottom
        Assert.assertTrue("编辑层不能越出状态栏",panel.top>=insets.getInsets(android.view.WindowInsets.Type.statusBars()).top)
        Assert.assertTrue("保存按钮应在键盘上方",panel.bottom<=keyboardTop+1)
        Assert.assertEquals("弹层底部应贴近键盘",8f*ui.activity.resources.displayMetrics.density,keyboardTop-panel.bottom,2f)
        screenshot("native-goal-editor-keyboard-308.png")
        ui.onNodeWithText("保存").performClick()
        ui.waitUntil(10000){vm.state.threads.first().goal?.objective=="继续核对输入框位置"}
        ui.onNodeWithText("编辑目标").assertDoesNotExist()
    }
    @Test fun desktopAsyncQuestionOpensOnPhoneAndCanBeAnswered(){
        val detail=JSONObject().put("questions",org.json.JSONArray().put(JSONObject().put("id","0").put("question","选择连接方式").put("options",org.json.JSONArray().put(JSONObject().put("label","内网")).put(JSONObject().put("label","公网"))))).toString()
        approvalsJson=org.json.JSONArray().put(JSONObject().put("id","desktop-question:call-test").put("threadId","t").put("status","pending").put("approvalType","question").put("title","需要你的回答").put("detail",detail)).toString()
        history=org.json.JSONArray().put(JSONObject().put("type","approval.requested").put("threadId","t").put("eventId","desktop-question:t:call-test").put("approvalId","desktop-question:call-test").put("approvalType","question").put("title","需要你的回答").put("detail",detail)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.pendingApprovals.any{it.approvalId=="desktop-question:call-test"}}
        ui.onAllNodesWithText("选择连接方式").onLast().assertIsDisplayed()
        ui.onNodeWithTag("sheetDragHeader").performTouchInput{swipe(center,center+Offset(0f,320f),350)}
        ui.waitUntil(5000){ui.onAllNodesWithTag("sheetDragHeader").fetchSemanticsNodes().isEmpty()}
        ui.onNodeWithText("选择连接方式").performClick()
        ui.onAllNodesWithText("公网").onLast().performClick()
        ui.onNodeWithTag("questionAnswer:0").performTextReplacement("使用公网连接")
        ui.onNodeWithTag("questionAnswer:0").assertTextEquals("使用公网连接")
        screenshot("native-question-inplace.png")
        ui.onAllNodesWithText("提交回答").onLast().performScrollTo().performClick()
        ui.waitUntil(10000){"desktop-question:call-test" in vm.state.approvals}
    }
    @Test fun pendingApprovalFromGatewayOpensWithoutTimelineEvent(){
        approvalsJson="""[{"id":"desktop:7:9-item-9","threadId":"t","status":"pending","approvalType":"file","title":"允许文件变更","detail":"手机可处理此审批"}]"""
        history="[]"
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.pendingApprovals.any{it.approvalId=="desktop:7:9-item-9"}}
        ui.onNodeWithText("手机可处理此审批").assertIsDisplayed()
        ui.onAllNodesWithText("允许").onLast().assertIsDisplayed()
    }
    @Test fun slashCommandsControlModesWithoutSendingLiteralCommands(){
        ui.onNodeWithTag("composer").performTextInput("/he")
        val commandHeight=ui.onNodeWithTag("slashCommands",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot.height
        val density=ApplicationProvider.getApplicationContext<Application>().resources.displayMetrics.density
        Assert.assertTrue("命令面板不应占据过多聊天空间",commandHeight<=168f*density)
        ui.onNodeWithText("/help").performClick()
        ui.onNodeWithText("命令").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        Assert.assertTrue(requests.isEmpty())
        ui.onNodeWithTag("composer").performTextInput("/plan")
        ui.onNode(hasText("/plan") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.onNodeWithText("计划模式 ×").assertIsDisplayed()
        ui.onNodeWithTag("composer").performTextInput("/fast")
        ui.onNode(hasText("/fast") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.onNodeWithText("快速模式 ×").assertIsDisplayed()
        ui.onNodeWithTag("composer").performTextInput("先做计划")
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){requests.isNotEmpty()&&!vm.state.sending}
        Assert.assertEquals("plan",requests[0].getString("mode"))
        Assert.assertTrue(requests[0].getBoolean("fast"))
        ui.runOnIdle{
            Assert.assertEquals("default",vm.state.nextMode)
            Assert.assertNull(vm.pendingMessage())
            Assert.assertEquals("outgoing:"+requests[0].getString("requestId"),vm.outgoingKey(vm.state.events.first{it.type=="user.message"}))
        }
    }
    @Test fun nativeSendQueueAndModelDialog(){
        ui.onNodeWithTag("composer").performTextInput("原生发送")
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){requests.isNotEmpty()&&vm.state.running}
        Assert.assertEquals("thread.start",requests[0].getString("type"))
        Assert.assertFalse(requests[0].has("projectPath"))
        val modelBefore=ui.onNodeWithText("Test model · 中").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithContentDescription("停止任务").assertExists()
        ui.onNodeWithTag("composer").performTextInput("排队消息")
        val sendBounds=ui.onNodeWithContentDescription("加入队列").fetchSemanticsNode().boundsInRoot
        val modelAfter=ui.onNodeWithText("Test model · 中").fetchSemanticsNode().boundsInRoot
        val rootBounds=ui.onRoot().fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("发送按钮溢出屏幕",sendBounds.right<=rootBounds.right)
        ui.onNodeWithContentDescription("停止任务").assertDoesNotExist()
        Assert.assertEquals("输入时模型选择器宽度变化",modelBefore.width,modelAfter.width,2f)
        ui.onNodeWithContentDescription("加入队列").performClick()
        ui.waitUntil(10000){vm.state.queue.isNotEmpty()}
        ui.onNodeWithText("排队消息").assertIsDisplayed()
        screenshot("native-queue.png")
        ui.onNodeWithContentDescription("待发消息操作").performClick()
        screenshot("native-056-queue-menu.png")
        ui.onNodeWithText("取消发送").performClick()
        ui.waitUntil(10000){vm.state.queue.isEmpty()}
        ui.onNodeWithText("Test model · 中").performClick()
        ui.onNodeWithText("模型").assertIsDisplayed()
        ui.onNodeWithText("思考强度 · 中").assertIsDisplayed()
        ui.onNodeWithText("搜索模型").assertDoesNotExist()
        Assert.assertFalse("模型弹层外层不应滚动",ui.onNodeWithTag("modernDropdown",useUnmergedTree=true).fetchSemanticsNode().config.contains(androidx.compose.ui.semantics.SemanticsActions.ScrollBy))
        Assert.assertTrue("模型列表应保留滚动",ui.onNodeWithTag("modelList",useUnmergedTree=true).fetchSemanticsNode().config.contains(androidx.compose.ui.semantics.SemanticsActions.ScrollBy))
        screenshot("native-model-compact.png")
        val sliderBounds=ui.onNodeWithTag("effortSlider").fetchSemanticsNode().boundsInRoot
        ui.onNodeWithTag("effortSlider").performTouchInput{click(Offset(sliderBounds.width*0.92f,sliderBounds.height/2f))}
        ui.waitUntil(5000){vm.state.effort=="high"}
        ui.onNodeWithText("思考强度 · 高").assertIsDisplayed()
        ui.onNodeWithText("权限与更多设置").performClick()
        ui.onNodeWithText("模型与思考强度").assertIsDisplayed()
        screenshot("native-settings-oneui.png")
        ui.onNodeWithContentDescription("选择模型").performClick()
        ui.onNodeWithText("搜索模型").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("新会话").performClick()
        ui.waitUntil(5000){vm.state.threadId.isEmpty()}
        ui.onNodeWithText("今天想完成什么？").assertIsDisplayed()
        screenshot("native-home-050.png")
    }
    @Test fun idleQueuedMessageSendsWithoutEditingOrOpeningConnection(){
        historyStatus="completed"
        queue="""[{"id":"idle-queue","text":"继续检查","status":"queued","canSteer":false}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.running&&vm.state.queue.isNotEmpty()}
        ui.onNodeWithContentDescription("待发消息操作").performClick()
        ui.onNodeWithText("改为引导").assertDoesNotExist()
        ui.onNodeWithText("发送下一条").performClick()
        ui.waitUntil(10000){vm.state.queue.isEmpty()&&!vm.state.workBusy}
        Assert.assertEquals("",vm.state.draft)
        ui.onNodeWithText("连接电脑",useUnmergedTree=true).assertDoesNotExist()
    }
    @Test fun questionAnswersQuoteEachOriginalQuestion(){
        historyStatus="completed"
        history="""[{"type":"user.message","threadId":"t","eventId":"quoted-answer","text":"已登录，可以检查\n仅用户端","questionReplies":[{"question":"用户端登录已过期，请登录后告诉我。","answer":"已登录，可以检查"},{"question":"这次检查哪些页面？","answer":"仅用户端"}]}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.questionReplies.size==2}}
        ui.onNodeWithText("用户端登录已过期，请登录后告诉我。").assertIsDisplayed()
        ui.onNodeWithText("这次检查哪些页面？").assertIsDisplayed()
        ui.onNodeWithText("已登录，可以检查").assertIsDisplayed()
        ui.onNodeWithText("仅用户端").assertIsDisplayed()
        screenshot("native-answer-quotes.png")
    }
    @Test fun queuedEditSurvivesLostResponseAndRecreatedViewModel(){
        historyStatus="completed"
        queue="""[{"id":"lost-edit","text":"断线时的原消息","status":"queued","images":[{"id":"pixel.png","name":"图片.png"}],"files":[{"id":"123e4567-e89b-12d3-a456-426614174000","name":"clip.mp4","mime":"video/mp4","size":11}]}]"""
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&vm.state.queue.size==1}
        ui.onNodeWithTag("composer").performTextInput("现有草稿")
        failRestoreResponse=true
        ui.runOnUiThread{
            vm.restoreQueued(vm.state.queue.single())
            Assert.assertEquals("断线时的原消息\n\n现有草稿",vm.state.draft)
            Assert.assertEquals("pixel.png",vm.state.images.single().id)
            Assert.assertEquals("clip.mp4",vm.state.uploads.single().name)
        }
        ui.waitUntil(15000){vm.state.queueDrafts.size==1&&!vm.state.workBusy}
        Assert.assertEquals("断线时的原消息\n\n现有草稿",vm.state.draft)
        Assert.assertTrue(vm.queuedRestoreNotice().contains("撤回未确认"))
        Assert.assertEquals(0,restoreCompleteRequests.get())
        ui.onNodeWithText("继续编辑").assertExists()

        fun recreate(){
            ui.runOnUiThread{
                vm.disconnect();vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
                displayedVm.value=vm;vm.connect(server.url("/").toString().trimEnd('/'),"test")
            }
            ui.waitUntil(15000){vm.state.connected&&vm.state.threads.isNotEmpty()}
            ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
            ui.waitUntil(15000){!vm.state.historySyncing&&vm.state.queueDrafts.size==1}
        }
        failRestoreResponse=false;failRestoreComplete=true
        recreate()
        ui.onNodeWithText("继续编辑").performClick()
        ui.waitUntil(15000){restoreCompleteRequests.get()==1&&!vm.state.workBusy}
        Assert.assertEquals("断线时的原消息\n\n现有草稿",vm.state.draft)
        Assert.assertEquals("pixel.png",vm.state.images.single().id)
        Assert.assertEquals("clip.mp4",vm.state.uploads.single().name)
        ui.onNodeWithTag("composer").performTextReplacement("断线时的原消息\n\n现有草稿，随后补充")

        recreate()
        Assert.assertEquals("断线时的原消息\n\n现有草稿，随后补充",vm.state.draft)
        failRestoreComplete=false
        ui.onNodeWithText("继续编辑").performClick()
        ui.waitUntil(15000){restoreCompleteRequests.get()==2&&!vm.state.workBusy&&vm.state.queueDrafts.isEmpty()}
        Assert.assertEquals("断线时的原消息\n\n现有草稿，随后补充",vm.state.draft)
        Assert.assertEquals("pixel.png",vm.state.images.single().id)
        Assert.assertEquals("clip.mp4",vm.state.uploads.single().name)
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun queuedEditRestoresTextImagesAndFilesToComposer(){
        queue="""[{"id":"queued-edit","text":"原队列消息","status":"queued","images":[{"id":"pixel.png","name":"图片.png"}],"files":[{"id":"123e4567-e89b-12d3-a456-426614174000","name":"clip.mp4","mime":"video/mp4","size":11}]}]"""
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.queue.any{it.id=="queued-edit"}}
        ui.onNodeWithTag("composer").performTextInput("现有草稿")
        ui.onNodeWithContentDescription("待发消息操作").performClick()
        ui.onNodeWithText("编辑消息").performClick()
        ui.waitUntil(10000){vm.state.queue.isEmpty()&&vm.state.draft.contains("原队列消息")}
        Assert.assertEquals("原队列消息\n\n现有草稿",vm.state.draft)
        Assert.assertEquals("pixel.png",vm.state.images.single().id)
        Assert.assertEquals("clip.mp4",vm.state.uploads.single().name)
        ui.onNodeWithText("clip.mp4").assertIsDisplayed()
        ui.onNodeWithContentDescription("移除文件").performClick()
        Assert.assertTrue(vm.state.uploads.isEmpty())
        ui.onNodeWithText("编辑待发消息").assertDoesNotExist()
    }
    @Test fun pauseResponseFailureRefreshesGoalWithoutStoppingTurn(){
        goalStatus="active"
        ui.runOnUiThread{vm.connect(vm.state.address,"test")}
        ui.waitUntil(15000){vm.state.threads.firstOrNull()?.goal?.status=="active"}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.threadId=="t"&&!vm.state.loadingHistory}
        ui.onNodeWithTag("goalExpand").performClick()
        ui.onNodeWithText("暂停").performClick()
        ui.waitUntil(15000){vm.state.threads.firstOrNull()?.goal?.status=="paused"&&!vm.state.workBusy}
        Assert.assertTrue(vm.state.running)
        ui.onNodeWithText("停止当前轮次").assertDoesNotExist()
        ui.onNodeWithText("继续").assertIsNotEnabled()
        Assert.assertEquals("paused",vm.state.threads.firstOrNull()?.goal?.status)
        Assert.assertTrue(vm.state.running)
        Assert.assertEquals(1,goalPauseRequests.get())
    }
    @Test fun activeGoalTimeTicksAndPausedPanelStaysCompact(){
        goalStatus="active"
        ui.runOnUiThread{vm.connect(vm.state.address,"test")}
        ui.waitUntil(15000){vm.state.threads.firstOrNull()?.goal?.timeUsedSeconds==15001L}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.running&&!vm.state.loadingHistory}
        fun shown()=ui.onNodeWithTag("goalRunTime",useUnmergedTree=true).fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.ContentDescription].first()
        val before=shown()
        ui.waitUntil(5000){shown()!=before}
        fun assertHeaderInkCentres(){
            val centres=listOf("goalHeaderIcon","goalHeaderTitle","goalRunTime","goalHeaderStatus").map{tag->
                val node=ui.onNodeWithTag(tag,useUnmergedTree=true)
                val pixels=node.captureToImage().toPixelMap()
                var top=pixels.height;var bottom=-1
                for(y in 0 until pixels.height)for(x in 0 until pixels.width){
                    val pixel=pixels[x,y]
                    if(pixel.alpha>0.8f&&maxOf(pixel.red,pixel.green,pixel.blue)<0.7f){top=minOf(top,y);bottom=maxOf(bottom,y)}
                }
                Assert.assertTrue("$tag 应有可见字形或图标",bottom>=top)
                node.fetchSemanticsNode().boundsInRoot.top+(top+bottom)/2f
            }
            Assert.assertTrue("目标栏可见字形与图标中心应对齐：$centres",centres.max()-centres.min()<=2f)
        }
        assertHeaderInkCentres()
        screenshot("native-goal-collapsed.png")
        ui.onNodeWithTag("goalExpand").performClick()
        assertHeaderInkCentres()
        screenshot("native-goal-compact-running.png")
        val height=ui.onNodeWithTag("goalChip").fetchSemanticsNode().boundsInRoot.height/ui.activity.resources.displayMetrics.density
        Assert.assertTrue("目标面板应保持紧凑，实际 ${height}dp",height<=130f)
        ui.onNodeWithText("暂停").performClick()
        ui.waitUntil(10000){vm.state.threads.first().goal?.status=="paused"&&!vm.state.workBusy}
        val paused=shown();val start=android.os.SystemClock.elapsedRealtime()
        ui.waitUntil(4000){android.os.SystemClock.elapsedRealtime()-start>=1500}
        Assert.assertEquals(paused,shown())
        Assert.assertTrue(vm.state.running)
        ui.onNodeWithTag("goalExpand").performClick()
        assertHeaderInkCentres()
        screenshot("native-goal-paused.png")
    }
    @Test fun activeGoalAppearsInDrawerAndCurrentThread(){
        goalStatus="active"
        val address=vm.state.address
        ui.runOnUiThread{vm.connect(address,"test")}
        ui.waitUntil(15000){vm.state.threads.firstOrNull()?.goal?.status=="active"}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("进行中").assertIsDisplayed()
        ui.onNodeWithText("核对运行目标").performClick()
        ui.waitUntil(10000){vm.state.threadId=="t"}
        ui.onNodeWithTag("goalChip").assertIsDisplayed()
        ui.onNodeWithTag("goalClose").assertDoesNotExist()
        ui.onNodeWithContentDescription("关闭目标").assertDoesNotExist()
        val goal=ui.onNodeWithTag("goalChip").fetchSemanticsNode().boundsInRoot
        val composer=ui.onNodeWithTag("composer").fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("目标应位于输入框上方",goal.bottom<=composer.top)
        ui.onNodeWithTag("goalExpand").performClick()
        ui.onNodeWithTag("goalObjective",useUnmergedTree=true).assertIsDisplayed()
        ui.onNodeWithTag("goalClose").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭目标").assertIsDisplayed()
        ui.onNodeWithText("暂停").performClick()
        ui.waitUntil(10000){vm.state.threads.first().goal?.status=="paused"&&vm.state.running&&!vm.state.workBusy}
        historyStatus="interrupted"
        ui.runOnUiThread{vm.draft("继续时保留这条草稿");vm.viewModelScope.launch{vm.refresh()}}
        ui.waitUntil(10000){!vm.state.running}
        val chosenModel=vm.state.model;val chosenEffort=vm.state.effort;val chosenPermission=vm.state.permission
        ui.onNodeWithTag("goalHeaderStatus",useUnmergedTree=true).assertTextEquals("已暂停")
        ui.onNodeWithText("继续").performClick()
        ui.waitUntil(10000){vm.state.threads.first().goal?.status=="active"&&vm.state.running}
        Assert.assertNotNull(goalContinueBody.get())
        Assert.assertEquals(chosenModel,goalContinueBody.get()?.optString("model"))
        Assert.assertEquals(chosenEffort,goalContinueBody.get()?.optString("effort"))
        Assert.assertEquals(chosenPermission,goalContinueBody.get()?.optString("permission"))
        Assert.assertEquals("继续时保留这条草稿",vm.state.draft)
        ui.onNodeWithTag("goalExpand").performClick()
        ui.waitUntil(5000){ui.onAllNodesWithTag("goalClose").fetchSemanticsNodes().isEmpty()}
        ui.onNodeWithTag("goalExpand").performClick()
        screenshot("native-goal-close-visible.png")
        ui.onNodeWithTag("goalClose").performClick()
        ui.waitUntil(10000){goalStatus=="complete"}
        ui.waitUntil(10000){ui.onAllNodesWithTag("goalChip").fetchSemanticsNodes().isEmpty()}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("核对运行目标").assertDoesNotExist()
        screenshot("native-goal-bottom.png")
    }
    @Test fun longPressThreadShowsRenameAndPin(){
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        val originalRow=ui.onNodeWithTag("threadRow:t").fetchSemanticsNode().id
        ui.onNodeWithTag("threadRow:t").performTouchInput{longClick()}
        ui.onNodeWithText("置顶").assertIsDisplayed()
        screenshot("native-thread-menu.png")
        ui.onNodeWithText("置顶").performClick()
        ui.waitUntil(10000){threadPinned}
        ui.waitForIdle()
        Assert.assertEquals("置顶移动应保留行与无障碍节点身份",originalRow,ui.onNodeWithTag("threadRow:t").fetchSemanticsNode().id)
        ui.onNodeWithTag("threadRow:t").performTouchInput{longClick()}
        ui.onNodeWithText("重命名").performClick()
        ui.onAllNodes(hasSetTextAction()).onLast().performTextReplacement("改名后的会话")
        ui.onNodeWithText("保存").performClick()
        ui.waitUntil(10000){threadTitle=="改名后的会话"}
    }
    @Test fun longHistoryRequestsOnlyInitialWindowAndLoadsMoreOnDemand(){
        historyMore=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.hasMoreHistory}
        Assert.assertTrue(historyCounts.contains(10))
        ui.onNodeWithText("查看更早记录").performClick()
        ui.waitUntil(10000){historyCounts.contains(20)}
    }
    @Test fun olderHistoryPrependsWithoutMovingTheVisibleMessage(){
        fun rows(start:Int,end:Int)=org.json.JSONArray().apply{for(i in start until end)put(JSONObject().put("type","user.message").put("threadId","t").put("text","分页消息 $i").put("eventId","page-$i"))}.toString()
        history=rows(40,60);olderHistory=rows(0,60);historyMore=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==20&&vm.state.hasMoreHistory}
        ui.waitForIdle()
        // Begin reading with a real gesture, then jump within the detached list.
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.waitForIdle()
        val top=ui.onNodeWithText("分页消息 40").fetchSemanticsNode().boundsInRoot.top
        ui.onNodeWithText("查看更早记录").performClick()
        ui.waitUntil(10000){vm.state.events.size==60&&!vm.state.loadingOlderHistory}
        ui.waitForIdle()
        Assert.assertEquals(top,ui.onNodeWithText("分页消息 40").fetchSemanticsNode().boundsInRoot.top,3f)
        Assert.assertEquals(60,vm.state.events.map{it.eventId}.distinct().size)
        ui.onNodeWithTag("messages").performScrollToIndex(39)
        ui.onNodeWithText("分页消息 39").assertIsDisplayed()
    }
    @Test fun desktopTurnDraftQueuesFromComposer(){
        queueCanSteer=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.running&&vm.state.canSteer&&vm.state.queue.isEmpty()}
        ui.onNodeWithTag("composer").performTextInput("现在先检查日志")
        ui.onNodeWithContentDescription("加入队列").performClick()
        ui.waitUntil(10000){vm.state.queue.isNotEmpty()&&!vm.state.sending}
        Assert.assertEquals("",vm.state.draft)
        Assert.assertEquals(0,steerRequests.get())
        screenshot("native-composer-queue.png")
    }
    @Test fun sheetHeaderSwipeClosesPanel(){
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("连接电脑").performScrollTo().assertIsDisplayed().performClick()
        ui.waitUntil(5000){ui.onAllNodesWithText("扫描电脑二维码").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithText("扫描电脑二维码").assertExists()
        ui.onNodeWithTag("sheetDragHeader").performTouchInput{
            swipe(center,center+Offset(0f,320f),350)
        }
        ui.waitUntil(5000){ui.onAllNodesWithTag("sheetDragHeader").fetchSemanticsNodes().isEmpty()}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("连接电脑").performScrollTo().assertIsDisplayed().performClick()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.waitUntil(5000){ui.onAllNodesWithTag("sheetDragHeader").fetchSemanticsNodes().isEmpty()}
    }
    @Test fun slashSuggestionsDoNotResizeTheConversationWhileTyping(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithTag("composer").performTextInput("a")
        ui.waitUntil(5000){ui.activity.window.decorView.rootWindowInsets?.isVisible(android.view.WindowInsets.Type.ime())==true}
        ui.waitForIdle()
        val before=ui.onNodeWithTag("messages").fetchSemanticsNode().boundsInRoot.bottom
        ui.onNodeWithTag("composer").performTextReplacement("/")
        ui.onNodeWithTag("slashCommands",useUnmergedTree=true).assertIsDisplayed()
        ui.waitForIdle()
        val after=ui.onNodeWithTag("messages").fetchSemanticsNode().boundsInRoot.bottom
        Assert.assertEquals("输入斜杠时不应挤动聊天视口",before,after,2f)
        ui.onNodeWithTag("composer").performTextReplacement("/sta")
        ui.onNodeWithText("/status").assertIsDisplayed()
        val menu=ui.onNodeWithTag("slashCommands",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
        val composer=ui.onNodeWithTag("composer").fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("命令建议应贴在输入框上方",menu.bottom<=composer.top)
        screenshot("native-slash-compact.png")
    }
    @Test fun olderHistoryKeepsExpandedCompletedTurnVisible(){
        fun turns(start:Int,end:Int)=org.json.JSONArray().apply{for(i in start until end){
            put(JSONObject().put("type","turn.started").put("threadId","t").put("eventId","turn-start-$i"))
            put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","turn-user-$i").put("text","真实分页提问 $i"))
            put(JSONObject().put("type","tool.started").put("threadId","t").put("eventId","turn-tool-$i").put("itemId","tool-$i").put("title","运行命令"))
            put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","turn-answer-$i").put("itemId","answer-$i").put("text","真实分页回复 $i"))
            put(JSONObject().put("type","turn.completed").put("threadId","t").put("eventId","turn-end-$i").put("status","completed"))
        }}.toString()
        historyStatus="completed";history=turns(8,12);olderHistory=turns(0,12);historyMore=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==20&&vm.state.hasMoreHistory}
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.onAllNodes(hasContentDescription("展开详情") or hasContentDescription("收起详情")).onFirst().performClick()
        ui.onAllNodesWithText("运行命令").onFirst().assertIsDisplayed()
        val top=ui.onNodeWithText("真实分页提问 8").fetchSemanticsNode().boundsInRoot.top
        ui.onNodeWithText("查看更早记录").performClick()
        ui.waitUntil(10000){vm.state.events.size==60&&!vm.state.loadingOlderHistory}
        ui.waitForIdle()
        Assert.assertEquals(top,ui.onNodeWithText("真实分页提问 8").fetchSemanticsNode().boundsInRoot.top,3f)
        ui.onAllNodesWithText("运行命令").onFirst().assertIsDisplayed()
    }
    @Test fun olderHistoryDoesNotFlashAnAssistantRowDuringPrepend(){
        fun rows(start:Int,end:Int)=org.json.JSONArray().apply{for(i in start until end)put(JSONObject().put("type","message.delta").put("threadId","t").put("text","分页锚点 $i").put("eventId","anchor-$i").put("itemId","anchor-$i"))}.toString()
        historyStatus="completed";history=rows(40,60);olderHistory=rows(0,60);historyMore=true;olderDelayMs=1800
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==20&&vm.state.hasMoreHistory}
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.waitForIdle()
        val decor=ui.activity.window.decorView
        ui.onNodeWithText("查看更早记录").performClick()
        ui.waitUntil(10000){vm.state.loadingOlderHistory}
        ui.onNodeWithTag("messages").performTouchInput{swipeUp()}
        ui.waitForIdle()
        Assert.assertTrue("采样开始前请求仍须进行中",vm.state.loadingOlderHistory)
        var tracked=""
        ui.runOnIdle{
            fun find(view:android.view.View):android.widget.TextView?=when(view){
                is android.widget.TextView->view.takeIf{it.text.toString().startsWith("分页锚点 ")&&it.getGlobalVisibleRect(android.graphics.Rect())}
                is android.view.ViewGroup->(0 until view.childCount).firstNotNullOfOrNull{find(view.getChildAt(it))}
                else->null
            }
            tracked=find(decor)?.text.toString()
        }
        Assert.assertTrue(tracked.startsWith("分页锚点 "))
        val samples=java.util.Collections.synchronizedList(mutableListOf<Int?>())
        lateinit var choreographer:android.view.Choreographer
        val callback=object:android.view.Choreographer.FrameCallback{
            override fun doFrame(frameTimeNanos:Long){
                fun find(view:android.view.View):android.widget.TextView?=when(view){
                    is android.widget.TextView->view.takeIf{it.text.toString()==tracked&&it.isShown}
                    is android.view.ViewGroup->(0 until view.childCount).firstNotNullOfOrNull{find(view.getChildAt(it))}
                    else->null
                }
                val rect=android.graphics.Rect()
                samples.add(find(decor)?.takeIf{it.getGlobalVisibleRect(rect)}?.let{rect.top})
                choreographer.postFrameCallback(this)
            }
        }
        ui.runOnUiThread{choreographer=android.view.Choreographer.getInstance();choreographer.postFrameCallback(callback)}
        try{
            ui.waitUntil(10000){vm.state.events.size==60&&!vm.state.loadingOlderHistory}
            ui.waitForIdle()
        }finally{ui.runOnUiThread{choreographer.removeFrameCallback(callback)}}
        Assert.assertTrue("需采样分页前后的绘制帧",samples.size>=3)
        Assert.assertTrue("插入旧记录时可见消息丢失了 ${samples.count{it==null}} 帧",samples.none{it==null})
        val positions=samples.filterNotNull()
        Assert.assertTrue("插入旧记录时可见消息闪动：${positions.minOrNull()}..${positions.maxOrNull()}",(positions.maxOrNull()!!-positions.minOrNull()!!)<=6)
    }
    @Test fun pagingKeepsPositionReachedWhileRequestWasInFlight(){
        fun rows(start:Int)=org.json.JSONArray().apply{for(i in start until 80)put(JSONObject().put("type","user.message").put("threadId","t").put("text","延迟分页 $i").put("eventId","delayed-$i"))}.toString()
        history=rows(40);olderHistory=rows(0);historyMore=true;olderDelayMs=3000
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==40&&vm.state.hasMoreHistory}
        ui.waitForIdle()
        // Begin reading with a real gesture, then jump within the detached list.
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.onNodeWithText("查看更早记录").performClick()
        ui.waitUntil(10000){vm.state.loadingOlderHistory}
        ui.onNodeWithTag("messages").performTouchInput{swipeUp()}
        ui.waitForIdle()
        val box=ui.onNodeWithTag("messages").fetchSemanticsNode().boundsInRoot
        val anchor=ui.onAllNodes(hasText("延迟分页",substring=true)).fetchSemanticsNodes().first{it.boundsInRoot.top>=box.top&&it.boundsInRoot.bottom<box.bottom}
        val label=anchor.config[SemanticsProperties.Text].first().text
        val top=anchor.boundsInRoot.top
        Assert.assertTrue("必须在响应前完成滑动",vm.state.loadingOlderHistory)
        ui.waitUntil(10000){vm.state.events.size==80&&!vm.state.loadingOlderHistory}
        ui.waitForIdle()
        Assert.assertEquals(top,ui.onNodeWithText(label).fetchSemanticsNode().boundsInRoot.top,3f)
    }
    @Test fun upwardGestureAutomaticallyLoadsOlderHistoryOnce(){
        fun rows(start:Int)=org.json.JSONArray().apply{for(i in start until 60)put(JSONObject().put("type","user.message").put("threadId","t").put("text","自动分页 $i").put("eventId","auto-$i"))}.toString()
        history=rows(40);olderHistory=rows(0);historyMore=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==20&&vm.state.hasMoreHistory}
        ui.waitForIdle()
        // Begin reading with a real gesture, then jump within the detached list.
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.waitForIdle()
        Assert.assertFalse("程序滚动不应触发加载",historyCounts.any{it>10})
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitUntil(10000){vm.state.events.size==60&&!vm.state.loadingOlderHistory}
        ui.onNodeWithText("自动分页 40").assertIsDisplayed()
        Assert.assertEquals(1,historyCounts.count{it==20})
        Assert.assertEquals(60,vm.state.events.map{it.eventId}.distinct().size)
    }
    @Test fun scrollingIntoOlderHeaderAutomaticallyLoadsHistory(){
        fun rows(start:Int)=org.json.JSONArray().apply{for(i in start until 60)put(JSONObject().put("type","user.message").put("threadId","t").put("text","滑动分页 $i").put("eventId","scroll-$i"))}.toString()
        history=rows(40);olderHistory=rows(0);historyMore=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==20&&vm.state.hasMoreHistory}
        ui.onNodeWithTag("messages").performScrollToIndex(5)
        ui.waitForIdle()
        Assert.assertFalse(historyCounts.any{it>10})
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitUntil(10000){vm.state.events.size==60&&!vm.state.loadingOlderHistory}
        Assert.assertEquals(1,historyCounts.count{it==20})
    }
    @Test fun anotherUpwardGestureLoadsTheNextOlderPageWithoutButton(){
        fun rows(start:Int)=org.json.JSONArray().apply{for(i in start until 140)put(JSONObject().put("type","user.message").put("threadId","t").put("text","连续分页 $i").put("eventId","multi-$i"))}.toString()
        history=rows(100);olderHistory=rows(40);oldestHistory=rows(0);historyMore=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==40&&vm.state.hasMoreHistory}
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitUntil(10000){vm.state.events.size==100&&!vm.state.loadingOlderHistory}
        ui.waitForIdle()
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitUntil(10000){vm.state.events.size==140&&!vm.state.loadingOlderHistory}
        Assert.assertEquals(1,historyCounts.count{it==20})
        Assert.assertEquals(1,historyCounts.count{it==30})
        Assert.assertFalse(vm.state.hasMoreHistory)
    }
    @Test fun followsGrowingReplyAndResumesAfterUserReturnsToBottom(){
        fun snapshot(text:String)=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","follow-user").put("text","跟随测试")).put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","follow-answer").put("itemId","follow-answer").put("text",text)).toString()
        history=snapshot("短回复")
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==2}
        history=snapshot("追加正文。\n\n".repeat(80))
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitForIdle()
        ui.onNodeWithContentDescription("回到最新").assertDoesNotExist()
        ui.onNodeWithContentDescription("复制回复").assertDoesNotExist()
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitForIdle()
        ui.onNodeWithContentDescription("回到最新").assertExists()
        repeat(4){ui.onNodeWithTag("messages").performTouchInput{swipeUp()};ui.waitForIdle()}
        ui.onNodeWithContentDescription("回到最新").assertDoesNotExist()
        history=snapshot("追加正文。\n\n".repeat(100))
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitForIdle()
        ui.onNodeWithContentDescription("回到最新").assertDoesNotExist()
        ui.onNodeWithContentDescription("复制回复").assertDoesNotExist()
    }
    @Test fun returnToLatestMovesThroughIntermediatePositions(){
        historyStatus="completed"
        history=org.json.JSONArray().apply{
            for(i in 0 until 80)put(JSONObject().put("type","user.message").put("threadId","t")
                .put("eventId","animation-user-$i").put("text","滚动动画消息 $i"))
        }.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==80}
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.onNodeWithTag("messages").performScrollToIndex(5)
        ui.waitForIdle()
        ui.onNodeWithContentDescription("回到最新").assertExists()
        fun position():Pair<Float,Float>{
            val range=ui.onNodeWithTag("messages").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
            return range.value() to range.maxValue()
        }
        val start=position().first
        ui.mainClock.autoAdvance=false
        try{
            ui.onNodeWithContentDescription("回到最新").performClick()
            ui.mainClock.advanceTimeBy(96)
            val (middle,end)=position()
            Assert.assertTrue("回到最新应开始移动：$start -> $middle",middle>start)
            Assert.assertTrue("回到最新不应瞬间跳到底：$middle / $end",middle<end-4f)
        }finally{ui.mainClock.autoAdvance=true}
        ui.waitForIdle()
        ui.onNodeWithContentDescription("回到最新").assertDoesNotExist()
        history=org.json.JSONArray(history).put(JSONObject().put("type","user.message").put("threadId","t")
            .put("eventId","animation-user-80").put("text","动画结束后继续跟随")).toString()
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.size==81}
        ui.waitForIdle()
        val (after,maximum)=position()
        Assert.assertTrue("回底后新增消息应继续跟随：$after / $maximum",maximum-after<4f)
    }
    @Test fun longStreamingReplyActuallyStaysAtBottom(){
        fun snapshot(text:String)=org.json.JSONArray()
            .put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","tail-user").put("text","长回复跟随"))
            .put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","tail-answer").put("itemId","tail-answer").put("text",text)).toString()
        history=snapshot("起始内容")
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==2}
        history=snapshot("增长中的回复。\n\n".repeat(180)+"最后一行")
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitForIdle()
        val range=ui.onNodeWithTag("messages").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange]
        Assert.assertTrue("跟随时视口未到最后：${range.value()} / ${range.maxValue()}",range.maxValue()-range.value()<4f)
        ui.onNodeWithContentDescription("回到最新").assertDoesNotExist()
    }
    @Test fun transcriptIdReplacementKeepsReadingPosition(){
        fun rows(start:Int,saved:Boolean)=org.json.JSONArray().apply{
            for(i in start until 40)put(JSONObject().put("type","message.delta").put("threadId","t")
                .put("eventId",if(saved)"history:t:session:$i" else "live:$i")
                .put("itemId","message-$i").put("text","稳定锚点 $i"))
        }.toString()
        historyStatus="completed";history=rows(10,false)
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==30}
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(10)
        ui.waitForIdle()
        fun anchorTop():Int{
            var top=-1
            ui.runOnIdle{
                fun visit(view:android.view.View){
                    if(view is android.widget.TextView&&view.text.toString().contains("稳定锚点 20")){
                        val position=IntArray(2);view.getLocationOnScreen(position);top=position[1]
                    }
                    if(view is android.view.ViewGroup)for(i in 0 until view.childCount)visit(view.getChildAt(i))
                }
                visit(ui.activity.window.decorView)
            }
            return top
        }
        val top=anchorTop()
        Assert.assertTrue("滚动后锚点未显示",top>=0)
        history=rows(9,true)
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.size==31}
        ui.waitForIdle()
        Assert.assertEquals(top,anchorTop())
    }
    @Test fun sendingWhileReadingOlderMessagesReturnsToLatest(){
        historyStatus="completed"
        val rows=org.json.JSONArray().apply{
            for(i in 0 until 45)put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","send-follow-$i").put("text","阅读中的消息 $i"))
        }
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==45&&!vm.state.running}
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.onNodeWithTag("messages").performScrollToIndex(10)
        ui.waitForIdle()
        ui.onNodeWithContentDescription("回到最新").assertExists()
        ui.onNodeWithTag("composer").performTextReplacement("发送后回到最新")
        ui.onNodeWithContentDescription("发送消息").performClick()
        ui.waitUntil(10000){requests.any{it.optString("text")=="发送后回到最新"}}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("回到最新").fetchSemanticsNodes().isEmpty()}
        rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","send-follow-answer").put("itemId","send-follow-answer").put("text","新回复继续跟随。\n\n".repeat(45)))
        history=rows.toString()
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.size==46}
        ui.waitForIdle()
        ui.onNodeWithContentDescription("回到最新").assertDoesNotExist()
    }
    @Test fun expandedLongTurnOnlyComposesVisibleRows(){
        historyStatus="completed"
        val rows=org.json.JSONArray().put(JSONObject().put("type","turn.started").put("threadId","t").put("eventId","long-turn-start"))
        for(i in 0 until 50){
            rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","long-answer-$i").put("itemId","long-answer-$i").put("text","分段回答 $i"))
            rows.put(JSONObject().put("type","tool.started").put("threadId","t").put("eventId","long-tool-$i").put("itemId","long-tool-$i").put("title","运行命令"))
        }
        rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","long-final").put("itemId","long-final").put("text","最终结论"))
        rows.put(JSONObject().put("type","turn.completed").put("threadId","t").put("eventId","long-turn-end"))
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==103}
        ui.onNode(hasContentDescription("展开详情") or hasContentDescription("收起详情")).performClick()
        ui.waitForIdle()
        fun renderedCount():Int{
            var countResult=0
            ui.runOnIdle{
                fun count(view:android.view.View):Int=when(view){
                    is android.widget.TextView->if(view.text.toString().startsWith("分段回答"))1 else 0
                    is android.view.ViewGroup->(0 until view.childCount).sumOf{count(view.getChildAt(it))}
                    else->0
                }
                countResult=count(ui.activity.window.decorView)
            }
            return countResult
        }
        val rendered=renderedCount()
        Assert.assertTrue("长处理过程只应绘制屏幕附近的消息，实际绘制 $rendered 条",rendered in 1..20)
        screenshot("native-long-turn-lazy.png")
        rows.put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","long-new-user").put("text","追加用户消息"))
        history=rows.toString()
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.size==104}
        Assert.assertTrue(renderedCount()>0)
        ui.onNodeWithTag("messages").performScrollToNode(hasContentDescription("展开详情") or hasContentDescription("收起详情"))
        ui.onNode(hasContentDescription("展开详情") or hasContentDescription("收起详情")).performClick()
        ui.waitForIdle()
        Assert.assertEquals(0,renderedCount())
    }
    @Test fun expandedToolGroupOnlyComposesVisibleDetails(){
        historyStatus="completed"
        history=org.json.JSONArray().apply{
            put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","tool-user").put("text","检查长工具记录"))
            for(i in 0 until 120)put(JSONObject().put("type","tool.started").put("threadId","t")
                .put("eventId","tool-event-$i").put("itemId","tool-item-$i").put("title","步骤 $i").put("detail","工具明细 $i"))
        }.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==121}
        ui.onNodeWithContentDescription("展开详情").performClick()
        ui.waitForIdle()
        val composed=ui.onAllNodesWithTag("activityDetail",useUnmergedTree=true).fetchSemanticsNodes().size
        Assert.assertTrue("长工具分组应只创建可见明细，实际创建 $composed/120",composed in 1..23)
        ui.onNodeWithTag("messages").performScrollToIndex(121)
        ui.onNodeWithText("步骤 119").assertIsDisplayed()
        ui.onNodeWithTag("messages").performScrollToIndex(2)
        ui.onNodeWithText("步骤 0").assertIsDisplayed()
    }
    @Test fun completedTurnKeepsNestedToolDetailsReachable(){
        historyStatus="completed"
        history=org.json.JSONArray().apply{
            put(JSONObject().put("type","turn.started").put("threadId","t").put("eventId","nested-start"))
            put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","nested-user").put("text","检查完成后的工具详情"))
            for(i in 0 until 60)put(JSONObject().put("type","tool.started").put("threadId","t")
                .put("eventId","nested-tool-$i").put("itemId","nested-item-$i").put("title","嵌套步骤 $i").put("detail","嵌套详情 $i"))
            put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","nested-answer").put("text","处理完成"))
            put(JSONObject().put("type","turn.completed").put("threadId","t").put("eventId","nested-end").put("status","completed"))
        }.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==64}
        ui.onNodeWithTag("messages").performScrollToNode(hasContentDescription("展开详情") or hasContentDescription("收起详情"))
        ui.onNodeWithContentDescription("展开详情").performClick()
        val composed=ui.onAllNodesWithTag("activityDetail",useUnmergedTree=true).fetchSemanticsNodes().size
        Assert.assertTrue("完成会话中的工具明细应按可见范围创建：$composed/60",composed in 1..23)
        ui.onNodeWithTag("messages").performScrollToNode(hasText("嵌套步骤 59"))
        ui.onNodeWithText("嵌套步骤 59").assertIsDisplayed()
    }
    @Test fun completingLiveTurnDefaultsToFoldedProcess(){
        val rows=org.json.JSONArray()
            .put(JSONObject().put("type","turn.started").put("threadId","t").put("eventId","active-start"))
            .put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","active-user").put("text","正在处理的问题"))
            .put(JSONObject().put("type","tool.started").put("threadId","t").put("eventId","active-tool").put("itemId","active-command").put("title","运行命令"))
            .put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","active-answer").put("itemId","active-answer").put("text","已完成的答复"))
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==4}
        ui.onNodeWithContentDescription("展开详情").performClick()
        ui.onNodeWithText("运行命令").assertIsDisplayed()

        historyStatus="completed"
        rows.put(JSONObject().put("type","turn.completed").put("threadId","t").put("eventId","active-end").put("status","completed"))
        history=rows.toString()
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.size==5}
        ui.onNodeWithText("运行命令").assertDoesNotExist()
        ui.onNode(hasContentDescription("展开详情") or hasContentDescription("收起详情")).assertIsDisplayed()
        ui.onNode(hasContentDescription("展开详情") or hasContentDescription("收起详情")).performClick()
        ui.onNodeWithText("运行命令").assertIsDisplayed()

        rows.put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","next-user").put("text","下一条消息"))
        history=rows.toString()
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.size==6}
        ui.onNodeWithText("运行命令").assertIsDisplayed()
        ui.runOnUiThread{vm.newThread()}
        ui.waitUntil(10000){vm.state.threadId.isBlank()}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==6}
        ui.onNodeWithText("运行命令").assertIsDisplayed()
    }
    @Test fun expandedProcessSurvivesLiveToHistoryIdReplacement(){
        fun rows(saved:Boolean)=org.json.JSONArray().apply{
            fun event(type:String,id:String)=JSONObject().put("type",type).put("threadId","t").put("eventId",if(saved)"history:t:session:$id" else "live:$id")
            put(event("turn.started","start"))
            put(event("user.message","user").put("text","检查展开状态"))
            put(event("message.delta","progress").put("text","先核对项目"))
            put(event("tool.started","tool").put("title","运行命令"))
            put(event("message.delta","answer").put("text","已检查完成"))
            put(event("turn.completed","end").put("status","completed"))
        }.toString()
        historyStatus="completed";history=rows(false)
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==6}
        ui.onNode(hasContentDescription("展开详情") or hasContentDescription("收起详情")).performClick()
        ui.onNodeWithText("运行命令").assertIsDisplayed()
        history=rows(true)
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.firstOrNull()?.eventId?.startsWith("history:")==true}
        ui.onNodeWithText("运行命令").assertIsDisplayed()
    }
    @Test fun completingTurnWhileReadingFoldsStepsBeforeAnswer(){
        val rows=org.json.JSONArray()
        for(i in 0 until 20)rows.put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","reading-$i").put("text","前面的消息 $i"))
        rows.put(JSONObject().put("type","turn.started").put("threadId","t").put("eventId","reading-turn"))
        rows.put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","reading-question").put("text","当前问题"))
        rows.put(JSONObject().put("type","tool.started").put("threadId","t").put("eventId","reading-tool").put("itemId","reading-tool").put("title","运行命令"))
        rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","reading-answer").put("itemId","reading-answer").put("text","当前结论"))
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==24}
        ui.onNodeWithTag("messages").performScrollToIndex(20)
        ui.onNodeWithContentDescription("展开详情").performClick()
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.waitForIdle()
        historyStatus="completed"
        rows.put(JSONObject().put("type","turn.completed").put("threadId","t").put("eventId","reading-end").put("status","completed"))
        history=rows.toString()
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.size==25}
        ui.waitForIdle()
        ui.onNodeWithText("运行命令").assertDoesNotExist()
        ui.onNodeWithContentDescription("展开详情").assertIsDisplayed()
    }
    @Test fun scrollFrameSample()=captureScrollFrameSample(false)
    @Test fun plainScrollFrameSample()=captureScrollFrameSample(true)
    @Test fun operationBoundaryFrameSample()=captureScrollFrameSample(false,true)
    private fun captureScrollFrameSample(plain:Boolean,operations:Boolean=false){
        val rows=org.json.JSONArray()
        for(i in 0 until 30){
            rows.put(JSONObject().put("type","user.message").put("threadId","t").put("text","滚动采样 $i").put("eventId","perf-u$i"))
            if(operations){
                rows.put(JSONObject().put("type","tool.started").put("threadId","t").put("itemId","perf-tool$i").put("eventId","perf-tool-start$i"))
                val patch=(0 until 38).joinToString("\n"){file->"*** Update File: src/file-$file.kt\n@@\n"+(0 until 40).joinToString("\n"){line->"-${line}old\n+${line}new"}}
                rows.put(JSONObject().put("type","file.changed").put("threadId","t").put("diff",patch).put("eventId","perf-files$i"))
                rows.put(JSONObject().put("type","tool.completed").put("threadId","t").put("itemId","perf-tool$i").put("eventId","perf-tool-end$i"))
            }
            val answer=if(plain)"第 $i 段回复。\n\n"+"这是用于连续滑动的纯文本内容和段落。".repeat(5)
                else "第 $i 段回复。\n\n"+"这是用于连续滑动的 Markdown 内容，包含 **强调** 和段落。".repeat(5)
            rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("text",answer).put("eventId","perf-a$i").put("itemId","perf-a$i"))
            if(operations)rows.put(JSONObject().put("type","turn.completed").put("threadId","t").put("status","completed").put("eventId","perf-end$i"))
        }
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==if(operations)180 else 60}
        ui.onNodeWithTag("messages").performScrollToIndex(30)
        ui.waitForIdle()
        val durations=java.util.Collections.synchronizedList(mutableListOf<Long>())
        val phases=java.util.Collections.synchronizedList(mutableListOf<LongArray>())
        val swipeP95=org.json.JSONArray()
        val handlerThread=android.os.HandlerThread("scroll-frame-sample").apply{start()}
        val listener=android.view.Window.OnFrameMetricsAvailableListener{_,metrics,_->
            durations.add(metrics.getMetric(android.view.FrameMetrics.TOTAL_DURATION))
            phases.add(intArrayOf(android.view.FrameMetrics.LAYOUT_MEASURE_DURATION,android.view.FrameMetrics.DRAW_DURATION,android.view.FrameMetrics.SYNC_DURATION,android.view.FrameMetrics.COMMAND_ISSUE_DURATION,android.view.FrameMetrics.SWAP_BUFFERS_DURATION,android.view.FrameMetrics.UNKNOWN_DELAY_DURATION).map{metrics.getMetric(it)}.toLongArray())
        }
        ui.runOnUiThread{ui.activity.window.addOnFrameMetricsAvailableListener(listener,android.os.Handler(handlerThread.looper))}
        try{
            val instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
            val decor=ui.activity.window.decorView
            val x=decor.width/2f
            repeat(8){swipeIndex->
                val from=decor.height*(if(swipeIndex%2==0).28f else .78f)
                val to=decor.height*(if(swipeIndex%2==0).78f else .28f)
                val firstFrame=synchronized(durations){durations.size}
                val down=android.os.SystemClock.uptimeMillis()
                instrumentation.sendPointerSync(android.view.MotionEvent.obtain(down,down,android.view.MotionEvent.ACTION_DOWN,x,from,0))
                repeat(28){step->
                    Thread.sleep(12)
                    instrumentation.sendPointerSync(android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),android.view.MotionEvent.ACTION_MOVE,x,from+(to-from)*(step+1)/28,0))
                }
                instrumentation.sendPointerSync(android.view.MotionEvent.obtain(down,android.os.SystemClock.uptimeMillis(),android.view.MotionEvent.ACTION_UP,x,to,0))
                Thread.sleep(120)
                val sample=synchronized(durations){durations.drop(firstFrame).sorted()}
                if(sample.isNotEmpty())swipeP95.put(sample[((sample.size-1)*0.95).toInt()]/1e6)
            }
            Thread.sleep(200)
        }finally{ui.runOnUiThread{ui.activity.window.removeOnFrameMetricsAvailableListener(listener)};handlerThread.quitSafely();handlerThread.join()}
        val values=synchronized(durations){durations.toList().sorted()}
        Assert.assertTrue("需采集到渲染帧",values.isNotEmpty())
        val result=JSONObject().put("variant",if(operations)"operation-boundary" else if(plain)"plain" else "markdown").put("frames",values.size).put("p50Ms",values[values.size/2]/1e6).put("p95Ms",values[((values.size-1)*0.95).toInt()]/1e6).put("over16ms",values.count{it>16666667}).put("over8ms",values.count{it>8333333}).put("swipeP95Ms",swipeP95)
        val phaseRows=synchronized(phases){phases.toList()}
        listOf("layout","draw","sync","commands","swap","unknown").forEachIndexed{index,name->result.put(name+"Ms",phaseRows.sumOf{it[index]}/1e6)}
        android.util.Log.i("CodexFrameSample",result.toString())
        java.io.File(ui.activity.getExternalFilesDir(null),"scroll-frame-sample.json").writeText(result.toString())
    }
    @Test fun rollingHistoryRefreshDoesNotEvictTheMessageBeingRead(){
        fun rows(start:Int,end:Int)=org.json.JSONArray().apply{for(i in start until end)put(JSONObject().put("type","user.message").put("threadId","t").put("text","窗口消息 $i").put("eventId","window-$i"))}.toString()
        history=rows(0,60);historyMore=true
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==60}
        ui.onNodeWithTag("messages").performScrollToIndex(8)
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitForIdle()
        val box=ui.onNodeWithTag("messages").fetchSemanticsNode().boundsInRoot
        val anchor=ui.onAllNodes(hasText("窗口消息",substring=true)).fetchSemanticsNodes().first{it.boundsInRoot.top>=box.top&&it.boundsInRoot.bottom<box.bottom}
        val label=anchor.config[SemanticsProperties.Text].first().text
        val top=anchor.boundsInRoot.top
        history=rows(30,90)
        kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="window-89"}}
        ui.waitForIdle()
        Assert.assertEquals(top,ui.onNodeWithText(label).fetchSemanticsNode().boundsInRoot.top,3f)
    }
    @Test fun historyStaysInPlaceWhilePollingAndTyping(){
        val rows=org.json.JSONArray()
        for(i in 0 until 30){rows.put(JSONObject().put("type","user.message").put("threadId","t").put("text","历史用户 $i").put("eventId","u$i"));rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("text","第 $i 段回复，保留当前阅读位置。").put("eventId","a$i").put("itemId","a$i"))}
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==60}
        ui.onNodeWithTag("messages").performScrollToIndex(20)
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitForIdle()
        val box=ui.onNodeWithTag("messages").fetchSemanticsNode().boundsInRoot
        val anchor=ui.onAllNodes(hasText("历史用户",substring=true)).fetchSemanticsNodes().first{it.boundsInRoot.top>=box.top&&it.boundsInRoot.bottom<box.bottom}
        val label=anchor.config[SemanticsProperties.Text].first().text
        val top=anchor.boundsInRoot.top
        rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("text","新增流式段落").put("eventId","new").put("itemId","new"));history=rows.toString()
        ui.waitUntil(10000){vm.state.events.size==61}
        ui.waitForIdle()
        Assert.assertEquals(top,ui.onNodeWithText(label).fetchSemanticsNode().boundsInRoot.top,3f)
        ui.onNodeWithTag("composer").performTextInput("阅读时输入草稿")
        Assert.assertEquals(top,ui.onNodeWithText(label).fetchSemanticsNode().boundsInRoot.top,3f)
        // The last message is fully visible even if the trailing spacer is not.
        ui.onNodeWithTag("messages").performScrollToIndex(61)
        ui.waitForIdle()
        ui.onNodeWithContentDescription("回到最新").assertDoesNotExist()
        ui.onNodeWithTag("messages").performScrollToIndex(20)
        ui.waitForIdle()
        val readingTop=ui.onNodeWithText("历史用户 10").fetchSemanticsNode().boundsInRoot.top
        rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("text","再次更新，不抢阅读位置").put("eventId","new2").put("itemId","new2"));history=rows.toString()
        ui.waitUntil(10000){vm.state.events.size==62}
        ui.waitForIdle()
        Assert.assertEquals(readingTop,ui.onNodeWithText("历史用户 10").fetchSemanticsNode().boundsInRoot.top,3f)
        screenshot("native-reading.png")
        ui.onNodeWithContentDescription("回到最新").performClick()
    }
    @Test fun videoAttachmentUploadsAndIsSentWithOriginalBytes(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val local=java.io.File(context.cacheDir,"outputs/clip.mp4").apply{parentFile?.mkdirs();writeBytes(ByteArray(8192){(it%251).toByte()})}
        val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",local)
        try{
            ui.runOnUiThread{vm.uploadFiles(listOf(uri))}
            ui.waitUntil(15000){vm.state.uploads.size==1&&!vm.state.uploading}
            Assert.assertEquals(8192L,vm.state.uploads.single().size)
            ui.onNodeWithText("clip.mp4").assertIsDisplayed()
            ui.onNodeWithContentDescription("发送消息").performClick()
            ui.waitUntil(10000){requests.any{it.optJSONArray("files")?.length()==1}}
            Assert.assertEquals("123e4567-e89b-12d3-a456-426614174000",requests.last().getJSONArray("files").getJSONObject(0).getString("id"))
        }finally{local.delete()}
    }
    private fun screenshot(name:String){
        ui.waitForIdle()
        // Semantic updates precede the emulator compositor and IME animation.
        android.os.SystemClock.sleep(700)
        val image=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val context=ApplicationProvider.getApplicationContext<Application>()
        java.io.File(context.getExternalFilesDir(null),name).outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        fun containsWeb(view:android.view.View):Boolean=view is android.webkit.WebView||(view is android.view.ViewGroup&&(0 until view.childCount).any{containsWeb(view.getChildAt(it))})
        ui.runOnUiThread{Assert.assertFalse("Native screen contains WebView",containsWeb(ui.activity.window.decorView))}
    }
    @Test fun savedConnectionAndEffortSurviveReconnect(){
        ui.runOnUiThread{vm.effort("high");vm.disconnect();vm.autoConnect()}
        ui.waitUntil(10000){vm.state.connected}
        Assert.assertEquals("high",vm.state.effort)
    }
    @Test fun reconnectKeepsConversationSelectionUntilCatalogRemovesItsEffort(){
        ui.waitUntil(10000){vm.state.models.any{it.id=="test"}}
        val app=ApplicationProvider.getApplicationContext<Application>()
        val prefs=app.getSharedPreferences("native",0)
        historyStatus="completed"
        consoleNewModel=true
        ConnectionStore(app).saveModels(server.url("/").toString(),vm.state.models+NativeModel("new-model","New model",listOf("medium"),"medium"))
        prefs.edit().putString("model:codex","new-model").putString("thread:t:model","test").putString("thread:t:effort","low").putString("effort:test","medium").apply()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first().copy(status="completed"))}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        Assert.assertEquals("low",vm.state.effort)
        ui.runOnUiThread{vm.connect(server.url("/").toString(),"test");vm.draft("重连时保留会话设置")}
        Assert.assertEquals("test",vm.state.model);Assert.assertEquals("low",vm.state.effort)
        ui.waitUntil(10000){vm.state.connected&&vm.state.models.any{it.name=="Refreshed model 2"}}
        Assert.assertEquals("low",vm.state.effort)
        ui.onNodeWithContentDescription("发送消息").assertIsEnabled()
        ui.runOnUiThread{vm.connect(server.url("/").toString(),"test")}
        Assert.assertEquals("low",vm.state.effort)
        ui.waitUntil(10000){vm.state.connected&&vm.state.models.any{it.name=="Refreshed model 3"}}
        Assert.assertEquals("test",vm.state.model);Assert.assertEquals("medium",vm.state.effort)
        Assert.assertEquals("重连时保留会话设置",vm.state.draft)
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun modelAndPermissionRememberPerConversationAndWriterQueues(){
        historyStatus="idle"
        val thread=vm.state.threads.first().copy(status="idle")
        ui.runOnUiThread{vm.openThread(thread);vm.effort("high");vm.permission("ask")}
        Assert.assertEquals("ask",vm.state.permission)
        ui.runOnUiThread{vm.newThread();vm.permission("full");vm.openThread(thread)}
        Assert.assertEquals("high",vm.state.effort)
        Assert.assertEquals("ask",vm.state.permission)
        ui.waitUntil(10000){!vm.state.loadingHistory&&!vm.state.running}
        ui.runOnUiThread{vm.draft("WRITER 冲突测试");vm.send()}
        ui.waitUntil(10000){requests.isNotEmpty()&&vm.state.queue.any{it.text.contains("WRITER")}}
        Assert.assertEquals("ask",requests.last().getString("permission"))
        Assert.assertTrue(vm.state.draft.isEmpty())
        Assert.assertFalse(vm.state.sending)
    }
    @Test fun markdownFileLinkOpensAuthorizedOutput(){
        ui.waitUntil(10000){vm.state.projects.any{it.id=="p"}}
        history=org.json.JSONArray().put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","linked-file").put("text","[打开文件](F:/Code/Codex-mobile-control/artifacts/linked-output.txt)")).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="linked-file"}}
        ui.waitForIdle()
        var point:Pair<Float,Float>?=null
        ui.runOnUiThread{
            fun find(view:android.view.View){
                if(view is android.widget.TextView&&view.text.contains("打开文件")&&view.layout!=null){
                    val label=view.text.toString().indexOf("打开文件")
                    val spans=(view.text as android.text.Spanned).getSpans(label,label+4,android.text.style.ClickableSpan::class.java)
                    Assert.assertTrue("Markdown 链接缺少可点击 span",spans.isNotEmpty())
                    val location=IntArray(2);view.getLocationOnScreen(location)
                    val line=view.layout.getLineForOffset(label)
                    point=Pair(location[0]+view.totalPaddingLeft+view.layout.getPrimaryHorizontal(label+2),location[1]+view.totalPaddingTop+(view.layout.getLineTop(line)+view.layout.getLineBottom(line))/2f)
                }
                if(view is android.view.ViewGroup)(0 until view.childCount).forEach{find(view.getChildAt(it))}
            }
            find(ui.activity.window.decorView)
        }
        Assert.assertNotNull("找不到文件链接位置",point)
        val now=android.os.SystemClock.uptimeMillis()
        val instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        instrumentation.sendPointerSync(android.view.MotionEvent.obtain(now,now,android.view.MotionEvent.ACTION_DOWN,point!!.first,point!!.second,0))
        instrumentation.sendPointerSync(android.view.MotionEvent.obtain(now,now+50,android.view.MotionEvent.ACTION_UP,point!!.first,point!!.second,0))
        ui.waitUntil(10000){rawFileCount.get()>0}
        Assert.assertTrue(vm.state.error.isBlank())
    }
    @Test fun pdfOpensInsideAppAndScrollsContinuously(){
        ui.waitUntil(10000){vm.state.projects.any{it.id=="p"}}
        val started=android.os.SystemClock.elapsedRealtime()
        val stages=mutableListOf<String>()
        fun mark(stage:String){stages.add("${android.os.SystemClock.elapsedRealtime()-started}ms $stage")}
        fun report():String {
            val state=vm.state
            val roots=runCatching{
                val nodes=ui.onAllNodes(isRoot())
                nodes.fetchSemanticsNodes().indices.joinToString("\n"){nodes[it].printToString()}
            }.getOrElse{"Semantics unavailable: ${it.message}"}
            return stages.joinToString("\n")+"\nfileBusy=${state.fileBusy}, fileError=${state.fileError}, pdfBytes=${state.pdf?.let{java.io.File(it.path).length()}}, requests=${rawFileCount.get()}\n"+roots
        }
        try{
            ui.runOnUiThread{vm.openOutput("F:/Code/Codex-mobile-control/artifacts/report.pdf")}
            mark("open requested")
            ui.waitUntil(10000){vm.state.pdf!=null}
            mark("download available")
            var layoutRecorded=false
            ui.waitUntil(10000){
                if(!layoutRecorded&&ui.onAllNodesWithTag("pdfPages").fetchSemanticsNodes().isNotEmpty()){
                    mark("document layout available");layoutRecorded=true
                }
                runCatching{ui.onNodeWithContentDescription("PDF 第 1 页").assertIsDisplayed();true}.getOrDefault(false)
            }
            mark("first page displayed")
        }catch(error:Exception){
            mark("failed: ${error.message}")
            val diagnostics=report()
            java.io.File(ui.activity.getExternalFilesDir(null),"native-pdf-load-diagnostics.txt").writeText(diagnostics)
            runCatching{screenshot("native-pdf-load-failure.png")}
            throw AssertionError(diagnostics,error)
        }
        java.io.File(ui.activity.getExternalFilesDir(null),"native-pdf-load-diagnostics.txt").writeText(report())
        ui.onNodeWithTag("pdfPages").performScrollToIndex(1)
        ui.waitUntil(10000){runCatching{ui.onNodeWithContentDescription("PDF 第 2 页").assertIsDisplayed();true}.getOrDefault(false)}
        ui.onNodeWithContentDescription("下一页").assertDoesNotExist()
        ui.onNodeWithContentDescription("放大 PDF").performClick()
        ui.onNodeWithContentDescription("保存 PDF").assertIsDisplayed()
        screenshot("native-pdf-preview.png")
        ui.onNodeWithContentDescription("关闭 PDF 预览").performClick()
        ui.waitUntil(5000){vm.state.pdf==null}
        ui.runOnUiThread{vm.openOutput("F:/Code/Codex-mobile-control/artifacts/report.pdf")}
        ui.waitUntil(10000){runCatching{ui.onNodeWithContentDescription("PDF 第 1 页").assertIsDisplayed();true}.getOrDefault(false)}
        ui.onNodeWithText("1 / 2").assertIsDisplayed()
        ui.onNodeWithContentDescription("缩小 PDF").assertIsNotEnabled()
        ui.onNodeWithContentDescription("关闭 PDF 预览").performClick()
        ui.waitUntil(5000){vm.state.pdf==null}
        Assert.assertTrue(rawFileCount.get()>0)
    }
    @Test fun markdownOutputOpensInAppWithSourceMode(){
        ui.waitUntil(10000){vm.state.projects.any{it.id=="p"}}
        ui.runOnUiThread{vm.openOutput("F:/Code/Codex-mobile-control/artifacts/report.md")}
        ui.waitUntil(10000){vm.state.markdown?.content?.contains("阅读器标题")==true}
        ui.onNodeWithText("report.md").assertIsDisplayed()
        ui.onNodeWithText("源码").performClick()
        ui.onNodeWithText("# 阅读器标题",substring=true).assertIsDisplayed()
        ui.onNodeWithText("阅读").performClick()
        screenshot("native-markdown-preview.png")
        ui.onNodeWithContentDescription("关闭阅读器").performClick()
        ui.waitUntil(5000){vm.state.markdown==null}
        Assert.assertTrue(rawFileCount.get()>0)
    }
    @Test fun uploadedMarkdownOpensInApp(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val local=java.io.File(context.cacheDir,"outputs/draft-notes.md").apply{parentFile?.mkdirs();writeText("# 附件阅读\n\n正文")}
        val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",local)
        ui.runOnUiThread{vm.draft("先检查附件，再发送");vm.uploadFiles(listOf(uri))}
        ui.waitUntil(15000){vm.state.uploads.size==1&&!vm.state.uploading}
        ui.onNodeWithText("draft-notes.md").assertHasClickAction().performClick()
        ui.waitUntil(10000){vm.state.markdown?.content?.contains("附件阅读")==true}
        Assert.assertEquals("draft-notes.md",vm.state.markdown?.name)
        ui.onNodeWithContentDescription("关闭阅读器").performClick()
        ui.waitUntil(5000){vm.state.markdown==null}
        Assert.assertEquals("先检查附件，再发送",vm.state.draft)
        Assert.assertEquals(1,vm.state.uploads.size)
        ui.onNodeWithContentDescription("移除文件").performClick()
        ui.waitUntil(5000){vm.state.uploads.isEmpty()}
        Assert.assertNull(vm.state.markdown)
        Assert.assertTrue(requests.isEmpty())
        local.delete()
    }
    @Test fun uploadedPdfUsesNameOrNormalizedMime(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        for(name in listOf("draft-report.PDF","draft-document")){
            val local=java.io.File(context.cacheDir,"outputs/$name").apply{parentFile?.mkdirs();writeBytes(pdfBytes)}
            try{
                val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",local)
                ui.runOnUiThread{vm.draft("检查 PDF 后再发送");vm.uploadFiles(listOf(uri))}
                ui.waitUntil(15000){vm.state.uploads.size==1&&!vm.state.uploading}
                Assert.assertEquals(name,vm.state.uploads.single().name)
                ui.onNodeWithText(name).assertHasClickAction().performClick()
                ui.waitUntil(10000){runCatching{ui.onNodeWithContentDescription("PDF 第 1 页").assertIsDisplayed();true}.getOrDefault(false)}
                Assert.assertEquals(name,vm.state.pdf?.name)
                ui.onNodeWithContentDescription("关闭 PDF 预览").performClick()
                ui.waitUntil(5000){vm.state.pdf==null}
                Assert.assertEquals("检查 PDF 后再发送",vm.state.draft)
                Assert.assertEquals(1,vm.state.uploads.size)
                ui.onNodeWithContentDescription("移除文件").performClick()
                ui.waitUntil(5000){vm.state.uploads.isEmpty()}
            }finally{local.delete()}
        }
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun uploadedTextReadsLiterallyAndJsonSavesWithItsMime(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val resolver=context.contentResolver
        fun savedJson():android.net.Uri?{
            if(android.os.Build.VERSION.SDK_INT<29)return null
            return resolver.query(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,arrayOf(android.provider.MediaStore.Downloads._ID),
                "${android.provider.MediaStore.Downloads.DISPLAY_NAME}=? AND ${android.provider.MediaStore.Downloads.OWNER_PACKAGE_NAME}=? AND ${android.provider.MediaStore.Downloads.IS_PENDING}=0",
                arrayOf("draft-data.JSON",context.packageName),null)?.use{cursor->if(cursor.moveToFirst())android.content.ContentUris.withAppendedId(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,cursor.getLong(0)) else null}
        }
        var saved:android.net.Uri?=null
        savedJson()?.let{resolver.delete(it,null,null)}
        Assert.assertNull(savedJson())
        try{
            for((name,content) in listOf("draft-log.txt" to "# 原样保留\n<em>这不是排版</em>\n","draft-data.JSON" to "{\n  \"title\": \"# 原文\"\n}\n")){
                val local=java.io.File(context.cacheDir,"outputs/$name").apply{parentFile?.mkdirs();writeText(content)}
                try{
                    val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",local)
                    ui.runOnUiThread{vm.draft("读完文本再发送");vm.uploadFiles(listOf(uri))}
                    ui.waitUntil(15000){vm.state.uploads.size==1&&!vm.state.uploading}
                    ui.onNodeWithText(name).assertHasClickAction().performClick()
                    ui.waitUntil(10000){vm.state.markdown?.content==content}
                    ui.onNodeWithText(content).assertIsDisplayed()
                    ui.onNodeWithText("源码").assertDoesNotExist()
                    Assert.assertEquals(if(name.endsWith(".txt"))"text/plain" else "application/json",vm.state.markdown?.mime)
                    if(name.endsWith(".JSON")&&android.os.Build.VERSION.SDK_INT>=29){
                        ui.onNodeWithText("保存").performClick()
                        ui.waitUntil(10000){savedJson()?.also{saved=it}!=null}
                        Assert.assertEquals("application/json",resolver.getType(saved!!))
                        Assert.assertEquals(content,resolver.openInputStream(saved!!)?.bufferedReader(Charsets.UTF_8)?.use{it.readText()})
                        ui.waitUntil(5000){runCatching{ui.onNodeWithText("保存").assertIsEnabled();true}.getOrDefault(false)}
                    }
                    ui.onNodeWithContentDescription("关闭阅读器").performClick()
                    ui.waitUntil(5000){vm.state.markdown==null}
                    Assert.assertEquals("读完文本再发送",vm.state.draft)
                    Assert.assertEquals(1,vm.state.uploads.size)
                    ui.onNodeWithContentDescription("移除文件").performClick()
                    ui.waitUntil(5000){vm.state.uploads.isEmpty()}
                }finally{local.delete()}
            }
            Assert.assertTrue(requests.isEmpty())
        }finally{(saved?:savedJson())?.let{resolver.delete(it,null,null)}}
    }
    @Test fun utf16DocumentsReadAndSaveOriginalBytes(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val resolver=context.contentResolver
        fun savedFile(name:String):android.net.Uri?{
            if(android.os.Build.VERSION.SDK_INT<29)return null
            return resolver.query(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,arrayOf(android.provider.MediaStore.Downloads._ID),
                "${android.provider.MediaStore.Downloads.DISPLAY_NAME}=? AND ${android.provider.MediaStore.Downloads.OWNER_PACKAGE_NAME}=? AND ${android.provider.MediaStore.Downloads.IS_PENDING}=0",
                arrayOf(name,context.packageName),null)?.use{cursor->if(cursor.moveToFirst())android.content.ContentUris.withAppendedId(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,cursor.getLong(0)) else null}
        }
        for(name in listOf("utf16-le-notes.md","utf16-be-data.json")){
            val bytes=utf16Fixture(name)
            val content=if(name.endsWith(".md"))utf16Markdown else utf16Json
            val local=java.io.File(context.cacheDir,"outputs/$name").apply{parentFile?.mkdirs();writeBytes(bytes)}
            var saved:android.net.Uri?=null
            savedFile(name)?.let{resolver.delete(it,null,null)}
            Assert.assertNull(savedFile(name))
            try{
                val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",local)
                ui.runOnUiThread{vm.draft("读完编码文档再发送");vm.uploadFiles(listOf(uri))}
                ui.waitUntil(15000){vm.state.uploads.size==1&&!vm.state.uploading}
                ui.onNodeWithText(name).assertHasClickAction().performClick()
                ui.waitUntil(10000){vm.state.markdown?.content==content}
                if(name.endsWith(".md"))ui.onNodeWithText("源码").performClick()
                ui.onNodeWithText(content).assertIsDisplayed()
                Assert.assertTrue(vm.state.markdown?.hasBom==true)
                Assert.assertEquals(if(name.endsWith(".md"))NativeTextEncoding.UTF16_LE else NativeTextEncoding.UTF16_BE,vm.state.markdown?.encoding)
                if(android.os.Build.VERSION.SDK_INT>=29){
                    ui.onNodeWithText("保存").performClick()
                    ui.waitUntil(10000){savedFile(name)?.also{saved=it}!=null}
                    Assert.assertArrayEquals(bytes,resolver.openInputStream(saved!!)?.use{it.readBytes()})
                    ui.waitUntil(5000){runCatching{ui.onNodeWithText("保存").assertIsEnabled();true}.getOrDefault(false)}
                }
                ui.onNodeWithContentDescription("关闭阅读器").performClick()
                ui.waitUntil(5000){vm.state.markdown==null}
                Assert.assertEquals("读完编码文档再发送",vm.state.draft)
                Assert.assertEquals(1,vm.state.uploads.size)
                ui.onNodeWithContentDescription("移除文件").performClick()
                ui.waitUntil(5000){vm.state.uploads.isEmpty()}
            }finally{local.delete();(saved?:savedFile(name))?.let{resolver.delete(it,null,null)}}
        }
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun largeMarkdownAttachmentsAndOutputSaveWithoutPreviewFailure(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val resolver=context.contentResolver
        fun savedFile(name:String):android.net.Uri?=resolver.query(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            arrayOf(android.provider.MediaStore.Downloads._ID),
            "${android.provider.MediaStore.Downloads.DISPLAY_NAME}=? AND ${android.provider.MediaStore.Downloads.OWNER_PACKAGE_NAME}=? AND ${android.provider.MediaStore.Downloads.IS_PENDING}=0",
            arrayOf(name,context.packageName),null)?.use{cursor->if(cursor.moveToFirst())android.content.ContentUris.withAppendedId(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,cursor.getLong(0)) else null}
        val names=listOf("large-draft.md","large-output.md")
        val local=java.io.File(context.cacheDir,"outputs/large-draft.md").apply{parentFile?.mkdirs();writeBytes(largeMarkdownBytes)}
        val instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val monitor=instrumentation.addMonitor(android.content.IntentFilter(android.content.Intent.ACTION_VIEW).apply{addDataType("text/markdown");addDataScheme("content")},
            android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK,null),true)
        val unexpected=instrumentation.addMonitor(android.content.IntentFilter(android.content.Intent.ACTION_VIEW).apply{addDataType("*/*");addDataScheme("content")},
            android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK,null),true)
        try{
            for(name in names)savedFile(name)?.let{resolver.delete(it,null,null)}
            ui.runOnUiThread{vm.openThread(vm.state.threads.first().copy(projectPath="F:/Code/Codex-mobile-control"))}
            ui.waitUntil(10000){vm.state.threadId=="t"&&!vm.state.loadingHistory}
            val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",local)
            ui.runOnUiThread{vm.draft("大文档保留草稿");vm.uploadFiles(listOf(uri))}
            ui.waitUntil(15000){vm.state.uploads.size==1&&!vm.state.uploading}
            Assert.assertEquals(6L*1024*1024,vm.state.uploads.single().size)
            ui.onNodeWithText("large-draft.md").performClick()
            ui.waitUntil(15000){!vm.state.fileBusy}
            Assert.assertEquals("",vm.state.fileError)
            ui.waitUntil(5000){savedFile(names[0])!=null}
            Assert.assertArrayEquals(largeMarkdownBytes,resolver.openInputStream(savedFile(names[0])!!)?.use{it.readBytes()})
            Assert.assertEquals("text/markdown",resolver.getType(savedFile(names[0])!!))
            Assert.assertNull(vm.state.markdown)
            Assert.assertEquals("",vm.state.fileError)
            Assert.assertEquals(1,monitor.hits)
            ui.runOnUiThread{vm.openOutput("large-output.md")}
            ui.waitUntil(15000){!vm.state.fileBusy}
            Assert.assertEquals("",vm.state.fileError)
            ui.waitUntil(5000){savedFile(names[1])!=null}
            Assert.assertArrayEquals(largeMarkdownBytes,resolver.openInputStream(savedFile(names[1])!!)?.use{it.readBytes()})
            Assert.assertEquals("text/markdown",resolver.getType(savedFile(names[1])!!))
            Assert.assertNull(vm.state.markdown)
            Assert.assertEquals("",vm.state.fileError)
            Assert.assertEquals(2,monitor.hits)
            Assert.assertEquals(0,unexpected.hits)
            Assert.assertEquals("大文档保留草稿",vm.state.draft)
            Assert.assertEquals(1,vm.state.uploads.size)
            Assert.assertTrue(requests.isEmpty())
        }finally{
            instrumentation.removeMonitor(monitor)
            instrumentation.removeMonitor(unexpected)
            local.delete()
            for(name in names)savedFile(name)?.let{resolver.delete(it,null,null)}
        }
    }
    @androidx.test.filters.SdkSuppress(minSdkVersion=29)
    @Test fun genericCodeAndUnknownFilesSaveWithUsableMime(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val resolver=context.contentResolver
        val instrumentation=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        val monitor=instrumentation.addMonitor(android.content.IntentFilter(android.content.Intent.ACTION_VIEW).apply{addDataType("application/octet-stream");addDataScheme("content")},
            android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK,null),true)
        val unexpected=instrumentation.addMonitor(android.content.IntentFilter(android.content.Intent.ACTION_VIEW).apply{addDataType("*/*");addDataScheme("content")},
            android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK,null),true)
        fun savedFile(name:String):android.net.Uri?=resolver.query(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,
            arrayOf(android.provider.MediaStore.Downloads._ID),
            "${android.provider.MediaStore.Downloads.DISPLAY_NAME}=? AND ${android.provider.MediaStore.Downloads.OWNER_PACKAGE_NAME}=? AND ${android.provider.MediaStore.Downloads.IS_PENDING}=0",
            arrayOf(name,context.packageName),null)?.use{cursor->if(cursor.moveToFirst())android.content.ContentUris.withAppendedId(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,cursor.getLong(0)) else null}
        val files=listOf("draft-code.KT" to "fun main() { println(\"中文 <em>原文</em>\") }\n".toByteArray(),"unknown-mime.bin" to byteArrayOf(0,-128,-1))
        try{
            for((name,bytes) in files){
                savedFile(name)?.let{resolver.delete(it,null,null)}
                val local=java.io.File(context.cacheDir,"outputs/$name").apply{parentFile?.mkdirs();writeBytes(bytes)}
                try{
                    val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",local)
                    ui.runOnUiThread{vm.draft("保存文件后保留草稿");vm.uploadFiles(listOf(uri))}
                    ui.waitUntil(15000){vm.state.uploads.size==1&&!vm.state.uploading}
                    Assert.assertEquals(" Application/Octet-Stream; fixture=1 ",vm.state.uploads.single().mime)
                    ui.onNodeWithText(name).performClick()
                    if(name.endsWith(".KT")){
                        ui.waitUntil(10000){vm.state.markdown?.content==bytes.toString(Charsets.UTF_8)}
                        val document=checkNotNull(vm.state.markdown)
                        Assert.assertTrue(document.mime.startsWith("text/"))
                        ui.onNodeWithText(document.content).assertIsDisplayed()
                        ui.onNodeWithText("保存").performClick()
                        ui.waitUntil(10000){savedFile(name)!=null}
                        Assert.assertEquals("application/octet-stream",resolver.getType(savedFile(name)!!))
                        ui.waitUntil(5000){runCatching{ui.onNodeWithText("保存").assertIsEnabled();true}.getOrDefault(false)}
                        ui.onNodeWithContentDescription("关闭阅读器").performClick()
                        ui.waitUntil(5000){vm.state.markdown==null}
                    }else{
                        ui.waitUntil(10000){!vm.state.fileBusy}
                        Assert.assertEquals("",vm.state.fileError)
                        ui.waitUntil(5000){savedFile(name)!=null}
                        Assert.assertEquals("application/octet-stream",resolver.getType(savedFile(name)!!))
                        Assert.assertEquals(1,monitor.hits)
                        Assert.assertEquals(0,unexpected.hits)
                    }
                    Assert.assertArrayEquals(bytes,resolver.openInputStream(savedFile(name)!!)?.use{it.readBytes()})
                    Assert.assertEquals("保存文件后保留草稿",vm.state.draft)
                    Assert.assertEquals(1,vm.state.uploads.size)
                    ui.onNodeWithContentDescription("移除文件").performClick()
                    ui.waitUntil(5000){vm.state.uploads.isEmpty()}
                }finally{local.delete();savedFile(name)?.let{resolver.delete(it,null,null)}}
            }
            Assert.assertTrue(requests.isEmpty())
        }finally{instrumentation.removeMonitor(monitor);instrumentation.removeMonitor(unexpected)}
    }
    @Test fun desktopHistoryImageRendersWithoutMarkup(){
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","history:t:8").put("text","查看这张图")
            .put("attachments",org.json.JSONArray().put(JSONObject().put("name","Image #1").put("path","C:/Users/Test/AppData/Local/Temp/codex-clipboard-test.png")
                .put("url","/api/threads/t/history-image?eventId=history%3At%3A8&index=0")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="history:t:8"}}
        ui.waitUntil(10000){runCatching{ui.onNodeWithContentDescription("图片").assertIsDisplayed();true}.getOrDefault(false)}
        ui.onNodeWithText("查看这张图").assertIsDisplayed()
        ui.onNodeWithText("<image",substring=true).assertDoesNotExist()
    }
    @Test fun returningToAnImageMessageDoesNotDownloadItsThumbnailAgain(){
        val rows=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","history:t:image").put("text","缩略图回归 0")
            .put("attachments",org.json.JSONArray().put(JSONObject().put("name","Image #1").put("path","C:/Temp/image.png")
                .put("url","/api/threads/t/history-image?eventId=history%3At%3Aimage&index=0"))))
        for(i in 1..30)rows.put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","image-scroll-$i").put("text","缩略图回归 $i"))
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.size==31}
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.waitUntil(10000){historyImageRequests.get()>=1}
        ui.onNodeWithTag("messages").performScrollToIndex(29)
        ui.onNodeWithText("缩略图回归 29").assertIsDisplayed()
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        ui.onNodeWithText("缩略图回归 0").assertIsDisplayed()
        ui.onNodeWithContentDescription("图片").assertIsDisplayed()
        ui.waitForIdle()
        Assert.assertEquals("回看时不应重新下载同一缩略图",1,historyImageRequests.get())
    }
    @Test fun slashShortcutsOpenUsageAndModelWithoutSendingMessages(){
        ui.onNodeWithTag("composer").performTextReplacement("/usage")
        ui.onNode(hasText("/usage") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.onNodeWithText("连接状态").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭").performClick()
        ui.onNodeWithTag("composer").performTextReplacement("/model")
        ui.onNode(hasText("/model") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.onNodeWithText("权限与更多设置").assertIsDisplayed()
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun desktopPinChangesRefreshBothListsWithoutMobileAction(){
        pinSyncEnabled=true
        ui.runOnUiThread{vm.connect(vm.state.address,"test")}
        ui.waitUntil(10000){"sidebar-pin-sync" in vm.state.capabilities&&vm.state.projects.any{it.id=="p"}}
        val project=vm.state.projects.first{it.id=="p"}
        val key="codex:"+nativePath(project.path)
        ui.runOnUiThread{vm.loadProjectThreads(project)}
        ui.waitUntil(10000){vm.state.projectThreads[key]?.rows?.any{it.id=="t"}==true}
        threadPinned=true
        ui.waitUntil(6000){vm.state.threads.any{it.id=="t"&&it.pinnedIndex>=0}&&vm.state.projectThreads[key]!!.rows.any{it.id=="t"&&it.pinnedIndex>=0}}
        threadPinned=false
        ui.waitUntil(6000){vm.state.threads.any{it.id=="t"&&it.pinnedIndex<0}&&vm.state.projectThreads[key]!!.rows.any{it.id=="t"&&it.pinnedIndex<0}}
        Assert.assertEquals("桌面变更同步不应发送手机置顶请求",0,mobilePinRequests.get())
    }
    @Test fun slashPinTogglesCurrentThreadAndNewKeepsItsProject(){
        ui.waitUntil(10000){vm.state.projects.any{it.id=="p"}}
        val project=vm.state.projects.first{it.id=="p"}
        val projectKey="codex:"+nativePath(project.path)
        ui.runOnUiThread{vm.loadProjectThreads(project)}
        ui.waitUntil(10000){vm.state.projectThreads[projectKey]?.rows?.any{it.id=="t"}==true}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first().copy(projectPath="F:/Code/Codex-mobile-control"))}
        ui.waitUntil(10000){vm.state.projectId=="p"&&!vm.state.loadingHistory}
        ui.onNodeWithTag("composer").performTextReplacement("/pin")
        ui.onNode(hasText("/pin") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.waitUntil(10000){threadPinned&&vm.state.threads.any{it.id=="t"&&it.pinnedIndex>=0}}
        ui.runOnIdle{Assert.assertTrue(vm.state.projectThreads[projectKey]!!.rows.first{it.id=="t"}.pinnedIndex>=0)}
        ui.onNodeWithTag("composer").performTextReplacement("/pin")
        ui.onNode(hasText("/pin") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.waitUntil(10000){!threadPinned&&vm.state.threads.any{it.id=="t"&&it.pinnedIndex<0}}
        ui.runOnIdle{Assert.assertTrue(vm.state.projectThreads[projectKey]!!.rows.first{it.id=="t"}.pinnedIndex<0)}
        ui.onNodeWithTag("composer").performTextReplacement("/new")
        ui.onNode(hasText("/new") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.runOnIdle{Assert.assertEquals("p",vm.state.projectId);Assert.assertTrue(vm.state.threadId.isBlank());Assert.assertTrue(requests.isEmpty())}
    }
    @Test fun effortCommandOpensSliderAtTopOfCompactList(){
        ui.waitUntil(10000){vm.state.models.any{it.efforts.size>1}}
        ui.onNodeWithTag("composer").performTextReplacement("/")
        val density=ApplicationProvider.getApplicationContext<Application>().resources.displayMetrics.density
        val menuHeight=ui.onNodeWithTag("slashCommands",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot.height
        Assert.assertTrue("命令建议应保持紧凑",menuHeight<=228f*density)
        screenshot("native-commands-06105.png")
        ui.onNodeWithTag("composer").performTextReplacement("/effort")
        ui.onNode(hasText("/effort") and hasAnyAncestor(hasTestTag("slashCommands"))).performClick()
        ui.onNodeWithTag("effortSlider").assertIsDisplayed()
        Assert.assertTrue(requests.isEmpty())
    }
    @Test fun historyImageWithoutMappedUrlStillUsesPreviewRoute(){
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","history:t:9").put("text","旧版图片")
            .put("attachments",org.json.JSONArray().put(JSONObject().put("name","old.png").put("path","C:/Users/Test/AppData/Local/Temp/old.png")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="history:t:9"}}
        ui.waitUntil(10000){runCatching{ui.onNodeWithContentDescription("图片").assertExists();true}.getOrDefault(false)}
    }
    @Test fun multipleImagesStayCompactWithMessageText(){
        val images=org.json.JSONArray()
        repeat(4){images.put(JSONObject().put("id","pixel.png").put("name","图 ${it+1}"))}
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","image-grid").put("text","图文同条消息").put("images",images)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==4}
        val tiles=ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().map{it.boundsInRoot}.sortedWith(compareBy({it.top},{it.left}))
        val density=ApplicationProvider.getApplicationContext<Application>().resources.displayMetrics.density
        Assert.assertTrue("图片应是缩略图",tiles.all{it.width<=112f*density})
        Assert.assertTrue("第一行应有两张图片",kotlin.math.abs(tiles[0].top-tiles[1].top)<8f*density)
        Assert.assertTrue("第二行应有两张图片",kotlin.math.abs(tiles[2].top-tiles[3].top)<8f*density)
        Assert.assertTrue("两行图片应在同一条消息中",tiles[2].top>tiles[0].bottom)
        val message=ui.onNodeWithText("图文同条消息").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("缩略图应独立排在文字气泡上方",tiles.last().bottom<message.top)
        screenshot("native-image-message-grid.png")
    }
    @Test fun duplicateGalleryThumbnailsShareOneDelayedFetch(){
        imageBodyDelayMs=1000
        val images=org.json.JSONArray().apply{repeat(3){put(JSONObject().put("id","pixel.png").put("name","Repeated synthetic image $it"))}}
        historyStatus="completed"
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","deduplicated-gallery").put("text","Synthetic gallery").put("images",images)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==3}
        Assert.assertEquals("Repeated endpoints should share one download and decode",1,previewImageRequests.get())
        ui.onAllNodesWithContentDescription("图片").onFirst().performClick()
        ui.onNodeWithContentDescription("图片预览").assertExists()
    }
    @Test fun failedFullImageKeepsThumbnailAndOffersExplicitRetry(){
        failFirstFullImage=true;historyStatus="completed"
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","full-retry").put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==1}
        ui.onNodeWithContentDescription("图片").performClick()
        ui.waitUntil(10000){ui.onAllNodesWithTag("imagePreviewRetry").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("图片预览").assertExists()
        screenshot("native-full-image-error-with-thumbnail.png")
        ui.onNodeWithTag("imagePreviewRetry").performClick()
        ui.waitUntil(10000){ui.onAllNodesWithTag("fullImageLayer",useUnmergedTree=true).fetchSemanticsNodes().isNotEmpty()}
        Assert.assertEquals(3,previewImageRequests.get())
        ui.onNodeWithTag("imagePreviewRetry").assertDoesNotExist()
    }
    @Test fun rapidNavigationDuringImageLoadStartsFreshRequestWithoutLateCache(){
        imageBodyDelayMs=2000;historyStatus="completed"
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","slow-image").put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){previewImageRequests.get()==1}
        ui.runOnUiThread{vm.newThread()}
        ui.waitUntil(5000){ui.onAllNodesWithTag("sentImageGallery",useUnmergedTree=true).fetchSemanticsNodes().isEmpty()}
        Assert.assertNull(vm.thumbnailCache.get("/api/uploads/images/pixel.png"))
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==1}
        Assert.assertEquals(2,previewImageRequests.get())
    }
    @Test fun touchingGalleryMidTransitionCancelsThePendingPageChange(){
        val images=org.json.JSONArray().apply{repeat(3){put(JSONObject().put("id","pixel.png"))}}
        historyStatus="completed"
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","interrupt-gallery").put("images",images)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==3}
        ui.onAllNodesWithContentDescription("图片").onFirst().performClick()
        ui.onNodeWithTag("imagePreviewGestureSurface").assertExists();ui.waitForIdle()
        try{
            ui.mainClock.autoAdvance=false
            ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{swipe(center,center+Offset(-width*.55f,0f),250)}
            ui.mainClock.advanceTimeBy(64)
            ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{down(center)}
            ui.mainClock.advanceTimeBy(300)
            ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"100% · 1/3"))
            ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{up()}
            ui.mainClock.advanceTimeBy(400)
            ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"100% · 1/3"))
        }finally{ui.mainClock.autoAdvance=true}
    }
    @Test fun disconnectAndReconnectCannotKeepAnOldGatewayImagePreview(){
        historyStatus="completed"
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","connection-image").put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==1}
        ui.onNodeWithContentDescription("图片").performClick()
        ui.onNodeWithTag("imagePreviewGestureSurface").assertExists()
        val previous=previewImageRequests.get()
        ui.runOnUiThread{vm.disconnect()}
        ui.waitUntil(5000){ui.onAllNodesWithTag("imagePreviewGestureSurface").fetchSemanticsNodes().isEmpty()}
        ui.runOnUiThread{vm.connect(server.url("/").toString().trimEnd('/'),"test")}
        ui.waitUntil(10000){vm.state.connected&&vm.state.threads.isNotEmpty()}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==1&&previewImageRequests.get()>previous}
    }
    @Test fun imagesInOneMessageSwipeWithinTheirGallery(){
        val images=org.json.JSONArray()
        repeat(3){images.put(JSONObject().put("id","pixel.png").put("name","图 ${it+1}"))}
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","swipe-gallery").put("text","三张同条图片").put("images",images)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size==3}
        ui.onAllNodesWithContentDescription("图片").onFirst().performClick()
        ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"100% · 1/3"))
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{down(center);moveBy(Offset(-width*.35f,0f))}
        ui.onNodeWithTag("imagePreviewNeighbor",useUnmergedTree=true).assertExists()
        screenshot("native-image-swipe-transition.png")
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{up()}
        ui.waitUntil(5000){ui.onNodeWithContentDescription("图片预览").fetchSemanticsNode().config[SemanticsProperties.StateDescription]=="100% · 2/3"}
        ui.onNodeWithTag("imagePreviewNeighbor",useUnmergedTree=true).assertDoesNotExist()
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{swipe(center,center+Offset(-width*.55f,0f),250)}
        ui.waitUntil(5000){ui.onNodeWithContentDescription("图片预览").fetchSemanticsNode().config[SemanticsProperties.StateDescription]=="100% · 3/3"}
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{swipe(center,center+Offset(width*.1f,0f),500)}
        ui.waitUntil(5000){ui.onAllNodesWithTag("imagePreviewNeighbor",useUnmergedTree=true).fetchSemanticsNodes().isEmpty()}
        ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"100% · 3/3"))
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{swipe(center,center+Offset(width*.55f,0f),250)}
        ui.waitUntil(5000){ui.onNodeWithContentDescription("图片预览").fetchSemanticsNode().config[SemanticsProperties.StateDescription]=="100% · 2/3"}
    }
    @Test fun imageOnlyMessageDoesNotRenderEmptyBubble(){
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","image-only").put("text","")
            .put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png").put("name","单张图片")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="image-only"}}
        ui.onNodeWithTag("sentImageGallery",useUnmergedTree=true).performScrollTo().assertIsDisplayed()
        ui.onNodeWithTag("outgoingBubble",useUnmergedTree=true).assertDoesNotExist()
    }
    @Test fun imageOnlyDesktopHistoryLoadsEmbeddedPreview(){
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","history:t:embedded:9").put("text","")
            .put("attachments",org.json.JSONArray().put(JSONObject().put("name","图片 1").put("path","history-embedded-image:0.png")
                .put("url","/api/threads/t/history-image?eventId=history%3At%3Aembedded%3A9&index=0")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){historyImageRequests.get()>0&&ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithTag("sentImageGallery",useUnmergedTree=true).assertIsDisplayed()
        ui.onNodeWithTag("outgoingBubble",useUnmergedTree=true).assertDoesNotExist()
    }
    @Test fun singleDraftImageAndOddGalleryRowStayThumbnailSized(){
        val file=java.io.File(ApplicationProvider.getApplicationContext<Application>().cacheDir,"single-draft.jpg").apply{writeBytes(byteArrayOf(1,2,3))}
        try{
            ui.runOnUiThread{vm.uploadImages(listOf(android.net.Uri.fromFile(file)))}
            ui.waitUntil(10000){vm.state.images.size==1&&!vm.state.uploading}
            val density=ApplicationProvider.getApplicationContext<Application>().resources.displayMetrics.density
            val draft=ui.onNodeWithTag("draftImageGallery",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
            Assert.assertTrue("单张待发图片应为小缩略图",draft.width<=116f*density&&draft.height<=123f*density)
            val images=org.json.JSONArray().apply{repeat(3){put(JSONObject().put("id","pixel.png").put("name","图 $it"))}}
            history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","odd-image-grid").put("text","三张图").put("images",images)).toString()
            ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
            ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().size>=3}
            val tiles=ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().map{it.boundsInRoot}
            Assert.assertTrue("多张图片最后一张不应放大",tiles.all{it.width<=112f*density})
        }finally{file.delete()}
    }
    @Test fun activityTimelineShowsCompactSummaryAndKeepsDetails(){
        history=org.json.JSONArray()
            .put(JSONObject().put("type","tool.started").put("threadId","t").put("eventId","tool-start").put("itemId","cmd-1").put("title","检查构建").put("command","./gradlew test"))
            .put(JSONObject().put("type","tool.output").put("threadId","t").put("eventId","tool-output").put("itemId","cmd-1").put("text","BUILD SUCCESSFUL"))
            .put(JSONObject().put("type","tool.completed").put("threadId","t").put("eventId","tool-end").put("itemId","cmd-1").put("status","completed"))
            .put(JSONObject().put("type","reasoning.summary").put("threadId","t").put("eventId","reasoning").put("text","**接下来检查界面布局。**"))
            .put(JSONObject().put("type","file.changed").put("threadId","t").put("eventId","changed").put("title","文件改动").put("detail","NativeScreen.kt"))
            .put(JSONObject().put("type","tool.started").put("threadId","t").put("eventId","view").put("itemId","img").put("title","查看图片").put("detail","![查看图片](<F:/Code/Codex-mobile-control/plot.png>)"))
            .put(JSONObject().put("type","context.compaction").put("threadId","t").put("eventId","compact").put("status","ok"))
            .put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","answer").put("text","界面已经调整。"))
            .toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="answer"}}
        ui.onNodeWithText("接下来检查界面布局。").assertIsDisplayed()
        ui.onNodeWithText("上下文已自动压缩").assertIsDisplayed()
        ui.onNodeWithText("BUILD SUCCESSFUL").assertDoesNotExist()
        screenshot("native-activity-compact.png")
        ui.onNodeWithText("接下来检查界面布局。").performClick()
        ui.onNodeWithText("接下来检查界面布局。").assertIsDisplayed()
        ui.onNodeWithText("**接下来检查界面布局。**").assertDoesNotExist()
        ui.onNodeWithText("编辑文件").assertIsDisplayed()
        ui.onNodeWithText("检查构建").assertIsDisplayed()
        ui.onNodeWithText("检查构建").performClick()
        ui.onNodeWithText("BUILD SUCCESSFUL",substring=true).assertIsDisplayed()
        ui.onNodeWithText("检查构建").performClick()
        ui.onNodeWithText("查看图片").performClick()
        ui.waitUntil(10000){rawFileCount.get()>0}
        ui.onNodeWithContentDescription("图片").assertExists()
        screenshot("native-activity-image.png")
    }
    @Test fun conversationHeaderAndAttachmentMenuAreCompact(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithTag("conversationTitle").assertTextEquals("原生测试")
        ui.onNodeWithContentDescription("添加附件").performClick()
        ui.onNodeWithText("图片与视频").assertIsDisplayed()
        ui.onNodeWithText("文件").assertIsDisplayed()
        screenshot("native-attachment-menu-016.png")
    }
    @Test fun switchingConversationDiscardsPendingUploadResult(){
        val context=ApplicationProvider.getApplicationContext<Application>()
        val file=java.io.File(context.cacheDir,"switch-upload.jpg").apply{writeBytes(byteArrayOf(1,2,3))}
        val uri=android.net.Uri.fromFile(file)
        try {
            ui.runOnUiThread{vm.uploadImages(listOf(uri,uri))}
            ui.waitUntil(10000){uploadCount.get()==2&&vm.state.images.size==1}
            ui.runOnUiThread{vm.newThread()}
            releaseUpload.countDown()
            ui.waitUntil(10000){!vm.state.uploading}
            Assert.assertTrue(vm.state.images.isEmpty())
        } finally {file.delete()}
    }
    @Test fun uploadedImageAndFormulaRenderNatively(){
        val rows=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","image").put("text","检查图片和公式").put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png").put("name","pixel.png"))))
        rows.put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","math").put("text","公式 \$x^2 + y^2 = z^2\$"))
        history=rows.toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("图片").assertIsDisplayed()
        ui.waitUntil(10000){
            var found=false
            fun scan(v:android.view.View){if(v is android.widget.TextView){val text=v.text;if(text is android.text.Spanned&&text.getSpans(0,text.length,Any::class.java).any{it.javaClass.name.contains("JLatex")})found=true};if(v is android.view.ViewGroup)(0 until v.childCount).forEach{scan(v.getChildAt(it))}}
            ui.runOnUiThread{scan(ui.activity.window.decorView)};found
        }
        screenshot("native-image-math.png")
        ui.onNodeWithContentDescription("图片").performClick()
        ui.onNodeWithContentDescription("图片预览").assertIsDisplayed()
        screenshot("native-image-fullscreen-061.png")
        ui.onNodeWithContentDescription("图片预览").performTouchInput { doubleClick() }
        ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"250% · 1/1"))
        ui.onNodeWithContentDescription("图片预览").performTouchInput { doubleClick() }
        ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"100% · 1/1"))
        ui.onNodeWithContentDescription("放大图片").performClick()
        ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"200% · 1/1"))
        ui.onNodeWithContentDescription("复位图片").performClick()
        ui.onNodeWithContentDescription("图片预览").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"100% · 1/1"))
        val context=ApplicationProvider.getApplicationContext<Application>()
        val output=java.io.File(context.cacheDir,"outputs/saved-test.png").apply{parentFile!!.mkdirs();delete()}
        val uri=androidx.core.content.FileProvider.getUriForFile(context,context.packageName+".files",output)
        saveTarget=uri
        try {
            ui.onNodeWithContentDescription("保存图片").performClick()
            ui.waitUntil(10000){output.exists()&&output.length()>0}
            Assert.assertEquals(1,savePickerRequests)
            Assert.assertArrayEquals(android.util.Base64.decode("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJUlEQVR4AYXBAQEAIAyAMCSN6QxrId9AtrXPfXxIkCBBggQJEgZ8KAJ3pT0W6wAAAABJRU5ErkJggg==",0),output.readBytes())
        } finally {output.delete()}
        ui.onNodeWithContentDescription("图片预览").performTouchInput { swipeDown() }
        ui.waitUntil(5000){runCatching{ui.onNodeWithContentDescription("图片预览").assertDoesNotExist();true}.getOrDefault(false)}
    }
    @Test fun fullImageReplacementKeepsDismissGesture(){
        holdFullImage=true
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","image").put("text","预览图片").put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png").put("name","pixel.png")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("图片").performClick()
        ui.waitUntil(5000){previewImageRequests.get()>=2}
        val originalHeight=ui.onNodeWithContentDescription("图片预览").fetchSemanticsNode().boundsInRoot.height
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{down(center);moveBy(Offset(0f,80f))}
        releaseFullImage.countDown()
        ui.waitUntil(5000){ui.onAllNodesWithTag("fullImageLayer",useUnmergedTree=true).fetchSemanticsNodes().isNotEmpty()}
        Assert.assertEquals(originalHeight,ui.onNodeWithContentDescription("图片预览").fetchSemanticsNode().boundsInRoot.height,2f)
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{moveBy(Offset(0f,height*.35f));up()}
        ui.waitUntil(5000){ui.onAllNodesWithTag("imagePreviewGestureSurface").fetchSemanticsNodes().isEmpty()}
    }
    @Test fun transientImageFailureRecoversWithoutManualRetry(){
        failFirstImage=true
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","image-retry").put("text","检查图片重试").put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png").put("name","pixel.png")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){previewImageRequests.get()>=2&&ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("图片").assertIsDisplayed()
    }
    @Test fun shortSlowImageDragReturnsButQuickFlickCloses(){
        history=org.json.JSONArray().put(JSONObject().put("type","user.message").put("threadId","t").put("eventId","drag-image").put("text","手势预览").put("images",org.json.JSONArray().put(JSONObject().put("id","pixel.png").put("name","pixel.png")))).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("图片").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("图片").performClick()
        ui.waitUntil(5000){previewImageRequests.get()>=2}
        val originalTop=ui.onNodeWithContentDescription("图片预览").fetchSemanticsNode().boundsInRoot.top
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{swipe(center,center+Offset(0f,140f),350)}
        ui.waitUntil(3000){kotlin.math.abs(ui.onNodeWithContentDescription("图片预览").fetchSemanticsNode().boundsInRoot.top-originalTop)<4f}
        ui.onNodeWithTag("imagePreviewGestureSurface").performTouchInput{swipe(center,center+Offset(0f,140f),50)}
        ui.waitUntil(5000){ui.onAllNodesWithTag("imagePreviewGestureSurface").fetchSemanticsNodes().isEmpty()}
    }
    @Test fun darkThemeUpdatesMarkdownAndPersists(){
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){!vm.state.loadingHistory}
        ui.onNodeWithContentDescription("会话菜单").performClick()
        ui.onNodeWithText("设置").performClick();ui.onNodeWithTag("settings:appearance").performClick()
        ui.onNodeWithText("深色").performClick()
        ui.waitUntil(5000){!androidx.core.view.WindowCompat.getInsetsController(ui.activity.window,ui.activity.window.decorView).isAppearanceLightStatusBars}
        val preferences=ApplicationProvider.getApplicationContext<Application>().getSharedPreferences("appearance",0)
        Assert.assertEquals("dark",preferences.getString("theme",null))
        ui.onNodeWithContentDescription("返回").performClick();ui.onNodeWithContentDescription("返回").performClick()
        var readable=false
        ui.runOnUiThread{fun scan(v:android.view.View){if(v is android.widget.TextView&&v.text.contains("Markdown"))readable=v.currentTextColor==android.graphics.Color.rgb(241,242,244);if(v is android.view.ViewGroup)(0 until v.childCount).forEach{scan(v.getChildAt(it))}};scan(ui.activity.window.decorView)}
        Assert.assertTrue(readable)
        screenshot("native-dark.png")
        ui.onNodeWithContentDescription("会话菜单").performClick();ui.onNodeWithText("设置").performClick();ui.onNodeWithTag("settings:appearance").performClick();ui.onNodeWithText("浅色").performClick()
        ui.waitUntil(5000){androidx.core.view.WindowCompat.getInsetsController(ui.activity.window,ui.activity.window.decorView).isAppearanceLightStatusBars}
    }
    @Test fun richDocumentAndCopyActions(){
        historyStatus="completed"
        val document="""
            ## 一次清晰的实现
            先把问题拆成两个步骤，再验证结果。行内公式 ${'$'}E=mc^2${'$'} 可以直接阅读。

            ${'$'}${'$'}
            \sum_{i=1}^{n} x_i^2 = \frac{n(n+1)(2n+1)}{6}
            ${'$'}${'$'}

            | 检查项 | 结果 | 说明 |
            | --- | --- | --- |
            | 连接 | 正常 | 已连接到电脑 |
            | 队列 | 就绪 | 当前任务完成后继续 |

            ```kotlin
            fun greet(name: String) = "Hello, " + name
            ```
        """.trimIndent()
        history=org.json.JSONArray().put(JSONObject().put("type","message.delta").put("threadId","t").put("eventId","rich").put("text",document)).toString()
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.isNotEmpty()}
        ui.waitForIdle()
        // Begin reading with a real gesture, then jump within the detached list.
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0)
        screenshot("native-rich-050.png")
        val table=ui.onNodeWithTag("markdownTable").performScrollTo()
        ui.onNodeWithText("检查项").assertIsDisplayed()
        ui.onNodeWithText("连接").assertIsDisplayed()
        ui.onNodeWithText("说明").assertIsDisplayed()
        ui.waitForIdle()
        Assert.assertEquals("三列表格应完整放入手机宽度",0f,table.fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange].maxValue(),0.5f)
        ui.onNodeWithContentDescription("复制代码").performScrollTo().performClick()
        val clipboard=ApplicationProvider.getApplicationContext<Application>().getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        ui.runOnUiThread{Assert.assertEquals("fun greet(name: String) = \"Hello, \" + name",clipboard.primaryClip!!.getItemAt(0).text.toString())}
        ui.onNodeWithContentDescription("复制回复").performScrollTo().performClick()
        ui.runOnUiThread{Assert.assertEquals(document,clipboard.primaryClip!!.getItemAt(0).text.toString())}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        screenshot("native-drawer-050.png")
    }

    @Test fun sidebarLoadsTenThreadsAndFiveProjectsThenExpandsOnDemand(){
        pagedSidebar=true
        ui.runOnUiThread{vm.connect(server.url("/").toString().trimEnd('/'),"test")}
        ui.waitUntil(10000){vm.state.threads.firstOrNull()?.title=="分页会话 0"&&!vm.state.loadingSidebar&&!vm.state.connecting}
        ui.runOnIdle{Assert.assertEquals(10,vm.state.threads.size);Assert.assertEquals(5,vm.state.sidebarProjects.size);Assert.assertTrue(vm.state.moreThreads);Assert.assertTrue(vm.state.moreProjects)}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        // The drawer and keyed rows move before their touch positions settle.
        ui.mainClock.advanceTimeBy(350);ui.waitForIdle()
        ui.onNodeWithTag("sidebarList").performScrollToNode(hasText("加载更多会话"))
        ui.waitForIdle();ui.onNodeWithText("加载更多会话").assertIsEnabled().performClick()
        try{ui.waitUntil(10000){vm.state.threads.size==20&&!vm.state.loadingSidebar}}
        catch(error:androidx.compose.ui.test.ComposeTimeoutException){throw AssertionError("Pagination: rows=${vm.state.threads.size}, loading=${vm.state.loadingSidebar}, requests=$sidebarRequests, error=${vm.state.error}",error)}
        ui.onNodeWithTag("sidebarList").performScrollToNode(hasText("加载更多项目"))
        ui.onNodeWithText("加载更多项目").performClick()
        ui.waitUntil(10000){vm.state.sidebarProjects.size==10&&!vm.state.loadingSidebar}
        ui.onNodeWithTag("sidebarList").performScrollToNode(hasText("加载更多会话"))
        ui.waitForIdle();ui.onNodeWithText("加载更多会话").assertIsEnabled().performClick()
        ui.waitUntil(10000){vm.state.threads.size==24&&!vm.state.loadingSidebar}
        ui.onNodeWithText("加载更多会话").assertDoesNotExist()
        ui.runOnIdle{Assert.assertEquals(24,vm.state.threads.map{it.id}.distinct().size);Assert.assertFalse(vm.state.moreThreads);Assert.assertTrue(sidebarRequests.contains("/api/threads:10"));Assert.assertTrue(sidebarRequests.contains("/api/sidebar:5"))}
        val project=Project("p0","最近项目 0","F:/p0",true)
        val key="codex:"+nativePath(project.path)
        ui.runOnUiThread{vm.loadProjectThreads(project)}
        ui.waitUntil(10000){vm.state.projectThreads[key]?.rows?.size==10&&vm.state.projectThreads[key]?.loading==false}
        ui.runOnUiThread{vm.loadProjectThreads(project,true)}
        ui.waitUntil(10000){vm.state.projectThreads[key]?.rows?.size==20&&vm.state.projectThreads[key]?.loading==false}
        ui.runOnIdle{Assert.assertEquals(24,vm.state.threads.size)}
    }

    @Test fun loadingMoreProjectsKeepsTheRecentHeadingInPlace(){
        pagedSidebar=true
        ui.runOnUiThread{vm.connect(server.url("/").toString().trimEnd('/'),"test")}
        ui.waitUntil(10000){vm.state.sidebarProjects.size==5&&vm.state.threads.size==10}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        // Put this heading at the start of the viewport so LazyColumn must retain its key.
        ui.onNodeWithTag("sidebarList").performScrollToIndex(7)
        ui.waitForIdle()
        val top=ui.onNodeWithText("最近会话").fetchSemanticsNode().boundsInRoot.top
        ui.runOnUiThread{vm.loadMoreProjects()}
        ui.waitUntil(10000){vm.state.sidebarProjects.size==10&&!vm.state.loadingSidebar}
        ui.waitForIdle()
        Assert.assertEquals("项目分页不应把正在看的最近会话标题移走",top,ui.onNodeWithText("最近会话").fetchSemanticsNode().boundsInRoot.top,3f)
    }

    @Test fun projectSectionFrameSample(){
        pagedSidebar=true
        ui.runOnUiThread{vm.connect(server.url("/").toString().trimEnd('/'),"test")}
        ui.waitUntil(10000){vm.state.sidebarProjects.size==5}
        val project=Project("p0","最近项目 0","F:/p0",true)
        val key="codex:"+nativePath(project.path)
        ui.runOnUiThread{vm.loadProjectThreads(project)}
        ui.waitUntil(10000){vm.state.projectThreads[key]?.rows?.size==10}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("最近项目 0").performScrollTo()
        ui.waitForIdle()
        val frames=java.util.Collections.synchronizedList(mutableListOf<Long>())
        val phases=java.util.Collections.synchronizedList(mutableListOf<LongArray>())
        val handlerThread=android.os.HandlerThread("project-frame-sample").apply{start()}
        val listener=android.view.Window.OnFrameMetricsAvailableListener{_,metrics,_->
            frames.add(metrics.getMetric(android.view.FrameMetrics.TOTAL_DURATION))
            phases.add(intArrayOf(android.view.FrameMetrics.LAYOUT_MEASURE_DURATION,android.view.FrameMetrics.DRAW_DURATION,android.view.FrameMetrics.SYNC_DURATION,android.view.FrameMetrics.COMMAND_ISSUE_DURATION,android.view.FrameMetrics.SWAP_BUFFERS_DURATION,android.view.FrameMetrics.UNKNOWN_DELAY_DURATION).map{metrics.getMetric(it)}.toLongArray())
        }
        ui.runOnUiThread{ui.activity.window.addOnFrameMetricsAvailableListener(listener,android.os.Handler(handlerThread.looper))}
        try{repeat(4){ui.onNodeWithText("最近项目 0").performClick();Thread.sleep(300)}}
        finally{ui.runOnUiThread{ui.activity.window.removeOnFrameMetricsAvailableListener(listener)};handlerThread.quitSafely();handlerThread.join()}
        val values=synchronized(frames){frames.toList().sorted()}
        Assert.assertTrue("展开项目需采集到帧",values.isNotEmpty())
        val result=JSONObject().put("frames",values.size).put("p50Ms",values[values.size/2]/1e6).put("p95Ms",values[((values.size-1)*0.95).toInt()]/1e6).put("over16ms",values.count{it>16666667})
        listOf("layout","draw","sync","command","swap","unknown").forEachIndexed{index,name->
            val samples=synchronized(phases){phases.map{it[index]}.sorted()}
            if(samples.isNotEmpty())result.put(name+"P95Ms",samples[((samples.size-1)*0.95).toInt()]/1e6)
        }
        android.util.Log.i("CodexProjectFrame",result.toString())
        java.io.File(ui.activity.getExternalFilesDir(null),"project-frame-sample.json").writeText(result.toString())
    }
    @Test fun reopeningLoadedProjectDoesNotFetchTheSamePageAgain(){
        pagedSidebar=true
        ui.runOnUiThread{vm.connect(server.url("/").toString().trimEnd('/'),"test")}
        ui.waitUntil(10000){vm.state.sidebarProjects.size==5}
        val project=Project("p0","最近项目 0","F:/p0",true)
        val key="codex:"+nativePath(project.path)
        ui.runOnUiThread{vm.loadProjectThreads(project)}
        ui.waitUntil(10000){vm.state.projectThreads[key]?.loaded==true}
        val before=sidebarRequests.count{it=="/api/threads:10"}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        repeat(4){ui.onNodeWithText("最近项目 0").performClick();ui.waitForIdle()}
        Assert.assertEquals("重新展开已加载项目不应重复请求同一页",before,sidebarRequests.count{it=="/api/threads:10"})
    }

    @Test fun expandedProjectOnlyComposesVisibleThreads(){
        pagedSidebar=true
        ui.runOnUiThread{vm.connect(server.url("/").toString().trimEnd('/'),"test")}
        ui.waitUntil(10000){vm.state.sidebarProjects.size==5}
        val project=Project("p0","最近项目 0","F:/p0",true)
        val key="codex:"+nativePath(project.path)
        ui.runOnUiThread{vm.loadProjectThreads(project)}
        ui.waitUntil(10000){vm.state.projectThreads[key]?.rows?.size==10}
        repeat(2){ui.runOnUiThread{vm.loadProjectThreads(project,true)};ui.waitUntil(10000){vm.state.projectThreads[key]?.loading==false}}
        ui.waitUntil(10000){vm.state.projectThreads[key]?.rows?.size==24}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("最近项目 0").performClick()
        ui.waitForIdle()
        ui.onAllNodesWithTag("threadRow:t").onFirst().assertIsDisplayed()
        val composed=(1 until 24).count{ui.onAllNodesWithTag("threadRow:page-$it").fetchSemanticsNodes().isNotEmpty()}
        Assert.assertTrue("展开项目时应按可见范围创建会话行，实际创建 $composed/23",composed<23)
        ui.onNodeWithTag("sidebarList").performScrollToNode(hasTestTag("threadRow:page-23"))
        ui.onNodeWithTag("threadRow:page-23").assertIsDisplayed()
    }

    @Test fun completedUnreadFollowsDesktopAndVisibleLatestResult(){
        fun listed(unread:Boolean,at:Long)=JSONObject().put("threads",org.json.JSONArray().put(JSONObject().put("id","t").put("title","完成未读状态同步").put("status","completed").put("unread",unread).put("completedAt",at))).toString()
        fun completed(at:Long)="""[{"type":"user.message","threadId":"t","eventId":"question-$at","text":"核对完成未读提示"},{"type":"message.delta","threadId":"t","eventId":"answer-$at","text":"本轮任务已完成。"},{"type":"turn.completed","threadId":"t","eventId":"done-$at","createdAt":"${java.time.Instant.ofEpochMilli(at)}","status":"completed"}]"""
        fun refresh(){
            val expected=JSONObject(sidebarFixture).getJSONArray("threads").getJSONObject(0)
            val unread=expected.getBoolean("unread");val at=expected.getLong("completedAt")
            ui.runOnUiThread{vm.refreshSidebar()}
            ui.waitUntil(10000){!vm.state.loadingSidebar&&vm.state.threads.firstOrNull()?.let{it.unread==unread&&it.completedAt==at}==true}
            kotlinx.coroutines.runBlocking{kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Main){vm.refresh()}}
        }
        historyStatus="completed";history=completed(10000);sidebarFixture=listed(true,10000);refresh()
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithTag("threadUnread:t",useUnmergedTree=true).assertIsDisplayed()
        screenshot("native-completed-unread.png")
        sidebarFixture=listed(false,10000);refresh()
        ui.onNodeWithTag("threadUnread:t",useUnmergedTree=true).assertDoesNotExist()
        Assert.assertTrue(readRequests.isEmpty())
        sidebarFixture=listed(true,10000);refresh()
        ui.runOnUiThread{vm.setForeground(false)}
        ui.onNodeWithTag("threadRow:t").performClick()
        ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.events.any{it.eventId=="done-10000"}}
        ui.waitForIdle();Assert.assertTrue(readRequests.isEmpty())
        ui.runOnUiThread{vm.setForeground(true)}
        ui.waitUntil(10000){readRequests==listOf(10000L)&&!vm.state.threads.first().unread}
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithTag("threadUnread:t",useUnmergedTree=true).assertDoesNotExist()
        ui.runOnUiThread{vm.setForeground(false)}
        sidebarFixture=listed(true,20000);history=completed(20000);refresh()
        ui.waitUntil(10000){vm.state.threads.first().completedAt==20000L&&vm.state.events.any{it.eventId=="done-20000"}}
        chatSockets.forEach{
            it.send("""{"type":"thread.read","threadId":"t","readThrough":10000}""")
            it.send("""{"type":"message.delta","threadId":"t","eventId":"after-old-read","text":"最新结果仍可阅读。"}""")
        }
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="after-old-read"}}
        ui.waitForIdle()
        Assert.assertTrue(vm.state.threads.first().unread)
        ui.onNodeWithTag("threadUnread:t",useUnmergedTree=true).assertIsDisplayed()
        Assert.assertEquals(listOf(10000L),readRequests.toList())
        ui.onNodeWithContentDescription("收起侧栏").performClick()
        ui.runOnUiThread{vm.setForeground(true)}
        ui.waitUntil(10000){readRequests==listOf(10000L,20000L)&&!vm.state.threads.first().unread}
    }

    @Test fun returningToLanWakesBackgroundReconnectBackoff(){
        rejectSocket=true
        ui.runOnUiThread{vm.setForeground(false);vm.connect(server.url("/").toString(),"test",route=ConnectionRoute.LOCAL);vm.draft("内网恢复后保留输入")}
        ui.waitUntil(12000){socketAttempts.get()>=3&&!vm.state.connected&&vm.state.connecting}
        rejectSocket=false
        val started=android.os.SystemClock.elapsedRealtime()
        ui.runOnUiThread{vm.setForeground(true)}
        ui.waitUntil(1500){vm.state.connected&&!vm.state.connecting}
        val elapsed=android.os.SystemClock.elapsedRealtime()-started
        println("LAN_FOREGROUND_RECOVERY_MS=$elapsed")
        ui.onNodeWithContentDescription("发送消息").assertIsEnabled()
        Assert.assertEquals("内网恢复后保留输入",vm.state.draft)
        val attempts=socketAttempts.get()
        ui.runOnUiThread{vm.setForeground(false);vm.setForeground(true)}
        ui.waitForIdle()
        Assert.assertTrue(vm.state.connected)
        Assert.assertEquals(attempts,socketAttempts.get())
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun returningToLanCancelsStalledHandshakeAndReusesRecentHealth(){
        val checked=healthRequests.get()
        val attempts=socketAttempts.get()
        stallSocket=true
        ui.runOnUiThread{vm.setForeground(false);vm.draft("挂起握手后保留草稿");vm.client!!.reconnectEvents()}
        ui.waitUntil(7000){socketAttempts.get()>attempts&&!vm.state.connected&&vm.state.connecting}
        Assert.assertEquals("已验证的内网重连不应先重复健康检查",checked,healthRequests.get())
        healthDelayMs=6000;stallSocket=false
        val started=android.os.SystemClock.elapsedRealtime()
        ui.runOnUiThread{vm.setForeground(true)}
        ui.waitUntil(1500){vm.state.connected&&!vm.state.connecting}
        println("LAN_STALLED_HANDSHAKE_RECOVERY_MS=${android.os.SystemClock.elapsedRealtime()-started}")
        Assert.assertEquals(checked,healthRequests.get())
        Assert.assertTrue(socketAttempts.get()>=attempts+2)
        Assert.assertEquals("挂起握手后保留草稿",vm.state.draft)
        ui.onNodeWithContentDescription("发送消息").assertIsEnabled()
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun slowLanHandshakeDoesNotFailAtThreeSeconds(){
        socketDelayMs=4500
        val attempts=socketAttempts.get()
        ui.runOnUiThread{vm.connect(server.url("/").toString(),"test",route=ConnectionRoute.LOCAL)}
        ui.waitUntil(7000){vm.state.connected&&!vm.state.connecting}
        Assert.assertEquals("慢握手应一次成功，不应因三秒限制反复重连",attempts+1,socketAttempts.get())
        Assert.assertEquals("",vm.state.error)
    }

    @Test fun optionalFastTimeoutKeepsLiveChatAndReadIsShared(){
        ui.waitUntil(10000){!vm.state.fastBusy}
        fastFixture=true
        ui.runOnUiThread{vm.loadFast(force=true)}
        ui.waitUntil(10000){!vm.state.fastBusy&&vm.state.sessionFast==true}
        val reads=fastReadRequests.get()
        stallFastRead=true;stallSidebarRead=true
        ui.runOnUiThread{vm.draft("状态读取超时仍保留输入");vm.connect(server.url("/").toString(),"test")}
        ui.waitUntil(10000){vm.state.connected}
        ui.runOnUiThread{vm.loadFast()}
        ui.waitUntil(10000){vm.state.connected&&vm.state.fastBusy&&fastReadRequests.get()==reads+1}
        ui.runOnUiThread{repeat(3){vm.loadFast()};vm.setForeground(false);vm.setForeground(true)}
        ui.waitUntil(15000){!vm.state.fastBusy&&!vm.state.loadingSidebar}
        Assert.assertEquals("同一会话的并发自动读取应合并",reads+1,fastReadRequests.get())
        Assert.assertTrue(vm.state.connected)
        Assert.assertEquals(true,vm.state.sessionFast)
        Assert.assertEquals("",vm.state.error)
        Assert.assertEquals("状态读取超时仍保留输入",vm.state.draft)
        ui.onNodeWithContentDescription("发送消息").assertIsEnabled()
        stallFastRead=false;stallSidebarRead=false
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){vm.state.sessionFast==true&&!vm.state.fastBusy&&!vm.state.loadingHistory}
        failFastWrite=true
        ui.runOnUiThread{vm.toggleFast()}
        ui.waitUntil(10000){!vm.state.fastBusy&&vm.state.error.contains("Fast 切换失败")}
        Assert.assertEquals(true,vm.state.sessionFast)
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun modelCatalogReadsReuseFreshResultsAndCancelStalledCalls(){
        ui.waitUntil(10000){vm.state.models.any{it.id=="test"}}
        val api=GatewayClient(server.url("/").toString(),"test")
        val before=modelRequests.get()
        kotlinx.coroutines.runBlocking{
            kotlinx.coroutines.coroutineScope{
                val reads=(1..3).map{async{api.nativeModelsAsync()}}
                reads.forEach{Assert.assertTrue(it.await().any{it.id=="test"})}
            }
            api.nativeModelsAsync()
            Assert.assertEquals("并发读取和短时间再次打开应共用模型目录",before+1,modelRequests.get())
            stallModelRead=true
            val stalled=kotlinx.coroutines.withTimeoutOrNull(350){api.nativeModelsAsync(refresh=true)}
            Assert.assertNull(stalled)
            stallModelRead=false
            kotlinx.coroutines.withTimeout(2500){Assert.assertTrue(api.nativeModelsAsync(refresh=true).isNotEmpty())}
        }
        Assert.assertEquals(before+3,modelRequests.get())
        Assert.assertTrue(vm.state.connected)
        Assert.assertEquals("",vm.state.error)
    }

    @Test fun populatedSidebarAndMessageContrast(){
        val names=listOf("完全重写界面并修复问题","定时检查本机非分页池","更新安装脚本","整理项目文件","验证随机块曝光机制","论文图表与排版","连接与通知设置")
        sidebarFixture=JSONObject().put("threads",org.json.JSONArray().apply{names.forEachIndexed{i,name->put(JSONObject().put("id",if(i==0)"t" else "sample-$i").put("title",name).put("status","completed").put("pinnedIndex",-1))}}).toString()
        history="""[{"type":"user.message","threadId":"t","eventId":"question","text":"气泡和背景颜色太接近，分不清。"},{"type":"message.delta","threadId":"t","eventId":"answer","text":"调整页面和气泡的明暗层级，让消息边界清晰。"},{"type":"turn.completed","threadId":"t","eventId":"done"}]"""
        ui.runOnUiThread{vm.connect(server.url("/").toString(),"test")}
        ui.waitUntil(10000){vm.state.threads.size==names.size}
        ui.runOnUiThread{vm.openThread(vm.state.threads.first())}
        ui.waitUntil(10000){vm.state.events.any{it.eventId=="answer"}}
        screenshot("native-053-chat.png")
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        screenshot("native-053-drawer.png")
        ui.onNodeWithTag("sidebarList").performScrollToNode(hasText("验证随机块曝光机制"))
        ui.onNodeWithText("验证随机块曝光机制").assertIsDisplayed()
        ui.onNodeWithTag("sidebarList").performScrollToNode(hasText("更新安装脚本"))
        ui.onNodeWithText("更新安装脚本").performClick()
        ui.waitUntil(5000){vm.state.threadId=="sample-2"}
        repeat(4){
            ui.onNodeWithContentDescription("展开侧栏").performClick()
            ui.onNodeWithContentDescription("收起侧栏").performClick()
            ui.onNodeWithTag("composer").assertIsDisplayed()
        }
        screenshot("native-055-drawer-closed.png")
    }

    @Test fun disconnectBannerShowsErrorWithRetryAndDismiss(){
        ui.runOnUiThread{vm.openThread(ThreadRecord(id="t",title="离线会话"))}
        ui.waitUntil(5000){vm.state.threadId=="t"}
        ui.runOnUiThread{vm.disconnect()}
        ui.waitUntil(5000){!vm.state.connected&&!vm.state.connecting}
        ui.onNodeWithText("与电脑的连接已断开").assertIsDisplayed()
        ui.runOnUiThread{vm.error("测试断开消息")}
        ui.onNodeWithText("测试断开消息").assertIsDisplayed()
        ui.onNodeWithText("重连").performClick()
        ui.waitUntil(5000){vm.state.connecting}
        ui.waitUntil(15000){vm.state.connected}
        ui.waitUntil(5000){ui.onAllNodesWithText("测试断开消息").fetchSemanticsNodes().isEmpty()}
        ui.runOnUiThread{vm.disconnect()}
        ui.waitUntil(5000){!vm.state.connected}
        ui.onNodeWithText("与电脑的连接已断开").assertIsDisplayed()
        ui.onNodeWithContentDescription("关闭提醒").performClick()
        ui.waitUntil(5000){ui.onAllNodesWithText("与电脑的连接已断开").fetchSemanticsNodes().isEmpty()}
    }
    @Test fun rapidSwitchCancelsEventHistoryAndCoalescesSidebarReads(){
        historyStatus="completed"
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))}
        ui.waitUntil(10000){!vm.state.historySyncing&&!vm.state.loadingSidebar&&vm.state.events.isNotEmpty()}
        // Inspect transport cancellation rather than merely discarding a late UI result.
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as okhttp3.OkHttpClient
        stalledHistoryThread="t"
        chatSockets.last().send(JSONObject().put("type","message.confirmed").put("threadId","t").toString())
        var oldHistory:okhttp3.Call?=null
        ui.waitUntil(5000){
            oldHistory=transport.dispatcher.runningCalls().firstOrNull{it.request().url.encodedPath=="/api/threads/t/events"&&!it.isCanceled()}
            oldHistory!=null&&vm.state.historySyncing
        }
        stallSidebarRead=true
        val before=sidebarReadCount.get()
        ui.runOnUiThread{vm.refreshSidebar()}
        ui.waitUntil(5000){sidebarReadCount.get()>=before+2}
        val sidebarCalls=transport.dispatcher.runningCalls().filter{it.request().url.encodedPath in setOf("/api/sidebar","/api/threads")}
        Assert.assertEquals(2,sidebarCalls.size)
        val during=sidebarReadCount.get()
        history="[]"
        ui.runOnUiThread{repeat(8){vm.openThread(ThreadRecord("switch-$it"))}}
        ui.waitUntil(5000){oldHistory!!.isCanceled()&&vm.state.threadId=="switch-7"&&!vm.state.historySyncing&&!vm.state.loadingHistory}
        Assert.assertEquals("切换只应排队一次侧栏刷新，不应并发请求",during,sidebarReadCount.get())
        Assert.assertTrue(vm.state.connected)
        Assert.assertTrue(vm.state.historyErrors.isEmpty())
        ui.runOnUiThread{vm.disconnect()}
        ui.waitUntil(5000){sidebarCalls.all{it.isCanceled()}}
    }

    @Test fun changingSearchCancelsItsOldHttpReadAndKeepsTheLatestMatches(){
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as okhttp3.OkHttpClient
        ui.runOnUiThread{vm.searchRemote("old-query","codex")}
        var oldCall:okhttp3.Call?=null
        ui.waitUntil(5000){oldCall=transport.dispatcher.runningCalls().firstOrNull{it.request().url.encodedPath=="/api/threads/search"&&it.request().url.queryParameter("q")=="old-query"};oldCall!=null}
        ui.runOnUiThread{vm.searchRemote("new-query","codex")}
        ui.waitUntil(5000){oldCall!!.isCanceled()&&vm.state.remoteSearch.matches.singleOrNull()?.threadId=="latest-search"}
        Assert.assertTrue(vm.state.connected)
        Assert.assertTrue(vm.state.error.isBlank())
        ui.runOnUiThread{vm.searchRemote("","codex")}
        ui.waitUntil(5000){vm.state.remoteSearch.matches.isEmpty()}
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun sidebarSearchShowsLoadingRetriesAndCancelsWhenClosed(){
        val transport=GatewayClient::class.java.getDeclaredField("http").apply{isAccessible=true}.get(vm.client) as okhttp3.OkHttpClient
        ui.onNodeWithContentDescription("展开侧栏").performClick()
        ui.onNodeWithText("搜索会话").performClick()
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("threadSearchInput"))).performTextInput("old-query")
        ui.waitUntil(5000){vm.state.remoteSearch.query=="old-query"&&vm.state.remoteSearch.loading}
        ui.onNodeWithTag("sidebarList").performScrollToNode(hasTestTag("threadSearchLoading"))
        ui.onNodeWithText("没有找到会话").assertDoesNotExist()
        val loadingHeight=ui.onNodeWithTag("threadSearchFeedback").fetchSemanticsNode().boundsInRoot.height
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("threadSearchInput"))).performTextReplacement("fail-query")
        ui.waitUntil(5000){vm.state.remoteSearch.error.isNotBlank()&&!vm.state.remoteSearch.loading}
        ui.onNodeWithTag("sidebarList").performScrollToNode(hasTestTag("threadSearchRetry"))
        Assert.assertEquals(loadingHeight,ui.onNodeWithTag("threadSearchFeedback").fetchSemanticsNode().boundsInRoot.height,1f)
        ui.onNodeWithTag("threadSearchRetry").performClick()
        ui.waitUntil(5000){vm.state.remoteSearch.matches.singleOrNull()?.threadId=="latest-search"&&!vm.state.remoteSearch.loading}
        Assert.assertTrue(vm.state.remoteSearch.error.isBlank())
        ui.onNode(hasSetTextAction() and hasAnyAncestor(hasTestTag("threadSearchInput"))).performTextReplacement("old-query")
        var call:okhttp3.Call?=null
        ui.waitUntil(5000){call=transport.dispatcher.runningCalls().firstOrNull{it.request().url.encodedPath=="/api/threads/search"&&it.request().url.queryParameter("q")=="old-query"&&!it.isCanceled()};call!=null}
        Assert.assertTrue(vm.state.remoteSearch.matches.isEmpty())
        ui.onNodeWithContentDescription("收起侧栏").performClick()
        ui.waitUntil(5000){call!!.isCanceled()&&vm.state.remoteSearch.query.isBlank()&&!vm.state.remoteSearch.loading}
        Assert.assertTrue(vm.state.connected)
        Assert.assertTrue(requests.isEmpty())
    }

    @Test fun switchingConversationsRestoresDetachedReadingPosition(){
        fun rows(id:String)=org.json.JSONArray().apply{repeat(50){i->put(JSONObject().put("type","user.message").put("threadId",id).put("eventId","$id-read-$i").put("text","Read fixture $i: keep this position while switching."))}}.toString()
        val original=rows("t");history=original;historyStatus="completed";historyMore=false
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))};ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.events.size==50};ui.waitForIdle()
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()};ui.waitForIdle();ui.onNodeWithTag("messages").performScrollToIndex(8);ui.waitForIdle()
        fun position()=ui.onNodeWithTag("messages").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        val reading=position();ui.onNodeWithText("Read fixture 8: keep this position while switching.").assertIsDisplayed()
        history=rows("b");ui.runOnUiThread{vm.openThread(ThreadRecord("b"))};ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.threadId=="b"&&vm.state.events.size==50};ui.waitForIdle()
        history=original;ui.runOnUiThread{vm.openThread(ThreadRecord("t"))};ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.threadId=="t"&&vm.state.events.size==50};ui.waitForIdle()
        Assert.assertTrue("Detached reading moved from $reading to ${position()}",kotlin.math.abs(position()-reading)<1f)
        ui.waitUntil(5000){ui.onAllNodesWithContentDescription("回到最新").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("回到最新").assertExists()
    }

    @Test fun interruptedReturnAndRapidNavigationPreserveReadingWithoutMovingOtherThread(){
        fun rows(id:String)=org.json.JSONArray().apply{repeat(80){i->put(JSONObject().put("type","user.message").put("threadId",id).put("eventId","$id-interrupt-$i").put("text","$id reading fixture $i"))}}.toString()
        val original=rows("t");historyStatus="completed";historyMore=false;history=original
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))};ui.waitUntil(10000){vm.state.events.size==80&&!vm.state.loadingHistory}
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()};ui.onNodeWithTag("messages").performScrollToIndex(8);ui.waitForIdle()
        ui.waitUntil(5000){ui.onAllNodesWithContentDescription("回到最新").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("回到最新").assertExists()
        ui.mainClock.autoAdvance=false
        try{
            ui.onNodeWithContentDescription("回到最新").performClick();ui.mainClock.advanceTimeBy(48)
            history=rows("b");ui.runOnUiThread{vm.openThread(ThreadRecord("b"))}
        }finally{ui.mainClock.autoAdvance=true}
        ui.waitUntil(10000){vm.state.threadId=="b"&&vm.state.events.size==80&&!vm.state.loadingHistory};ui.waitForIdle()
        ui.onNodeWithTag("messages").performTouchInput{swipeDown()};ui.onNodeWithTag("messages").performScrollToIndex(12);ui.waitForIdle()
        fun position()=ui.onNodeWithTag("messages").fetchSemanticsNode().config[SemanticsProperties.VerticalScrollAxisRange].value()
        val reading=position();screenshot("iteration-reading-detached.png")
        repeat(3){
            history=original;ui.runOnUiThread{vm.openThread(ThreadRecord("t"));vm.openThread(ThreadRecord("t"))};ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.threadId=="t"&&vm.state.events.size==80};ui.waitForIdle()
            history=rows("b");ui.runOnUiThread{vm.openThread(ThreadRecord("b"))};ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.threadId=="b"&&vm.state.events.size==80};ui.waitForIdle()
            Assert.assertEquals(reading,position(),1f)
        }
        screenshot("iteration-reading-restored.png")
    }
    @Test fun switchingBackRestoresPreviouslyLoadedOlderHistoryAndItsAnchor(){
        fun rows(id:String,start:Int)=org.json.JSONArray().apply{for(i in start until 60)put(JSONObject().put("type","user.message").put("threadId",id).put("eventId","$id-page-$i").put("text","$id paged reading $i"))}.toString()
        history=rows("t",40);olderHistory=rows("t",0);historyMore=true;historyStatus="completed"
        ui.runOnUiThread{vm.openThread(ThreadRecord("t"))};ui.waitUntil(10000){vm.state.events.size==20&&!vm.state.loadingHistory}
        ui.onNodeWithTag("messages").performTouchInput{swipe(center,center+Offset(0f,24f),300)}
        ui.onNodeWithTag("messages").performScrollToIndex(0);ui.onNodeWithTag("messages").performTouchInput{swipeDown()}
        ui.waitUntil(10000){vm.state.events.size==60&&!vm.state.loadingOlderHistory};ui.onNodeWithTag("messages").performScrollToIndex(5);ui.waitForIdle()
        ui.onNodeWithText("t paged reading 5").assertIsDisplayed()
        history=rows("b",40);ui.runOnUiThread{vm.openThread(ThreadRecord("b"))};ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.threadId=="b"};ui.waitForIdle()
        history=rows("t",40);ui.runOnUiThread{vm.openThread(ThreadRecord("t"))};ui.waitUntil(10000){!vm.state.loadingHistory&&vm.state.events.size==60};ui.waitForIdle()
        ui.onNodeWithText("t paged reading 5").assertIsDisplayed();Assert.assertEquals(20,historyCounts.last())
    }
}
