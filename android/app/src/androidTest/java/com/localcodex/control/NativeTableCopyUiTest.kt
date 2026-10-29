package com.localcodex.control

import android.content.ClipboardManager
import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class NativeTableCopyUiTest{
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private var selectionCopy:(()->Unit)?=null
    private val toolbar=object:TextToolbar{
        override var status=TextToolbarStatus.Hidden
        override fun showMenu(rect:Rect,onCopyRequested:(()->Unit)?,onPasteRequested:(()->Unit)?,onCutRequested:(()->Unit)?,onSelectAllRequested:(()->Unit)?){
            selectionCopy=onCopyRequested;status=TextToolbarStatus.Shown
        }
        override fun hide(){status=TextToolbarStatus.Hidden}
    }
    private val source="| 名称 | 内容 | 备注 |\n| --- | --- | --- |\n| 模型 | `a\\|b` | 说明 |"
    private fun show(table:String=source){
        ui.setContent{MaterialTheme{CompositionLocalProvider(LocalTextToolbar provides toolbar){Column(Modifier.width(360.dp)){
            NativeRichTextContent(table,{},resolveImage={null},image={_,_->})
        }}}}
        ui.waitForIdle()
        ui.waitUntil(10000){ui.activity.hasWindowFocus()}
    }
    private fun copied():String{
        ui.waitForIdle()
        ui.waitUntil(10000){ui.activity.hasWindowFocus()}
        var value=""
        ui.runOnUiThread{value=(ui.activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager)
            .primaryClip!!.getItemAt(0).text.toString()}
        return value
    }
    @Test fun wholeTableCopiesColumnsAndMarkdownCopiesOriginalSource(){
        show()
        ui.onNodeWithContentDescription("复制表格").performClick()
        ui.onNodeWithText("复制表格").performClick()
        assertEquals("名称\t内容\t备注\n模型\ta|b\t说明",copied())
        ui.onNodeWithContentDescription("复制表格").performClick()
        ui.onNodeWithText("复制 Markdown").performClick()
        assertEquals(source,copied())
    }
    @Test fun cellLongPressOffersCopyAndWideTableStillScrolls(){
        show("| 名称 | 内容 | 备注 | 第四列 |\n| --- | --- | --- | --- |\n| 模型 | `a\\|b` | 说明 | 最右列 |")
        val table=ui.onNodeWithTag("markdownTable")
        fun offset()=table.fetchSemanticsNode().config[SemanticsProperties.HorizontalScrollAxisRange].value()
        val before=offset()
        table.performTouchInput{swipe(Offset(width-20f,centerY),Offset(20f,centerY),500)}
        assertTrue("A normal drag must scroll the wide table",offset()>before)
        table.performTouchInput{swipe(Offset(20f,centerY),Offset(width-20f,centerY),500)}
        ui.onNodeWithText("模型").performTouchInput{longClick(center)}
        ui.waitUntil(10000){selectionCopy!=null}
        ui.runOnUiThread{selectionCopy!!.invoke()}
        assertEquals("模型",copied())
    }
}
