package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import java.io.File

class NativeSurfaceConsistencyTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun settingsAndFoldersUseTheActiveTheme(){
        val mode=mutableStateOf(NativeGlassMode.LIQUID)
        val dark=mutableStateOf(false)
        val folder=mutableStateOf(false)
        val directory=NativeOutputDirectory("F:/output/全部成片与完整对照","answer","thread",files=listOf(
            FileEntry("对照与缩略图","对照与缩略图","directory"),
            FileEntry("先看这六张.jpg","先看这六张.jpg","file",948663),
            FileEntry("本次调色参数与输出记录.pdf","记录.pdf","file",2379863),
            FileEntry("包含较长中文名称的素材归档与成片清单.xlsx","清单.xlsx","file",24680),
        ))
        ui.setContent{
            val definition=when(mode.value){NativeGlassMode.LIQUID->NativeBuiltinThemes.liquid;NativeGlassMode.LIGHT->NativeBuiltinThemes.lightweight;else->NativeBuiltinThemes.standard}
            val theme=definition.resolve(dark.value)
            NativeThemeProvider(theme,theme.palette.material(dark.value)){
                CompositionLocalProvider(LocalNativeGlassMode provides mode.value){
                    if(folder.value)NativeOutputDirectoryPreview(directory,false,"","",{},{},{},{folder.value=false})
                    else NativeSettingsHome(true,listOf("automations","agent-health"),{},{})
                }
            }
        }
        val variants=listOf(NativeGlassMode.LIQUID to false,NativeGlassMode.LIQUID to true,NativeGlassMode.LIGHT to false,NativeGlassMode.OFF to false)
        for((style,isDark) in variants){
            ui.runOnUiThread{folder.value=false;mode.value=style;dark.value=isDark}
            ui.onNodeWithTag("settingsHome").assertIsDisplayed()
            ui.onNodeWithTag("settings:accounts").assertIsDisplayed()
            capture("settings-${style.stored}-${if(isDark)"dark" else "light"}")
            if(style==NativeGlassMode.LIQUID&&!isDark){
                ui.onNodeWithTag("settingsHome").performTouchInput{swipeUp()}
                capture("settings-liquid-scrolled")
            }
            ui.runOnUiThread{folder.value=true}
            ui.onNodeWithTag("workspaceFile:先看这六张.jpg").assertIsDisplayed()
            ui.onNodeWithText("图片 · 926 KB").assertIsDisplayed()
            capture("folders-${style.stored}-${if(isDark)"dark" else "light"}")
        }
    }

    private fun capture(name:String){
        ui.waitForIdle()
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        // WindowManager's native dialog fade is independent of Compose's test clock.
        val ready=android.os.SystemClock.uptimeMillis()+300
        ui.waitUntil(2000){android.os.SystemClock.uptimeMillis()>=ready}
        val bitmap=instrumentation.uiAutomation.takeScreenshot()?:error("截图失败")
        try{File(instrumentation.targetContext.getExternalFilesDir(null),"material461-$name.png").outputStream().use{
            bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)
        }}finally{bitmap.recycle()}
    }
}
