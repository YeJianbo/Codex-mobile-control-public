package com.localcodex.control

import android.text.SpannableString
import android.text.Spanned
import android.text.style.ClickableSpan
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
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
