package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

internal fun nativeOfficePreviewFixture(context:android.content.Context):File {
        val external=InstrumentationRegistry.getArguments().getString("workbookPath")
        return if(external!=null)File(external) else File(context.cacheDir,"comparison.xlsx").apply{
            val rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            ZipOutputStream(outputStream()).use{zip->
                val entries=mapOf(
                    "xl/workbook.xml" to """<workbook xmlns:r="$rel"><sheets><sheet name="航班比价" r:id="r1"/><sheet name="酒店预算" r:id="r2"/></sheets></workbook>""",
                    "xl/_rels/workbook.xml.rels" to """<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>""",
                    "xl/worksheets/sheet1.xml" to """<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>航班价格</t></is></c><c r="B1"><v>1280</v></c></row></sheetData></worksheet>""",
                    "xl/worksheets/sheet2.xml" to """<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>酒店预算</t></is></c></row></sheetData></worksheet>""",
                )
                for((path,xml)in entries){zip.putNextEntry(ZipEntry(path));zip.write(xml.toByteArray());zip.closeEntry()}
            }
        }
}

class NativeOfficePreviewRegressionTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun rendererExitKeepsTheReaderOpenAndCanReload(){
        org.junit.Assume.assumeTrue(android.os.Build.VERSION.SDK_INT>=29)
        val book=nativeOfficePreviewFixture(InstrumentationRegistry.getInstrumentation().targetContext)
        val document=NativeReadableFile(book.name,book.absolutePath,"",pages=nativeReadOfficeDocument(book,book.name))
        ui.setContent{
            val theme=NativeBuiltinThemes.liquid.resolve(false)
            NativeThemeProvider(theme,theme.palette.material(false)){
                CompositionLocalProvider(LocalNativeGlassMode provides NativeGlassMode.LIQUID){
                    NativeDocumentPreviewContent(document,false,{}, {},reader={_,_,_->})
                }
            }
        }
        fun ready(){ui.waitUntil(15000){ui.onNodeWithTag("documentWebContent").fetchSemanticsNode().config.getOrNull(SemanticsProperties.StateDescription)=="文档已就绪"}}
        ready()
        ui.runOnUiThread{
            val pending=java.util.ArrayDeque<android.view.View>()
            android.view.inspector.WindowInspector.getGlobalWindowViews().forEach{pending.add(it)}
            var terminated=false
            while(pending.isNotEmpty()){
                val view=pending.removeFirst()
                if(view is android.webkit.WebView){terminated=view.webViewRenderProcess?.terminate()==true;break}
                if(view is android.view.ViewGroup)repeat(view.childCount){pending.add(view.getChildAt(it))}
            }
            check(terminated){"The preview must own an active document renderer"}
        }
        ui.waitUntil(15000){ui.onAllNodesWithText("文档显示中断，请重新加载").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithContentDescription("关闭阅读器").assertIsDisplayed()
        ui.onNodeWithText("重新加载文档").performClick()
        ready()
        ui.onNodeWithText(document.pages[1].name).performClick()
        ready()
    }

    @Test fun workbookOpensSwitchesSheetsAndClosesAcrossThemes(){
        val book=nativeOfficePreviewFixture(InstrumentationRegistry.getInstrumentation().targetContext)
        val pages=nativeReadOfficeDocument(book,book.name)
        check(pages.size>=2)
        val document=NativeReadableFile(book.name,book.absolutePath,"",mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pages=pages)
        val mode=mutableStateOf(NativeGlassMode.LIQUID)
        val dark=mutableStateOf(false)
        val open=mutableStateOf(true)
        ui.setContent{
            val definition=when(mode.value){NativeGlassMode.LIQUID->NativeBuiltinThemes.liquid;NativeGlassMode.LIGHT->NativeBuiltinThemes.lightweight;else->NativeBuiltinThemes.standard}
            val theme=definition.resolve(dark.value)
            NativeThemeProvider(theme,theme.palette.material(dark.value)){
                CompositionLocalProvider(LocalNativeGlassMode provides mode.value){
                    if(open.value)NativeDocumentPreviewContent(document,false,{}, {open.value=false},reader={_,_,_->})
                }
            }
        }
        for((style,isDark) in listOf(NativeGlassMode.LIQUID to false,NativeGlassMode.LIQUID to true,NativeGlassMode.LIGHT to false,NativeGlassMode.OFF to false)){
            ui.runOnUiThread{mode.value=style;dark.value=isDark;open.value=true}
            ui.onNodeWithTag("documentWebContent").assertIsDisplayed()
            ui.waitUntil(15000){ui.onNodeWithTag("documentWebContent").fetchSemanticsNode().config.getOrNull(SemanticsProperties.StateDescription)=="文档已就绪"}
            ui.onNodeWithText(pages[1].name).performClick()
            ui.waitUntil(15000){ui.onNodeWithTag("documentWebContent").fetchSemanticsNode().config.getOrNull(SemanticsProperties.StateDescription)=="文档已就绪"}
            ui.onNodeWithTag("documentWebContent").performTouchInput{swipeUp()}
            ui.onNodeWithContentDescription("关闭阅读器").performClick()
            ui.onNodeWithTag("documentWebContent").assertDoesNotExist()
        }
    }
}
