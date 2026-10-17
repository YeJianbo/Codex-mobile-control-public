package com.localcodex.control
import android.view.Window
import androidx.activity.ComponentActivity
import androidx.compose.material.*
import androidx.compose.runtime.SideEffect
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.WindowCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicReference

@RunWith(AndroidJUnit4::class)
class NativeSheetSystemBarsTest{
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private fun verify(light:Boolean){
        ui.runOnUiThread{ui.activity.window.statusBarColor=if(light)android.graphics.Color.WHITE else android.graphics.Color.BLACK}
        val original=ui.activity.window.statusBarColor;val window=AtomicReference<Window>()
        ui.setContent{MaterialTheme(colors=if(light)lightColors() else darkColors()){
            Box(Modifier.fillMaxSize().background(if(light)Color.White else Color.Black)){
            Sheet("用量与配额",{}){
                val own=(LocalView.current.parent as? DialogWindowProvider)?.window
                SideEffect{if(own!=null)window.set(own)}
                Text("当前上下文")
            }
            }
        }}
        ui.waitUntil(10000){window.get()!=null};ui.waitForIdle()
        val dialog=window.get();val controller=WindowCompat.getInsetsController(dialog,dialog.decorView)
        Assert.assertTrue(dialog.attributes.flags and android.view.WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS != 0)
        Assert.assertEquals(0,dialog.attributes.flags and (android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND or android.view.WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS or android.view.WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION))
        if(android.os.Build.VERSION.SDK_INT>=30)Assert.assertEquals(0,dialog.attributes.fitInsetsTypes)
        Assert.assertEquals(android.graphics.Color.TRANSPARENT,dialog.statusBarColor)
        Assert.assertEquals(light,controller.isAppearanceLightStatusBars)
        Assert.assertEquals(light,controller.isAppearanceLightNavigationBars)
        Assert.assertEquals(original,ui.activity.window.statusBarColor)
        if(android.os.Build.VERSION.SDK_INT>=29)Assert.assertFalse(dialog.isStatusBarContrastEnforced)
        val location=IntArray(2)
        ui.runOnUiThread{dialog.decorView.getLocationOnScreen(location)}
        Assert.assertEquals(0,location[1])
        val screenshot=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try{
            val statusHeight=ui.activity.resources.getDimensionPixelSize(ui.activity.resources.getIdentifier("status_bar_height","dimen","android"))
            val bar=screenshot.getPixel(screenshot.width/2,statusHeight/2)
            val body=screenshot.getPixel(screenshot.width/2,statusHeight+12)
            Assert.assertTrue("The scrim must continue across the status bar",kotlin.math.abs(android.graphics.Color.red(bar)-android.graphics.Color.red(body))<=4)
            if(light)Assert.assertTrue("Status bar must be dimmed with the sheet",android.graphics.Color.red(bar) in 150..190)
            java.io.File(ui.activity.getExternalFilesDir(null),"sheet-${if(light)"light" else "dark"}-296.png").outputStream().use{screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        }finally{screenshot.recycle()}
    }
    @Test fun lightSheetKeepsDarkStatusBarIcons(){verify(true)}
    @Test fun darkSheetKeepsLightStatusBarIcons(){verify(false)}
}
