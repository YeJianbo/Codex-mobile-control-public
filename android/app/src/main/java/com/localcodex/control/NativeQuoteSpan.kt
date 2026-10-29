package com.localcodex.control

import android.graphics.Canvas
import android.graphics.Paint
import android.text.Layout
import android.text.Spanned
import android.text.style.LeadingMarginSpan
import kotlin.math.roundToInt

internal class NativeQuoteSpan(private val color:Int,private val density:Float):LeadingMarginSpan{
    override fun getLeadingMargin(first:Boolean)=(14*density).roundToInt()

    override fun drawLeadingMargin(canvas:Canvas,paint:Paint,x:Int,dir:Int,top:Int,baseline:Int,bottom:Int,
        text:CharSequence,start:Int,end:Int,first:Boolean,layout:Layout?){
        val styled=text as? Spanned?:return
        val lines=layout?:return
        val from=styled.getSpanStart(this)
        val until=styled.getSpanEnd(this)
        val firstLine=lines.getLineForOffset(from)
        val lastLine=lines.getLineForOffset((until-1).coerceAtLeast(from))
        val edge=x+dir*density
        val other=edge+dir*2*density
        val oldColor=paint.color;val oldStyle=paint.style
        paint.color=color;paint.style=Paint.Style.FILL
        // Layout invokes only visible lines. Paint this line's slice so the rail
        // survives scrolling its first line away, without overlapping alpha.
        val saved=canvas.save()
        canvas.clipRect(minOf(edge,other),top.toFloat(),maxOf(edge,other),bottom.toFloat())
        canvas.drawRoundRect(minOf(edge,other),lines.getLineTop(firstLine)+2*density,
            maxOf(edge,other),lines.getLineBottom(lastLine)-2*density,density,density,paint)
        canvas.restoreToCount(saved)
        paint.color=oldColor;paint.style=oldStyle
    }
}
