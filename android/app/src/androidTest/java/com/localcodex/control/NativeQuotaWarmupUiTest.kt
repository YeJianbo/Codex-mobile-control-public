package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeQuotaWarmupUiTest{
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun windowsAreOptionalAndTurningOffKeepsTheSelection(){
        val data=mutableStateOf(JSONObject().put("enabled",true).put("windows",JSONArray(listOf("weekly"))).put("status","waiting"))
        var changes=0
        ui.setContent{MaterialTheme{NativeQuotaWarmupContent(data.value,true,false,""){enabled,windows->
            changes++;data.value=JSONObject().put("enabled",enabled).put("windows",JSONArray(windows)).put("status",if(enabled)"waiting" else "disabled")
        }}}
        ui.onNodeWithTag("warmupWindow:weekly").performClick()
        assertEquals("The last selected window stays selected",0,changes)
        ui.onNodeWithTag("warmupWindow:fiveHour").performClick()
        assertEquals(setOf("weekly","fiveHour"),data.value.getJSONArray("windows").let{(0 until it.length()).map(it::getString).toSet()})
        ui.onNodeWithTag("quotaWarmupToggle").performClick()
        assertFalse(data.value.getBoolean("enabled"))
        ui.onNodeWithText("已关闭").assertExists()
        assertEquals(2,data.value.getJSONArray("windows").length())
        ui.onNodeWithTag("warmupWindow:weekly").performClick()
        assertEquals("fiveHour",data.value.getJSONArray("windows").getString(0))
        ui.onNodeWithTag("quotaWarmupToggle").performClick()
        assertTrue(data.value.getBoolean("enabled"))
        ui.onNodeWithText("等待额度重置").assertExists()
    }
}
