package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.*
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class NativeGlassRenderingTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun movingPanelReusesGeometryWhileSamplingItsCurrentPosition(){
        val outlines=AtomicInteger()
        val delegate=RoundedCornerShape(18.dp)
        val shape=object:Shape{
            override fun createOutline(size:Size,layoutDirection:LayoutDirection,density:Density):Outline{
                outlines.incrementAndGet()
                return delegate.createOutline(size,layoutDirection,density)
            }
        }
        val motion=mutableFloatStateOf(0f)
        var source:NativeGlassBackdrop?=null
        var target:LayoutCoordinates?=null
        var host:android.view.View?=null
        val width=mutableStateOf(100.dp)
        ui.setContent{MaterialTheme{
            val backdrop=rememberNativeGlassBackdrop(NativeGlassMode.LIQUID)
            val view=LocalView.current
            SideEffect{source=backdrop;host=view}
            Box(Modifier.fillMaxSize()){
                Box(Modifier.fillMaxSize().nativeGlassSource(backdrop).background(Color.Red)){
                    Box(Modifier.fillMaxWidth().height(120.dp).background(Color.Blue))
                }
                CompositionLocalProvider(LocalNativeGlassMotion provides {motion.floatValue}){
                    Box(Modifier.padding(start=40.dp,top=20.dp).size(width.value,60.dp)
                        .graphicsLayer{translationY=motion.floatValue}
                        .nativeGaussianBackdrop(backdrop,shape)
                        .onGloballyPositioned{target=it}
                        .testTag("glassConsumer"))
                }
            }
        }}
        ui.waitUntil(10000){source?.frame?.let{it>0}==true}
        ui.waitForIdle()
        fun center():Color{
            ui.waitForIdle()
            android.os.SystemClock.sleep(100)
            val bitmap=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            val position=target!!.positionInWindow()
            val screen=IntArray(2);val window=IntArray(2)
            host!!.getLocationOnScreen(screen);host!!.getLocationInWindow(window)
            val color=Color(bitmap.getPixel((position.x+screen[0]-window[0]+target!!.size.width/2).toInt(),(position.y+screen[1]-window[1]+target!!.size.height/2).toInt()))
            bitmap.recycle();return color
        }
        val top=center();assertTrue("Initial sample must show the blue backing",top.blue>.8f&&top.red<.2f)
        val before=outlines.get()
        repeat(12){index->
            ui.runOnUiThread{motion.floatValue=(index+1)*20f*ui.activity.resources.displayMetrics.density}
            ui.waitForIdle()
        }
        val calculations=outlines.get()-before
        val bottom=center()
        val sample=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        java.io.File(ui.activity.filesDir,"glass-motion-sample.png").outputStream().use{sample.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
        sample.recycle()
        java.io.File(ui.activity.filesDir,"glass-geometry-probe.json").writeText("{\"motionSteps\":12,\"outlineCalculations\":$calculations,\"red\":${bottom.red},\"green\":${bottom.green},\"blue\":${bottom.blue},\"targetY\":${target!!.positionInWindow().y},\"sourceY\":${source!!.coordinates!!.positionInWindow().y}}")
        assertTrue("Moving glass must sample the red backing at its new position: $bottom",bottom.red>.8f&&bottom.blue<.2f)
        assertTrue("Fixed-size motion recomputed the outline $calculations times",calculations<=1)
        ui.runOnUiThread{motion.floatValue=70f*ui.activity.resources.displayMetrics.density}
        val boundary=center()
        assertTrue("Gaussian blur must blend both colors at their boundary: $boundary",boundary.red in .1f.. .9f&&boundary.blue in .1f.. .9f)
        val beforeResize=outlines.get()
        ui.runOnUiThread{width.value=140.dp};ui.waitForIdle()
        assertTrue("Resizing must refresh the cached geometry",outlines.get()>beforeResize)
        java.io.File(ui.activity.filesDir,"glass-geometry-probe.json").writeText("{\"motionSteps\":12,\"outlineCalculations\":$calculations,\"movingSampleRed\":${bottom.red},\"blurBoundaryRed\":${boundary.red},\"blurBoundaryBlue\":${boundary.blue},\"resizeUpdated\":true}")
    }
}
