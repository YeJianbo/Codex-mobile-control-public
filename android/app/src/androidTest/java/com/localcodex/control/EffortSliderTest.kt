package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EffortSliderTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun descendingProviderEffortsDragCommitsOnReleaseAndCancelRestoresSelection() {
        val selected=mutableStateOf("low")
        val changes=mutableListOf<String>()
        ui.setContent { MaterialTheme { Column {
            EffortSlider(listOf("xhigh","high","medium","low"),selected.value,{selected.value=it;changes.add(it)})
        } } }
        val slider=ui.onNodeWithTag("effortSlider")
        slider.performTouchInput { down(Offset(width*0.1f,centerY)); moveTo(Offset(width*0.9f,centerY)) }
        ui.onNodeWithText("思考强度 · 极高").assertExists()
        ui.runOnIdle { assertTrue(changes.isEmpty()) }
        slider.performTouchInput { up() }
        ui.runOnIdle { assertEquals(listOf("xhigh"),changes) }
        slider.performTouchInput { down(Offset(width*0.9f,centerY)); moveTo(Offset(width*0.1f,centerY)) }
        ui.onNodeWithText("思考强度 · 低").assertExists()
        slider.performTouchInput { cancel() }
        ui.onNodeWithText("思考强度 · 极高").assertExists()
        ui.runOnIdle { assertEquals(listOf("xhigh"),changes) }
        slider.performTouchInput { click(Offset(width*0.35f,centerY)) }
        ui.onNodeWithText("思考强度 · 中").assertExists()
        ui.runOnIdle { assertEquals(listOf("xhigh","medium"),changes) }
    }
}
