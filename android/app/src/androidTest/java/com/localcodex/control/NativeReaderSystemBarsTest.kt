package com.localcodex.control

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfDocument
import android.os.Build
import android.view.Window
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.atomic.AtomicReference

class NativeReaderSystemBarsTest{
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    private fun verify(light:Boolean,kind:String,mode:NativeGlassMode){
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val context=instrumentation.targetContext
        val file=File(context.cacheDir,"reader-system-bars.pdf")
        val document=PdfDocument()
        try{
            val page=document.startPage(PdfDocument.PageInfo.Builder(400,600,1).create())
            page.canvas.drawColor(AndroidColor.WHITE);document.finishPage(page)
            file.outputStream().use{document.writeTo(it)}
        }finally{document.close()}
        ui.runOnUiThread{
            WindowCompat.setDecorFitsSystemWindows(ui.activity.window,false)
            ui.activity.window.statusBarColor=AndroidColor.TRANSPARENT
            ui.activity.window.navigationBarColor=AndroidColor.TRANSPARENT
        }
        val window=AtomicReference<Window>()
        val definition=when(mode){NativeGlassMode.LIQUID->NativeBuiltinThemes.liquid;NativeGlassMode.LIGHT->NativeBuiltinThemes.lightweight;else->NativeBuiltinThemes.standard}
        val theme=definition.resolve(!light)
        val expectedBackground=theme.palette.background.toArgb()
        ui.setContent{
            NativeThemeProvider(theme,theme.palette.material(!light)){
              CompositionLocalProvider(LocalNativeGlassMode provides mode){
                Box(Modifier.fillMaxSize().background(Color.Magenta)){Text("D:/underlying-chat/output/file.pdf")}
                val capture:@androidx.compose.runtime.Composable ()->Unit={
                    val own=(LocalView.current.parent as? DialogWindowProvider)?.window
                    SideEffect{if(own!=null)window.set(own)}
                }
                if(kind=="pdf")NativePdfPreview(NativePdf(file.absolutePath,"report.pdf"),{},overlay=capture)
                else NativeDocumentPreviewContent(NativeReadableFile("report.md","report.md","Reader body"),false,{}, {},
                    reader={modifier,_,_->Text("Reader body",modifier)},overlay=capture)
              }
            }
        }
        ui.waitUntil(10000){window.get()!=null};ui.waitForIdle()
        val dialog=window.get()
        val screen=ui.activity.windowManager.maximumWindowMetrics.bounds
        val location=IntArray(2)
        ui.runOnUiThread{dialog.decorView.getLocationOnScreen(location)}
        assertEquals(0,location[1]);assertEquals(screen.height(),dialog.decorView.height)
        assertEquals(0,dialog.attributes.flags and WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        if(Build.VERSION.SDK_INT>=30)assertEquals(0,dialog.attributes.fitInsetsTypes)
        assertEquals(light,WindowCompat.getInsetsController(dialog,dialog.decorView).isAppearanceLightStatusBars)
        val statusHeight=context.resources.getDimensionPixelSize(context.resources.getIdentifier("status_bar_height","dimen","android"))
        if(kind=="pdf"){
            ui.waitUntil(10000){ui.onAllNodesWithContentDescription("PDF 第 1 页").fetchSemanticsNodes().isNotEmpty()}
            assertTrue(ui.onNodeWithContentDescription("关闭 PDF 预览").fetchSemanticsNode().boundsInRoot.top>=statusHeight)
            val toolbar=ui.onNodeWithTag("readerToolbar").fetchSemanticsNode().boundsInRoot
            val firstPage=ui.onNodeWithContentDescription("PDF 第 1 页").fetchSemanticsNode().boundsInRoot
            assertTrue("The initial page must not be hidden behind the themed toolbar",firstPage.top>=toolbar.bottom-1f)
        }
        fun matchesBackground(bitmap:Bitmap):Boolean{
            val pixel=bitmap.getPixel(bitmap.width/2,statusHeight/2)
            return listOf(AndroidColor.red(pixel) to AndroidColor.red(expectedBackground),
                AndroidColor.green(pixel) to AndroidColor.green(expectedBackground),
                AndroidColor.blue(pixel) to AndroidColor.blue(expectedBackground)).all{(actual,expected)->kotlin.math.abs(actual-expected)<=3}
        }
        // Compose idle does not wait for WindowManager's native Dialog fade.
        // Inspect the settled window, while still failing if the host leaks.
        ui.waitUntil(10000){
            val frame=instrumentation.uiAutomation.takeScreenshot()
            try{matchesBackground(frame)}finally{frame.recycle()}
        }
        val screenshot=instrumentation.uiAutomation.takeScreenshot()
        try{
            val bar=screenshot.getPixel(screenshot.width/2,statusHeight/2)
            for((channel,expected) in listOf(AndroidColor.red(bar) to AndroidColor.red(expectedBackground),AndroidColor.green(bar) to AndroidColor.green(expectedBackground),AndroidColor.blue(bar) to AndroidColor.blue(expectedBackground))){
                assertTrue("Status bar must be the opaque reader background, not the host or its dim layer: $bar",kotlin.math.abs(channel-expected)<=3)
            }
            File(context.getExternalFilesDir(null),"reader-$kind-${if(light)"light" else "dark"}.png").outputStream().use{screenshot.compress(Bitmap.CompressFormat.PNG,100,it)}
        }finally{screenshot.recycle()}
    }
    @Test fun liquidPdfCoversTheStatusBar(){verify(true,"pdf",NativeGlassMode.LIQUID)}
    @Test fun lightweightDarkPdfCoversTheStatusBar(){verify(false,"pdf",NativeGlassMode.LIGHT)}
    @Test fun standardDocumentReaderCoversTheStatusBar(){verify(true,"document",NativeGlassMode.OFF)}
}
