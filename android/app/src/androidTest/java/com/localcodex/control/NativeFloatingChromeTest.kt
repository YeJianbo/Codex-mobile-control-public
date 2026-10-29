package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.Text
import androidx.compose.material.TextButton
import androidx.compose.material.LocalContentColor
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicInteger
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File

class NativeFloatingChromeTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun glassSubagentPopupOpensSwitchesAndClosesWhileTheListChanges(){
        val rows=mutableStateOf((1..3).map{ThreadRecord(id="child-$it",status="running",subagent=NativeSubagent(parentThreadId="parent",nickname="Sol $it"))})
        val opened=AtomicReference("")
        val theme=NativeBuiltinThemes.liquid.resolve(false)
        ui.setContent{NativeThemeProvider(theme,theme.palette.material(false)){
            CompositionLocalProvider(LocalNativeGlassMode provides NativeGlassMode.LIQUID,LocalNativeFloatingChrome provides true){
                NativeManagementPage("会话","",{},actions={
                    NativeConversationAgents(rows.value,"parent",{opened.set(it.id)},onClose={child->rows.value=rows.value.filterNot{it.id==child.id}})
                }){
                    Column(Modifier.nativeManagementScroll(rememberScrollState())){repeat(20){Text("原会话内容 $it",Modifier.height(64.dp))}}
                }
            }
        }}
        ui.onNodeWithTag("conversationAgentsToggle").performClick()
        ui.onNodeWithTag("conversationAgent:child-1").assertIsDisplayed().performClick()
        ui.waitUntil(5000){opened.get()=="child-1"}
        ui.onNodeWithTag("conversationAgentsToggle").performClick()
        for(index in 1..3)ui.onNodeWithTag("closeSubagent:child-$index",useUnmergedTree=true).performClick()
        ui.onNodeWithTag("conversationAgents").assertDoesNotExist()
        ui.onNodeWithTag("modernDropdown").assertDoesNotExist()
    }

    @Test fun subagentBadgeDoesNotMoveTheRobotAwayFromTheButtonCenter(){
        val count=mutableStateOf(3)
        val floating=mutableStateOf(false)
        val theme=NativeBuiltinThemes.liquid.resolve(false)
        ui.setContent{NativeThemeProvider(theme,theme.palette.material(false)){
            CompositionLocalProvider(LocalNativeFloatingChrome provides floating.value){
                NativeConversationAgents((0 until count.value).map{ThreadRecord(id="child-$it",status="running",subagent=NativeSubagent(parentThreadId="parent"))},"parent",{})
            }
        }}
        for(glass in listOf(false,true))for(size in listOf(1,3,12,128)){
            ui.runOnUiThread{floating.value=glass;count.value=size}
            val button=ui.onNodeWithTag("conversationAgentsToggle").fetchSemanticsNode().boundsInRoot
            val icon=ui.onNodeWithTag("conversationAgentsIcon",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
            assertEquals("Robot horizontal center for $size agents",button.center.x,icon.center.x,0.5f)
            assertEquals("Robot vertical center for $size agents",button.center.y,icon.center.y,0.5f)
        }
    }

    @Test fun confirmationUsesThePageBackdropAndKeepsItsActions(){
        val source=AtomicReference<NativeGlassBackdrop?>()
        val expectedInk=AtomicReference<androidx.compose.ui.graphics.Color>()
        val titleInk=AtomicReference<androidx.compose.ui.graphics.Color>()
        val mode=mutableStateOf(NativeGlassMode.LIQUID)
        val dark=mutableStateOf(false)
        val open=mutableStateOf(false)
        val confirmed=AtomicInteger()
        ui.setContent{
            val definition=when(mode.value){NativeGlassMode.LIQUID->NativeBuiltinThemes.liquid;NativeGlassMode.LIGHT->NativeBuiltinThemes.lightweight;else->NativeBuiltinThemes.standard}
            val theme=definition.resolve(dark.value)
            NativeThemeProvider(theme,theme.palette.material(dark.value)){
                val ink=NativeInk
                SideEffect{expectedInk.set(ink)}
                CompositionLocalProvider(LocalNativeGlassMode provides mode.value){
                    NativeManagementPage("账号","",{}){
                        val backdrop=LocalNativeOverlayBackdrop.current
                        SideEffect{source.set(backdrop)}
                        Column(Modifier.nativeManagementScroll(rememberScrollState())){
                            TextButton(onClick={open.value=true}){Text("切换账号")}
                            repeat(20){Text("账号 $it · 本地配置与使用记录",Modifier.height(64.dp))}
                        }
                        if(open.value)NativeAlertDialog(onDismissRequest={open.value=false},
                            title={val color=LocalContentColor.current;SideEffect{titleInk.set(color)};Text("确认切换账号")},text={Text("切换后，新请求使用该账号。")},
                            confirmButton={TextButton(onClick={confirmed.incrementAndGet();open.value=false}){Text("确认切换")}},
                            dismissButton={TextButton(onClick={open.value=false}){Text("取消")}})
                    }
                }
            }
        }
        for((style,isDark) in listOf(NativeGlassMode.LIQUID to false,NativeGlassMode.LIQUID to true,NativeGlassMode.LIGHT to false,NativeGlassMode.OFF to false)){
            ui.runOnUiThread{mode.value=style;dark.value=isDark}
            ui.waitForIdle()
            val consumers=source.get()?.consumers?:0
            ui.onNodeWithText("切换账号").performClick()
            ui.onNodeWithText("确认切换账号").assertIsDisplayed()
            assertEquals("Dialog text must follow the active theme",expectedInk.get(),titleInk.get())
            if(style==NativeGlassMode.LIQUID){
                ui.waitUntil(10000){source.get()!!.consumers>consumers}
                val ready=android.os.SystemClock.uptimeMillis()+300
                ui.waitUntil(2000){android.os.SystemClock.uptimeMillis()>=ready}
                val instrumentation=InstrumentationRegistry.getInstrumentation()
                val bitmap=instrumentation.uiAutomation.takeScreenshot()?:error("截图失败")
                try{File(instrumentation.targetContext.getExternalFilesDir(null),"material461-confirm-${if(isDark)"dark" else "light"}.png").outputStream().use{
                    bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
                }}finally{bitmap.recycle()}
            }
            ui.onNodeWithText("取消").performClick()
            assertEquals(0,confirmed.get())
            ui.onNodeWithText("切换账号").performClick()
            ui.onNodeWithText("确认切换").performClick()
            assertEquals(1,confirmed.getAndSet(0))
            ui.onNodeWithText("确认切换账号").assertDoesNotExist()
        }
    }

    @Test fun floatingHeaderSamplesTheScrollingViewportAndIconsExplainOnLongPress(){
        val source=AtomicReference<NativeGlassBackdrop?>()
        val clicks=AtomicInteger()
        val theme=NativeBuiltinThemes.liquid.resolve(false)
        ui.setContent{NativeThemeProvider(theme,theme.palette.material(false)){
            CompositionLocalProvider(LocalNativeGlassMode provides NativeGlassMode.LIQUID){
                NativeManagementPage("设置","",{},modifier=Modifier.testTag("floatingPage"),actions={
                    ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",{clicks.incrementAndGet()})
                }){
                    val backdrop=LocalNativeOverlayBackdrop.current
                    SideEffect{source.set(backdrop)}
                    Column(Modifier.weight(1f).fillMaxWidth().nativeManagementScroll(rememberScrollState()).testTag("floatingScroll")){
                        repeat(40){Text("第 $it 项 · 用量、账号与设置",Modifier.fillMaxWidth().height(68.dp).testTag("floatingRow:$it"))}
                    }
                }
            }
        }}
        ui.waitUntil(10000){source.get()?.frame?.let{it>0}==true}
        val toolbar=ui.onNodeWithTag("managementToolbar").fetchSemanticsNode().boundsInRoot
        assertTrue(ui.onNodeWithTag("floatingRow:0").fetchSemanticsNode().boundsInRoot.top>=toolbar.bottom-1f)
        val page=ui.onNodeWithTag("floatingPage").fetchSemanticsNode().boundsInWindow
        val placement=source.get()!!.placement!!
        assertEquals("The capture must include the area behind the toolbar",page.top,placement.windowOffset.y,1f)
        assertEquals(page.height,placement.size.height.toFloat(),1f)
        val before=source.get()!!.frame
        ui.onNodeWithTag("floatingScroll").performTouchInput{swipeUp()}
        ui.waitUntil(10000){source.get()!!.frame>before}
        ui.onNodeWithContentDescription("刷新").performTouchInput{longClick()}
        ui.onNodeWithText("刷新").assertIsDisplayed()
        assertEquals(0,clicks.get())
        ui.onNodeWithContentDescription("刷新").performClick()
        assertEquals(1,clicks.get())
    }
}
