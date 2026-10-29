package com.localcodex.control

import android.text.SpannableString
import android.text.Spanned
import android.text.style.ClickableSpan
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeTextSelectionUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun longQuoteRailRemainsContinuousWhenItsFirstLineIsOutsideTheViewport(){
        lateinit var view:NativeSelectableTextView
        ui.setContent{androidx.compose.ui.viewinterop.AndroidView(factory={context->NativeSelectableTextView(context).also{
            view=it;it.textSize=18f;it.setTextColor(android.graphics.Color.BLACK);it.setBackgroundColor(android.graphics.Color.WHITE)
            nativeMarkwon(context,null,android.graphics.Color.BLACK,android.graphics.Color.WHITE,android.graphics.Color.WHITE)
                .setMarkdown(it,(1..60).joinToString("\n"){line->"> 引用第${line}行，滚动后竖线应连续显示。"})
        }},modifier=androidx.compose.ui.Modifier.fillMaxWidth())}
        ui.waitForIdle()
        ui.runOnUiThread{
            val layout=view.layout
            val density=view.resources.displayMetrics.density
            val cropTop=layout.getLineTop(10)
            val cropBottom=layout.getLineBottom(14)
            val bitmap=android.graphics.Bitmap.createBitmap(view.width,cropBottom-cropTop,android.graphics.Bitmap.Config.ARGB_8888)
            val canvas=android.graphics.Canvas(bitmap)
            canvas.translate(0f,-cropTop.toFloat())
            view.draw(canvas)
            val x=(2*density).toInt()+view.totalPaddingLeft
            val rail=bitmap.getPixel(x,bitmap.height/2)
            assertNotEquals("A clipped quote must still draw its rail",android.graphics.Color.WHITE,rail)
            for(y in 0 until bitmap.height)assertEquals("No darker overlap or gaps at line boundaries: $y",rail,bitmap.getPixel(x,y))
            java.io.File(ui.activity.getExternalFilesDir(null),"selection454-clipped-quote.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            bitmap.recycle()
        }
    }
    @Test fun quotedSelectionLeavesBlankLinesAndLineEndsClearWithoutChangingCopiedText(){
        lateinit var view:NativeSelectableTextView
        val background=android.graphics.Color.WHITE
        ui.setContent{androidx.compose.ui.viewinterop.AndroidView(factory={context->NativeSelectableTextView(context).also{
            view=it;it.textSize=18f;it.setTextColor(android.graphics.Color.BLACK);it.setBackgroundColor(background)
            it.applySelectionColors(androidx.compose.foundation.text.selection.TextSelectionColors(androidx.compose.ui.graphics.Color.Blue,androidx.compose.ui.graphics.Color(0x443566ef)))
            nativeMarkwon(context,null,android.graphics.Color.BLACK,background,background).setMarkdown(it,
                "可以，问实际大小更自然：\n\n> 老师你那个G97大不大啊\n>\n> 我昨天看到个松下相机，好小一只\n\n这两句可以一起发。")
            it.isFocusableInTouchMode=true
        }},modifier=androidx.compose.ui.Modifier.fillMaxWidth())}
        ui.waitUntil(10000){view.hasWindowFocus()}
        ui.runOnUiThread{
            view.requestFocus()
            val end=view.text.indexOf("一只")+2
            android.text.Selection.setSelection(view.text as android.text.Spannable,0,end)
            val bitmap=android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(bitmap))
            val layout=view.layout
            val text=view.text as Spanned
            assertEquals(1,text.getSpans(0,text.length,NativeQuoteSpan::class.java).size)
            val rowEnd=(layout.getLineRight(0)+16*view.resources.displayMetrics.density).toInt().coerceAtMost(view.width-1)
            assertEquals("The first line must not tint its empty trailing area",background,bitmap.getPixel(rowEnd+view.totalPaddingLeft,layout.getLineBaseline(0)+view.totalPaddingTop))
            val empty=(0 until layout.lineCount).first{layout.getLineVisibleEnd(it)==layout.getLineStart(it)}
            assertEquals("Blank paragraph spacing must not turn into a blue band",background,bitmap.getPixel(view.width/2,(layout.getLineTop(empty)+layout.getLineBottom(empty))/2+view.totalPaddingTop))
            java.io.File(ui.activity.getExternalFilesDir(null),"selection453-quoted.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            val expected=view.text.subSequence(0,end).toString()
            android.text.Selection.setSelection(view.text as android.text.Spannable,end,0)
            val reversed=android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(reversed))
            assertTrue("Reverse selection must paint the same text range",bitmap.sameAs(reversed))
            assertEquals("Reverse selection must keep the same unpainted line ending",background,reversed.getPixel(rowEnd+view.totalPaddingLeft,layout.getLineBaseline(0)+view.totalPaddingTop))
            bitmap.recycle();reversed.recycle()
            assertTrue(view.onTextContextMenuItem(android.R.id.copy))
            val clipboard=ui.activity.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            assertEquals(expected,clipboard.primaryClip!!.getItemAt(0).text.toString())
            assertFalse(expected.contains('>'))
        }
    }
    @Test fun inlineCodeKeepsItsBackgroundButSelectionPaintsContinuouslyAboveIt(){
        lateinit var view:NativeSelectableTextView
        val wash=android.graphics.Color.WHITE
        val codeBackground=nativeInlineCodeBackground(android.graphics.Color.BLACK,android.graphics.Color.WHITE)
        ui.setContent{androidx.compose.ui.viewinterop.AndroidView(factory={context->
            NativeSelectableTextView(context).also{
                view=it;it.textSize=20f;it.setTextColor(android.graphics.Color.BLACK);it.setBackgroundColor(android.graphics.Color.WHITE)
                it.applySelectionColors(androidx.compose.foundation.text.selection.TextSelectionColors(androidx.compose.ui.graphics.Color.Blue,androidx.compose.ui.graphics.Color.Blue))
                nativeMarkwon(context,null,android.graphics.Color.BLACK,wash,android.graphics.Color.WHITE).setMarkdown(it,"这轮会用 `compose-performance` 技能检查。")
                it.movementMethod=android.text.method.ArrowKeyMovementMethod.getInstance()
                it.isFocusableInTouchMode=true
            }
        },modifier=androidx.compose.ui.Modifier.fillMaxWidth())}
        ui.waitForIdle()
        // Android denies clipboard reads while the Activity's entry transition
        // has not yet given its window focus, even when the TextView is focused.
        ui.waitUntil(10000){view.hasWindowFocus()}
        ui.runOnUiThread{
            val styled=view.text as Spanned
            val span=styled.getSpans(0,styled.length,NativeInlineCodeSpan::class.java).single()
            val start=styled.getSpanStart(span);val end=styled.getSpanEnd(span)
            val paint=android.text.TextPaint(view.paint);span.updateDrawState(paint)
            assertEquals(android.graphics.Color.TRANSPARENT,paint.bgColor)
            val line=view.layout.getLineForOffset(start)
            val x=((view.layout.getPrimaryHorizontal(start)+view.layout.getPrimaryHorizontal(end))/2).toInt()+view.totalPaddingLeft
            val y=view.layout.getLineTop(line)+view.totalPaddingTop+2
            fun bitmap()=android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888).also{view.draw(android.graphics.Canvas(it))}
            val plain=bitmap();assertEquals(codeBackground,plain.getPixel(x,y));assertNotEquals("Inline code must not inherit the glass theme's white panel",wash,plain.getPixel(x,y));plain.recycle()
            view.requestFocus();android.text.Selection.setSelection(view.text as android.text.Spannable,0,view.text.length)
            assertTrue(view.isFocused);assertTrue(view.hasSelection())
            val selected=bitmap();assertEquals(android.graphics.Color.BLUE,selected.getPixel(x,y))
            java.io.File(ui.activity.filesDir,"inline-code-selection.png").outputStream().use{selected.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            selected.recycle()
            val expected=view.text.toString()
            assertTrue(view.onTextContextMenuItem(android.R.id.copy))
            val clipboard=ui.activity.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
            assertEquals(expected,clipboard.primaryClip!!.getItemAt(0).text.toString())
            assertFalse(expected.contains('`'))
        }
    }
    @Test fun softWrappedSelectionHasNoNotchesOrTrailingFill(){
        lateinit var view:NativeSelectableTextView
        val blue=android.graphics.Color.BLUE
        ui.setContent{androidx.compose.ui.viewinterop.AndroidView(factory={context->NativeSelectableTextView(context).also{
            view=it;it.textSize=18f;it.setTextColor(android.graphics.Color.TRANSPARENT);it.setBackgroundColor(android.graphics.Color.WHITE)
            it.applySelectionColors(androidx.compose.foundation.text.selection.TextSelectionColors(androidx.compose.ui.graphics.Color.Blue,androidx.compose.ui.graphics.Color.Blue))
            it.text="文字换行边缘应该连续".repeat(12)+"\n\nEnglish العربية 中文"
            it.isFocusableInTouchMode=true
        }},modifier=androidx.compose.ui.Modifier.width(240.dp))}
        ui.waitUntil(10000){view.hasWindowFocus()}
        ui.runOnUiThread{
            view.requestFocus()
            val end=view.text.indexOf('\n')
            android.text.Selection.setSelection(view.text as android.text.Spannable,2,end)
            val bitmap=android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(bitmap))
            val layout=view.layout
            assertTrue(layout.getLineForOffset(end)>3)
            for(line in 1..2){
                val right=minOf(layout.getLineRight(line),layout.getLineRight(line+1))
                val x=right.toInt()-2+view.totalPaddingLeft
                val seam=layout.getLineTop(line+1)+view.totalPaddingTop
                for(y in seam-1..seam+1)assertEquals("A wrapped selected edge must stay solid at line $line, y=$y",blue,bitmap.getPixel(x,y))
            }
            val last=layout.getLineForOffset(end-1)
            val outside=(layout.getLineRight(last)+3).toInt()+view.totalPaddingLeft
            if(outside<view.width)assertEquals("Selection must stop at the text edge",android.graphics.Color.WHITE,
                bitmap.getPixel(outside,layout.getLineBaseline(last)+view.totalPaddingTop))
            java.io.File(ui.activity.getExternalFilesDir(null),"selection457-soft-wrap.png").outputStream().use{bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
            android.text.Selection.setSelection(view.text as android.text.Spannable,end,2)
            val reversed=android.graphics.Bitmap.createBitmap(view.width,view.height,android.graphics.Bitmap.Config.ARGB_8888)
            view.draw(android.graphics.Canvas(reversed));assertTrue(bitmap.sameAs(reversed))
            bitmap.recycle();reversed.recycle()
        }
    }
    @Test fun fullScreenSelectionKeepsTheSelectedTextAndRemovesMarkdownMarkers(){
        ui.setContent{MaterialTheme{NativeTextSelection("**正文**\n\n导入 `proxy-groups` 和 `rules`。","proxy-groups",null,{})}}
        ui.waitUntil(10000){ui.onAllNodesWithTag("replySelectionText").fetchSemanticsNodes().isNotEmpty()}
        val editor=ui.onNodeWithTag("replySelectionText")
        editor.assertTextContains("正文\n\n导入 proxy-groups 和 rules。")
        val range=editor.fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange]
        assertEquals("proxy-groups".length,range.length)
        ui.onNodeWithText("全选").performClick()
        val all=editor.fetchSemanticsNode().config[SemanticsProperties.TextSelectionRange]
        assertEquals("正文\n\n导入 proxy-groups 和 rules。".length,all.length)
    }
    @Test fun nativeSelectionKeepsArrowMovementWhileShortTapsStillOpenLinks(){
        lateinit var view:NativeSelectableTextView
        var opened=0
        ui.setContent{androidx.compose.ui.viewinterop.AndroidView(factory={context->NativeSelectableTextView(context).also{
            view=it
            it.text=SpannableString("打开链接").apply{setSpan(object:ClickableSpan(){override fun onClick(widget:android.view.View){opened++}},0,length,Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)}
        }})}
        ui.waitForIdle()
        ui.runOnUiThread{
            assertTrue(view.movementMethod is android.text.method.ArrowKeyMovementMethod)
            val x=view.layout.getPrimaryHorizontal(1);val y=view.layout.getLineBaseline(0).toFloat()
            val now=android.os.SystemClock.uptimeMillis()
            for((action,time) in listOf(MotionEvent.ACTION_DOWN to now,MotionEvent.ACTION_UP to now+50)){
                val event=MotionEvent.obtain(now,time,action,x,y,0);view.onTouchEvent(event);event.recycle()
            }
            assertEquals(1,opened)
            android.text.Selection.setSelection(view.text as android.text.Spannable,0,2)
            for((action,time) in listOf(MotionEvent.ACTION_DOWN to now+100,MotionEvent.ACTION_UP to now+150)){
                val event=MotionEvent.obtain(now+100,time,action,x,y,0);view.onTouchEvent(event);event.recycle()
            }
            assertEquals(1,opened)
        }
    }
}
