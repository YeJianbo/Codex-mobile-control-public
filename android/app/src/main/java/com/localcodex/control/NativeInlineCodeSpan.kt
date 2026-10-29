package com.localcodex.control

import android.text.TextPaint
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.core.spans.CodeSpan
import androidx.core.graphics.ColorUtils

// Glass themes use a white wash for panels. Inline code needs its own subtle,
// opaque fill so it remains distinct from both the page and blue text selection.
internal fun nativeInlineCodeBackground(ink:Int,surface:Int):Int=
    ColorUtils.setAlphaComponent(ColorUtils.blendARGB(surface,ink,
        if(ColorUtils.calculateLuminance(surface)<.5).09f else .055f),255)

// TextPaint.bgColor is drawn over TextView's selection. Paint this background
// in NativeSelectableTextView before the normal highlight/text pass instead.
internal class NativeInlineCodeSpan(private val theme:MarkwonTheme):CodeSpan(theme) {
    fun backgroundColor(paint:TextPaint)=theme.getCodeBackgroundColor(paint)
    override fun updateDrawState(paint:TextPaint){super.updateDrawState(paint);paint.bgColor=android.graphics.Color.TRANSPARENT}
}
