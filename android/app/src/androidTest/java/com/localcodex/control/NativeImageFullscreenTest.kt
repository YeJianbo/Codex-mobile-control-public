package com.localcodex.control

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Color
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.MaterialTheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File

class NativeImageFullscreenTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun previewCoversThePhysicalDisplay(){
        val vm=NativeViewModel(ApplicationProvider.getApplicationContext<Application>())
        val image=Bitmap.createBitmap(240,240,Bitmap.Config.ARGB_8888).apply{eraseColor(Color.CYAN)}
        ui.setContent{MaterialTheme{
            Box(Modifier.fillMaxSize().background(androidx.compose.ui.graphics.Color.Magenta))
            NativeImagePreview(image,vm,"/fullscreen-fixture",{})
        }}
        ui.waitForIdle()
        val screen=ui.activity.windowManager.maximumWindowMetrics.bounds
        runCatching{ui.waitUntil(10000){
            val bounds=ui.onNodeWithTag("imagePreviewGestureSurface").fetchSemanticsNode().boundsInRoot
            kotlin.math.abs(bounds.height-screen.height())<=1f
        }}
        val bounds=ui.onNodeWithTag("imagePreviewGestureSurface").fetchSemanticsNode().boundsInRoot
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val screenshot=instrumentation.uiAutomation.takeScreenshot()
        val directory=instrumentation.targetContext.getExternalFilesDir(null)!!
        File(directory,"image-fullscreen.png").outputStream().use{screenshot.compress(Bitmap.CompressFormat.PNG,100,it)}
        assertEquals("Preview width",screen.width().toFloat(),bounds.width,1f)
        assertEquals("Preview height",screen.height().toFloat(),bounds.height,1f)
        // The actual image is square and centered: both physical screen edges
        // must belong to the dark preview, never the host window or dimmed bars.
        for(y in listOf(0,screenshot.height-1)){
            val pixel=screenshot.getPixel(screenshot.width/2,y)
            assertTrue("Screen edge $y must be the preview background",Color.red(pixel)<40&&Color.green(pixel)<40&&Color.blue(pixel)<40)
        }
        ui.onNodeWithContentDescription("关闭图片预览").assertIsDisplayed()
    }
}
