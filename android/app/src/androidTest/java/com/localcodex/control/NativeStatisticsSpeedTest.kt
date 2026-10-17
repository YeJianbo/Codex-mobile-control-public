package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeStatisticsSpeedTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    private class Group(model:String,count:Int):JSONObject(){
        var sessionReads=0
        init{
            put("model",model);put("provider",JSONObject.NULL);put("averageTPS",30);put("sessionCount",count);put("samples",count)
            put("sessions",JSONArray().apply{repeat(count){index->put(JSONObject().put("id","$model-$index").put("title","$model session $index").put("averageTPS",30).put("samples",1).put("outputTokens",30))}})
        }
        override fun optJSONArray(name:String?):JSONArray?{if(name=="sessions")sessionReads++;return super.optJSONArray(name)}
    }

    private fun data(vararg groups:JSONObject)=JSONObject().put("source","native").put("totals",JSONObject()).put("coverage",JSONObject()).put("groups",JSONArray(groups.toList()))

    @Test fun indexUpdatesUseTheHeaderWithoutMovingModelCards(){
        val response=mutableStateOf(data(Group("Alpha",1)))
        val fontScale=mutableStateOf(1f)
        ui.setContent{MaterialTheme{
            val density=LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density,fontScale.value)){
                Box(Modifier.size(width=320.dp,height=760.dp)){Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())){StatisticsSpeedDetails(response.value)}}
            }
        }}
        fun progress(value:JSONObject)=data(Group("Alpha",1)).put("progress",value)
        for(scale in listOf(1f,1.6f)){
            ui.runOnIdle{fontScale.value=scale;response.value=progress(JSONObject().put("running",false))};ui.waitForIdle()
            val idle=ui.onNodeWithText("Alpha",useUnmergedTree=true).fetchSemanticsNode().positionInRoot.y
            ui.runOnIdle{response.value=progress(JSONObject().put("running",true))};ui.waitForIdle()
            val checking=ui.onNodeWithText("Alpha",useUnmergedTree=true).fetchSemanticsNode().positionInRoot.y
            println("speed-status font=$scale idle=$idle checking=$checking delta=${checking-idle}")
            assertEquals("Index activity must not move model cards",idle,checking,1f)
            ui.onNodeWithText("正在检查记录…",useUnmergedTree=true).assertExists()
            ui.runOnIdle{response.value=progress(JSONObject().put("running",true).put("completedThreads",3).put("totalThreads",10).put("items",8))};ui.waitForIdle()
            ui.onNodeWithText("索引 3/10 · 8 段",useUnmergedTree=true).assertExists()
            val known=ui.onNodeWithText("Alpha",useUnmergedTree=true).fetchSemanticsNode().positionInRoot.y
            assertEquals(idle,known,1f)
            val results=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            ui.onNodeWithText("可见回复速度",useUnmergedTree=true).performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult){it(results)}
            assertTrue("Summary title must fit vertically",results.single().getLineBottom(0)<=results.single().size.height+1)
            ui.runOnIdle{response.value=progress(JSONObject().put("running",false))};ui.waitForIdle()
            assertEquals(idle,ui.onNodeWithText("Alpha",useUnmergedTree=true).fetchSemanticsNode().positionInRoot.y,1f)
        }
    }

    @Test fun modelRankingRefreshKeepsExpandedSessionsAndShowMorePosition(){
        val alpha=Group("Alpha",35);val beta=Group("Beta",1)
        val response=mutableStateOf(data(alpha,beta))
        ui.setContent{MaterialTheme{Box(Modifier.size(width=360.dp,height=600.dp)){Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())){StatisticsSpeedDetails(response.value)}}}}
        ui.waitForIdle();ui.runOnIdle{alpha.sessionReads=0;beta.sessionReads=0}
        ui.onNodeWithText("Alpha",useUnmergedTree=true).performScrollTo().performClick()
        ui.onNodeWithText("Alpha session 0",useUnmergedTree=true).assertExists()
        ui.onNodeWithText("Beta session 0",useUnmergedTree=true).assertDoesNotExist()
        ui.runOnIdle{println("speed-expand session-array reads: Alpha=${alpha.sessionReads}, Beta=${beta.sessionReads}")}
        ui.onNodeWithText("显示更多会话（5）",useUnmergedTree=true).performScrollTo().performClick()
        ui.onNodeWithText("Alpha session 34",useUnmergedTree=true).assertExists()
        ui.runOnIdle{response.value=data(Group("Beta",1),Group("Alpha",35))}
        ui.waitForIdle()
        ui.onNodeWithText("Alpha session 34",useUnmergedTree=true).assertExists()
        ui.onNodeWithText("Beta session 0",useUnmergedTree=true).assertDoesNotExist()
        ui.onNodeWithText("Alpha",useUnmergedTree=true).performScrollTo().performClick()
        ui.onNodeWithText("Alpha session 0",useUnmergedTree=true).assertDoesNotExist()
        ui.runOnIdle{response.value=data(Group("Alpha",35),Group("Beta",1))}
        ui.waitForIdle()
        ui.onNodeWithText("Alpha session 0",useUnmergedTree=true).assertDoesNotExist()
    }
}
