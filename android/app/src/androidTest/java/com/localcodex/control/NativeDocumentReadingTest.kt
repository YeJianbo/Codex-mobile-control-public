package com.localcodex.control

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfDocument
import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class NativeDocumentReadingTest{
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val rel="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    private fun archive(name:String,entries:Map<String,String>):File=File(context.cacheDir,name).apply{
        ZipOutputStream(outputStream()).use{zip->for((path,xml)in entries){zip.putNextEntry(ZipEntry(path));zip.write(xml.toByteArray());zip.closeEntry()}}
    }
    private fun pdf():File=File(context.cacheDir,"resolution.pdf").apply{
        val document=PdfDocument()
        try{
            val page=document.startPage(PdfDocument.PageInfo.Builder(400,600,1).create())
            page.canvas.drawColor(Color.WHITE)
            val paint=Paint().apply{color=Color.BLACK}
            page.canvas.drawRect(100f,0f,100.1f,80f,paint)
            page.canvas.drawRect(100.2f,0f,100.3f,80f,paint)
            paint.textSize=8f
            for(line in 0..40)page.canvas.drawText("Vector text stays sharp at 400% 0123456789",20f,110f+line*10f,paint)
            paint.color=Color.RED;page.canvas.drawRect(100f,120f,130f,180f,paint)
            document.finishPage(page);outputStream().use{document.writeTo(it)}
        }finally{document.close()}
    }
    @Test fun visiblePdfCropRendersAtActualZoomWithBoundedAllocation()=runBlocking{
        val pages=NativePdfPages(pdf()){}
        try{
            val base=pages.render(0,4000)
            val region=NativePdfRegion(4000,900,0,1412,768)
            val detail=pages.renderRegion(0,region)
            try{
                assertTrue(base.width<1800);assertEquals(512,detail.width);assertEquals(768,detail.height)
                assertEquals("A one-screen-pixel vector stroke must become black at the requested raster resolution",Color.BLACK,detail.getPixel(100,200))
                assertEquals(Color.WHITE,detail.getPixel(110,200))
                assertEquals("Fine vector strokes remain separate",Color.WHITE,detail.getPixel(101,200))
                assertEquals(Color.BLACK,detail.getPixel(102,200))
                val low=base.getPixel((100.15f*base.width/400).toInt(),(20f*base.width/400).toInt())
                assertEquals("The old full-page cap merges the gap between strokes",Color.BLACK,low)
                val crop=pages.renderRegion(0,NativePdfRegion(4000,1000,1200,1512,1968))
                try{assertEquals(Color.RED,crop.getPixel(100,200));assertEquals(Color.WHITE,crop.getPixel(400,200))}finally{crop.recycle()}
            }finally{base.recycle();detail.recycle()}
        }finally{pages.dispose()}
    }
    @Test fun pinchAndPanReplaceTheVisiblePdfDetail(){
        val file=pdf()
        ui.setContent{MaterialTheme{NativePdfPreview(NativePdf(file.absolutePath,"resolution.pdf"),{})}}
        ui.waitUntil(10000){ui.onAllNodesWithContentDescription("PDF 第 1 页").fetchSemanticsNodes().isNotEmpty()}
        fun detailTag():String?=ui.onAllNodes(SemanticsMatcher("PDF detail"){it.config.getOrNull(SemanticsProperties.TestTag)?.startsWith("pdfDetail-0-")==true})
            .fetchSemanticsNodes().firstOrNull()?.config?.get(SemanticsProperties.TestTag)
        fun magnify(){ui.onNodeWithTag("pdfGestureSurface").performTouchInput{
            pinch(start0=center-Offset(width/8f,0f),end0=center-Offset(width/4f,0f),
                start1=center+Offset(width/8f,0f),end1=center+Offset(width/4f,0f))
        }}
        magnify()
        ui.onNodeWithTag("pdfGestureSurface").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"缩放 200%"))
        ui.waitUntil(10000){detailTag()!=null}
        val first=checkNotNull(detailTag());val firstWidth=first.split('-')[2].toInt()
        magnify()
        ui.onNodeWithTag("pdfGestureSurface").assert(SemanticsMatcher.expectValue(SemanticsProperties.StateDescription,"缩放 400%"))
        try{ui.waitUntil(10000){(detailTag()?.split('-')?.get(2)?.toInt()?:0)>=firstWidth*1.9}}catch(error:Throwable){
            File(context.getExternalFilesDir(null),"pdf458-detail-failure.txt").writeText("first=$first; now=${detailTag()}\n"+ui.onNodeWithTag("pdfGestureSurface",useUnmergedTree=true).printToString())
            val image=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            try{File(context.getExternalFilesDir(null),"pdf458-detail-failure.png").outputStream().use{image.compress(Bitmap.CompressFormat.PNG,100,it)}}finally{image.recycle()}
            throw error
        }
        val beforePan=detailTag()
        ui.onNodeWithTag("pdfGestureSurface").performTouchInput{swipe(center,center+Offset(width/5f,height/10f))}
        ui.waitUntil(10000){detailTag()!=beforePan}
        val viewport=ui.onNodeWithTag("pdfGestureSurface").fetchSemanticsNode().boundsInRoot
        ui.waitUntil(10000){
            val tag=detailTag()
            val detail=tag?.let{ui.onNodeWithTag(it).fetchSemanticsNode().boundsInRoot}
            detail!=null&&detail.left<=viewport.left+4&&detail.top<=viewport.top+4&&detail.right>=viewport.right-4&&detail.bottom>=viewport.bottom-4
        }
        File(context.getExternalFilesDir(null),"pdf458-geometry.txt").writeText(ui.onNodeWithTag("pdfGestureSurface",useUnmergedTree=true).printToString())
        ui.waitForIdle()
        val screenshot=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        try{File(context.getExternalFilesDir(null),"pdf458-zoom4.png").outputStream().use{screenshot.compress(Bitmap.CompressFormat.PNG,100,it)}}finally{screenshot.recycle()}
    }
    @Test fun officeDocumentsAndQuotedCsvKeepTheirReadingStructure(){
        val word=archive("reading.docx",mapOf("word/document.xml" to """<w:document xmlns:w="urn:word"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>文档标题</w:t></w:r></w:p><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>粗体正文 &amp; 原文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格单元格</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"""))
        val doc=nativeReadOfficeDocument(word,word.name).single().html
        assertTrue(doc.contains("<h1>文档标题</h1>"));assertTrue(doc.contains("<strong>粗体正文 &amp; 原文</strong>"));assertTrue(doc.contains("表格单元格"))
        val book=archive("reading.xlsx",mapOf(
            "xl/workbook.xml" to """<workbook xmlns:r="$rel"><sheets><sheet name="收入" r:id="r1"/><sheet name="支出" r:id="r2"/></sheets></workbook>""",
            "xl/_rels/workbook.xml.rels" to """<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>""",
            "xl/sharedStrings.xml" to "<sst><si><t>名称</t></si></sst>",
            "xl/styles.xml" to "<styleSheet><cellXfs><xf numFmtId=\"0\"/><xf numFmtId=\"14\"/></cellXfs></styleSheet>",
            "xl/worksheets/sheet1.xml" to "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"s\"><v>0</v></c><c r=\"C1\" t=\"inlineStr\"><is><t>中文</t></is></c></row><row r=\"2\"><c r=\"A2\" s=\"1\"><v>45292</v></c><c r=\"C2\"><f>1+2</f><v>3</v></c></row></sheetData></worksheet>",
            "xl/worksheets/sheet2.xml" to "<worksheet><sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>第二张工作表</t></is></c></row></sheetData></worksheet>"))
        val sheets=nativeReadOfficeDocument(book,book.name)
        assertEquals(listOf("收入","支出"),sheets.map{it.name});assertTrue(sheets[0].html.contains("2024-01-01"));assertTrue(sheets[0].html.contains("<td>名称</td><td></td><td>中文</td>"));assertTrue(sheets[0].html.contains("<td>3</td>"))
        assertTrue(sheets[1].html.contains("第二张工作表"))
        val slides=archive("reading.pptx",mapOf(
            "ppt/presentation.xml" to """<p:presentation xmlns:p="urn:ppt" xmlns:r="$rel"><p:sldIdLst><p:sldId r:id="r1" id="256"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>""",
            "ppt/_rels/presentation.xml.rels" to "<Relationships><Relationship Id=\"r1\" Target=\"slides/slide1.xml\"/></Relationships>",
            "ppt/slides/slide1.xml" to "<sld><cSld><spTree><sp><txBody><p><r><t>演示文稿正文</t></r></p></txBody></sp></spTree></cSld></sld>"))
        assertTrue(nativeReadOfficeDocument(slides,slides.name).single().html.contains("演示文稿正文"))
        val csv=nativeDelimitedDocument("名称,说明\r\n\"引号\"\"内容\",\"第一行\n第二行,带逗号\"\r\n",',').single().html
        assertTrue(csv.contains("引号&quot;内容"));assertTrue(csv.contains("第一行<br>第二行,带逗号"));assertEquals("AA",nativeSpreadsheetColumn(26))
        ui.setContent{MaterialTheme{
            Box(Modifier.fillMaxSize())
            NativeDocumentPreviewContent(NativeReadableFile(book.name,book.absolutePath,"",mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",pages=sheets),false,{}, {},reader={_,_,_->})
        }}
        ui.onNodeWithText("收入").assertIsDisplayed();ui.onNodeWithText("支出").performClick();ui.onNodeWithTag("documentWebContent").assertIsDisplayed();ui.onNodeWithContentDescription("关闭阅读器").assertIsDisplayed()
        try{
            ui.waitUntil(10000){ui.onNodeWithTag("documentWebContent").fetchSemanticsNode().config.getOrNull(SemanticsProperties.StateDescription)=="文档已就绪"}
            fun hasInk():Boolean{
                val area=ui.onNodeWithTag("documentWebContent").fetchSemanticsNode().boundsInRoot
                val bitmap=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
                return try{
                var ink=0
                for(y in area.top.toInt()+16 until minOf(area.bottom.toInt(),area.top.toInt()+500) step 3)
                    for(x in area.left.toInt()+30 until area.right.toInt()-30 step 3){val pixel=bitmap.getPixel(x,y);if(Color.red(pixel)<120&&Color.green(pixel)<120&&Color.blue(pixel)<120)ink++}
                ink>100
                }finally{bitmap.recycle()}
            }
            ui.waitUntil(10000){hasInk()}
        }finally{
            val screenshot=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
            try{File(context.getExternalFilesDir(null),"documents458-workbook.png").outputStream().use{screenshot.compress(Bitmap.CompressFormat.PNG,100,it)}}finally{screenshot.recycle()}
        }
    }
}
