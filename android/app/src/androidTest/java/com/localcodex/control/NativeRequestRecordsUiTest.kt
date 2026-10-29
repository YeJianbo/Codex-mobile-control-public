package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test

class NativeRequestRecordsUiTest{
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun requestKeepsSmallAmountsAndExpandsMetering(){
        val row=JSONObject().put("id","request-a").put("source","router").put("model","gpt-6.1-sol").put("time",1792494000000L)
            .put("totalTokens",110).put("inputTokens",100).put("outputTokens",10).put("cachedTokens",50).put("durationMs",1000).put("averageTPS",10)
            .put("cost",JSONObject().put("usd",.000321).put("basis","reference"))
        ui.setContent{MaterialTheme{RequestRecordCard(row)}}
        ui.onNodeWithText("$0.000321").assertExists()
        ui.onNodeWithText("6.1 Sol").performClick()
        ui.onNodeWithText("50.0%").assertExists()
        ui.onNodeWithText("输入 100 · 输出 10",substring=true).assertExists()
        ui.onNodeWithText("响应档位 未记录 · 请求档位 未记录").assertExists()
    }
}
