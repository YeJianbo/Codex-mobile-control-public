package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ConsolePricingScrollTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun firstPricingSwitchKeepsLayoutDuringLoadAndFailure(){
        fun statistics(basis:String)=parseConsoleStatistics(JSONObject()
            .put("source","codex").put("range","week")
            .put("totals",JSONObject().put("total",123456).put("records",12))
            .put("cost",JSONObject().put("basis",basis).put("usd",if(basis=="api")8.0 else 4.0))
            .put("models",JSONArray().apply{repeat(16){put(JSONObject().put("id","Model $it").put("total",1234).put("records",1))}}))
        val state=mutableStateOf(LocalConsoleUiState(statistics=statistics("codex")))
        ui.setContent{MaterialTheme{LocalConsoleContent(state.value,true,{},{},{source,range,pricing->
            state.value=state.value.copy(source=source,range=range,pricing=pricing,statisticsLoading=true)
        },{_,_,_->})}}
        ui.onNodeWithText("API 计价").performScrollTo()
        val before=ui.onNodeWithText("API 计价").fetchSemanticsNode().positionInRoot.y
        ui.onNodeWithText("API 计价").performClick()
        ui.onNodeWithText("正在读取所选计价…").assertExists()
        fun assertPosition(stage:String){
            val current=ui.onNodeWithText("API 计价").fetchSemanticsNode().positionInRoot.y
            println("pricing-scroll $stage before=$before after=$current")
            assertEquals(stage,before,current,1f)
            ui.onNodeWithText("Model 15").assertExists()
        }
        assertPosition("first cold request")
        ui.runOnIdle{state.value=state.value.copy(statisticsLoading=false,statisticsError="读取超时")}
        // A visible error adds a line above this card; it must retain content and the reading area.
        ui.onNodeWithText("API 计价").assertIsDisplayed()
        ui.onNodeWithText("Model 15").assertExists()
        ui.runOnIdle{state.value=state.value.copy(statistics=statistics("api"),statisticsLoading=false,statisticsError="")}
        assertPosition("first response")
        ui.onNodeWithText("$8.00").assertExists()
    }
}
