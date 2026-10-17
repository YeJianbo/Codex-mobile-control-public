package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeAccountsCloseUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun unknownAndRunningChildCloseButtonsDispatchTheirOwnIds(){
        val parent="00000000-0000-4000-8000-000000000001"
        val unknown=ThreadRecord("00000000-0000-4000-8000-000000000002",status="unknown",subagent=NativeSubagent(parent,nickname="待确认"))
        val running=ThreadRecord("00000000-0000-4000-8000-000000000003",status="running",subagent=NativeSubagent(parent,nickname="进行中"))
        val closed=mutableListOf<String>()
        ui.setContent{MaterialTheme{NativeConversationAgents(listOf(unknown,running),parent,{},onClose={closed.add(it.id)})}}
        ui.onNodeWithTag("conversationAgentsToggle").performClick()
        ui.onNodeWithTag("closeSubagent:${unknown.id}").assertIsEnabled().performClick()
        ui.onNodeWithTag("closeSubagent:${running.id}").assertIsEnabled().performClick()
        ui.runOnIdle{assertEquals(listOf(unknown.id,running.id),closed);assertFalse(parent in closed)}
    }

    @Test fun accountSwitchRequiresExplicitConfirmationAndUsesThePreviewIdentity(){
        val actions=mutableListOf<Pair<String,JSONObject>>()
        val preview=JSONObject().put("id","saved-account").put("label","目标账号").put("canSwitch",true).put("planId","00000000-0000-4000-8000-000000000004")
        ui.setContent{MaterialTheme{NativeAccountsContent(NativeAccountsState(service="codex",confirmation=preview),"codex",true,{},{},{},{action,body->actions.add(action to body)},{})}}
        ui.runOnIdle{assertTrue(actions.isEmpty())}
        ui.onNodeWithTag("confirmAccountSwitch").performClick()
        ui.runOnIdle{assertEquals("switch",actions.single().first);assertEquals("saved-account",actions.single().second.getString("id"));assertEquals(preview.getString("planId"),actions.single().second.getString("planId"))}
    }

    @Test fun accountRefreshAndActionFeedbackKeepExistingContentInPlace(){
        val accounts=org.json.JSONArray().apply{repeat(6){put(JSONObject().put("id","saved-$it").put("alias","固定账号 $it").put("active",true))}}
        val state=mutableStateOf(NativeAccountsState(service="codex",data=JSONObject().put("items",accounts)))
        ui.setContent{MaterialTheme{NativeAccountsContent(state.value,"codex",true,{},{},{},{_,_->},{})}}
        val card=ui.onNodeWithText("固定账号 5 · 当前")
        card.performScrollTo()
        val original=card.fetchSemanticsNode().boundsInRoot
        val refreshArea=ui.onNodeWithTag("accountRefreshArea").fetchSemanticsNode().boundsInRoot
        ui.runOnIdle{state.value=state.value.copy(loading=true)}
        ui.onNodeWithText("正在读取…").assertIsDisplayed()
        assertEquals(original,card.fetchSemanticsNode().boundsInRoot)
        assertEquals(refreshArea,ui.onNodeWithTag("accountRefreshArea").fetchSemanticsNode().boundsInRoot)
        ui.runOnIdle{state.value=state.value.copy(loading=false,busy="refresh")}
        ui.onNodeWithText("正在处理…").assertIsDisplayed()
        assertEquals(original,card.fetchSemanticsNode().boundsInRoot)
        ui.runOnIdle{state.value=state.value.copy(busy="")}
        ui.onNodeWithText("刷新").assertIsEnabled()
        assertEquals(original,card.fetchSemanticsNode().boundsInRoot)
    }

    @Test fun accountServiceDoesNotShowAnotherServicesFeedbackOrPreview(){
        val stale=NativeAccountsState(service="codex",error="旧服务错误",message="旧服务消息",confirmation=JSONObject().put("canSwitch",true).put("planId","old-preview"))
        ui.setContent{MaterialTheme{NativeAccountsContent(stale,"claude",true,{},{},{},{_,_->},{})}}
        ui.onNodeWithText("正在读取…").assertIsDisplayed()
        ui.onNodeWithText("旧服务错误").assertDoesNotExist()
        ui.onNodeWithText("旧服务消息").assertDoesNotExist()
        ui.onNodeWithText("确认切换账号").assertDoesNotExist()
    }

    private fun readableButton(text:String){
        val node=ui.onNodeWithText(text,useUnmergedTree=true)
        node.performScrollTo().assertIsDisplayed()
        val layouts=mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(layouts)}
        val layout=layouts.single()
        val lastGlyph=layout.getBoundingBox(text.lastIndex)
        val metrics=JSONObject().put("text",text).put("lines",layout.lineCount).put("width",layout.size.width)
            .put("paragraphWidth",layout.multiParagraph.width).put("lineRight",layout.getLineRight(0)).put("lastGlyphRight",lastGlyph.right)
            .put("widthOverflow",layout.didOverflowWidth).put("heightOverflow",layout.didOverflowHeight)
        val file=java.io.File(ui.activity.getExternalFilesDir(null),"account-layout-metrics.json")
        val records=if(file.exists())org.json.JSONArray(file.readText()) else org.json.JSONArray()
        file.writeText(records.put(metrics).toString())
        assertEquals("Button text must not be squeezed into multiple lines: $metrics",1,layout.lineCount)
        assertEquals("The complete label must remain visible: $metrics",text.length,layout.getLineEnd(0,visibleEnd=true))
        // A paragraph can retain its constraint width while the actual glyphs fit a smaller box.
        assertTrue("Button text exceeds its measured width: $metrics",lastGlyph.right<=layout.size.width+1f)
        assertFalse("Button text exceeds its measured height: $metrics",layout.didOverflowHeight)
    }

    @Test fun agyHistoryOptionsStayReadableAndDispatchOnNarrowLargeText(){
        val actions=mutableListOf<Pair<String,JSONObject>>()
        val data=JSONObject().put("items",org.json.JSONArray().put(JSONObject().put("id","one").put("alias","测试账号").put("active",true)))
        ui.setContent{CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density,1.6f)){MaterialTheme{
            Box(Modifier.width(320.dp)){NativeAccountsContent(NativeAccountsState(service="agy",data=data),"agy",true,{},{},{},{name,body->actions.add(name to body)},{})}
        }}}
        listOf("从 Tools 导入","保存当前账号","1天","7天","30天","90天").forEach(::readableButton)
        ui.onNodeWithText("90天").performClick()
        ui.onNodeWithText("近 90 天额度历史").performScrollTo().performClick()
        ui.runOnIdle{assertEquals("history",actions.single().first);assertEquals(90,actions.single().second.getInt("days"))}
    }

    @Test fun claudeLongActionsStayReadableAndDispatchOnNarrowLargeText(){
        val actions=mutableListOf<Pair<String,JSONObject>>()
        ui.setContent{CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density,1.6f)){MaterialTheme{
            Box(Modifier.width(320.dp)){NativeAccountsContent(NativeAccountsState(service="claude",data=JSONObject()),"claude",true,{},{},{},{name,body->actions.add(name to body)},{})}
        }}}
        listOf("保存当前账号","导入账号","刷新当前额度","当前账号历史").forEach(::readableButton)
        ui.onNodeWithText("刷新当前额度").performScrollTo().performClick()
        ui.onNodeWithText("当前账号历史").performScrollTo().performClick()
        ui.runOnIdle{assertEquals(listOf("refresh","select"),actions.map{it.first});assertTrue(actions.all{it.second.getString("id")=="current"})}
    }
}
