package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import java.io.File
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ModelControlsLayoutTest {
    @get:Rule val rule=createAndroidComposeRule<ComponentActivity>()

    @Test fun compactControlsDoNotOverlapAndNoticeCloses(){
        val model=NativeModel("gpt-6-astra","GPT-6-Astra",listOf("none","low","medium","high","xhigh","max"),"medium")
        rule.setContent {
            var fast by remember{mutableStateOf(false)}
            var showModels by remember{mutableStateOf(false)}
            var effort by remember{mutableStateOf("medium")}
            var notice by remember{mutableStateOf(true)}
            MaterialTheme {
                Box(Modifier.fillMaxSize().background(Color.White),contentAlignment=Alignment.Center){
                    Column(Modifier.width(320.dp).testTag("controlsFixture"),horizontalAlignment=Alignment.CenterHorizontally){
                        Surface(Modifier.width(280.dp),shape=RoundedCornerShape(18.dp),elevation=3.dp){
                            NativeModelControls(listOf(model),model,effort,fast,true,true,showModels,{showModels=it},{showModels=false},{effort=it},{fast=!fast},{})
                        }
                        Spacer(Modifier.height(24.dp))
                        if(notice)NativeSubmissionNotice("提交结果待确认",{},{notice=false},{notice=false})
                    }
                }
            }
        }
        rule.onNodeWithTag("fastToggle").assertIsOff()
        val label=rule.onNodeWithTag("selectedEffort",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
        val slider=rule.onNodeWithTag("effortSlider").fetchSemanticsNode().boundsInRoot
        assertTrue("effort text must remain above the slider",label.bottom<slider.top)
        capture("model-controls-off.png")
        rule.onNodeWithTag("fastToggle").performClick()
        rule.onNodeWithTag("fastToggle").assertIsOn()
        rule.onNodeWithContentDescription("关闭提交提示").performClick()
        rule.onNodeWithTag("submissionNotice").assertDoesNotExist()
        capture("model-controls-on.png")
        rule.mainClock.autoAdvance=false
        try{
            val before=rule.onNodeWithTag("modelControls").fetchSemanticsNode().boundsInRoot.height
            rule.onNodeWithTag("selectedEffort",useUnmergedTree=true).performTouchInput{click(center)}
            rule.mainClock.advanceTimeBy(48);rule.waitForIdle()
            rule.onNodeWithTag("modelList").assertExists()
            rule.onNodeWithTag("fastToggle").assertExists()
            val during=rule.onNodeWithTag("modelControls").fetchSemanticsNode().boundsInRoot.height
            rule.mainClock.advanceTimeBy(400);rule.waitForIdle()
            val after=rule.onNodeWithTag("modelControls").fetchSemanticsNode().boundsInRoot.height
            assertTrue("菜单高度应经过中间值",during>minOf(before,after)&&during<maxOf(before,after))
            rule.onNodeWithTag("fastToggle").assertDoesNotExist()
            capture("model-controls-list-313.png")
            rule.onNodeWithContentDescription("返回思考强度").performClick()
            rule.mainClock.advanceTimeBy(48);rule.waitForIdle()
            rule.onNodeWithTag("modelList").assertExists()
            rule.onNodeWithTag("fastToggle").assertExists()
            rule.mainClock.advanceTimeBy(400);rule.waitForIdle()
            rule.onNodeWithTag("modelList").assertDoesNotExist()
            rule.onNodeWithTag("fastToggle").assertIsOn()
            assertEquals(before,rule.onNodeWithTag("modelControls").fetchSemanticsNode().boundsInRoot.height,1f)
        }finally{rule.mainClock.autoAdvance=true}
    }
    private fun capture(name:String){
        rule.waitForIdle()
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val directory=InstrumentationRegistry.getArguments().getString("additionalTestOutputDir")?.let(::File)
            ?:instrumentation.targetContext.getExternalFilesDir(null)!!
        directory.mkdirs()
        val file=File(directory,name)
        val bitmap=rule.onNodeWithTag("controlsFixture").captureToImage().asAndroidBitmap()
        file.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
    }
}
