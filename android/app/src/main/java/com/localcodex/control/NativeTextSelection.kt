package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

internal val LocalNativeTextSelection=staticCompositionLocalOf<((String)->Unit)?>{null}
private val selectionParser=org.commonmark.parser.Parser.builder().build()
private val selectionRenderer=org.commonmark.renderer.text.TextContentRenderer.builder().build()
internal fun nativeSelectablePlainText(source:String):String{
    val document=selectionParser.parse(source)
    document.accept(object:org.commonmark.node.AbstractVisitor(){
        override fun visit(node:org.commonmark.node.Code){node.insertBefore(org.commonmark.node.Text(node.literal));node.unlink()}
    })
    val blocks=mutableListOf<String>()
    var block=document.firstChild
    while(block!=null){
        blocks.add(selectionRenderer.render(block).trimEnd())
        block=block.next
    }
    return blocks.joinToString("\n\n")
}

/** Keep Android's selectable-text movement; open links only on short taps. */
internal class NativeSelectableTextView(context:android.content.Context):android.widget.TextView(context){
    private var downX=0f;private var downY=0f;private var downAt=0L;private var selecting=false
    private var selectionPalette:TextSelectionColors?=null
    private data class CodeBackground(val path:android.graphics.Path,val color:Int)
    private var backgroundLayout:android.text.Layout?=null
    private var backgroundText:CharSequence?=null
    private var codeBackgrounds:List<CodeBackground> = emptyList()
    private val codePaint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply{
        pathEffect=android.graphics.CornerPathEffect(4f*resources.displayMetrics.density)
    }
    private val selectionPaint=android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply{
        pathEffect=android.graphics.CornerPathEffect(2f*resources.displayMetrics.density)
    }
    private val selectionPath=android.graphics.Path()
    private var selectionLayout:android.text.Layout?=null
    private var selectionText:CharSequence?=null
    private var selectionFrom=-1
    private var selectionUntil=-1
    // Android 12's hasSelection() excludes a reverse range ending at offset 0.
    private val hasTextSelection get()=selectionStart>=0&&selectionEnd>=0&&selectionStart!=selectionEnd
    init{setTextIsSelectable(true);linksClickable=false}
    override fun onTextChanged(text:CharSequence?,start:Int,lengthBefore:Int,lengthAfter:Int){
        super.onTextChanged(text,start,lengthBefore,lengthAfter)
        backgroundLayout=null;backgroundText=null;codeBackgrounds=emptyList()
        selectionLayout=null
    }
    override fun onSizeChanged(width:Int,height:Int,oldWidth:Int,oldHeight:Int){
        super.onSizeChanged(width,height,oldWidth,oldHeight);backgroundLayout=null;selectionLayout=null
    }
    override fun onDraw(canvas:android.graphics.Canvas){
        val textLayout=layout
        val styled=text as? android.text.Spanned
        if(backgroundLayout!==textLayout||backgroundText!==text){
            backgroundLayout=textLayout;backgroundText=text
            codeBackgrounds=if(textLayout==null||styled==null)emptyList() else
                styled.getSpans(0,styled.length,NativeInlineCodeSpan::class.java).map{span->
                    val path=android.graphics.Path()
                    textLayout.getSelectionPath(styled.getSpanStart(span),styled.getSpanEnd(span),path)
                    CodeBackground(path,span.backgroundColor(paint))
                }
        }
        val selected=selectionPalette!=null&&hasTextSelection&&(isFocused||isPressed)&&textLayout!=null
        if(selected&&(selectionLayout!==textLayout||selectionText!==text||selectionFrom!=selectionStart||selectionUntil!=selectionEnd)){
            selectionLayout=textLayout;selectionText=text;selectionFrom=selectionStart;selectionUntil=selectionEnd
            selectionPath.rewind()
            val begin=minOf(selectionStart,selectionEnd);val end=maxOf(selectionStart,selectionEnd)
            val linePath=android.graphics.Path()
            val lineBounds=android.graphics.Path()
            for(line in textLayout!!.getLineForOffset(begin)..textLayout.getLineForOffset(end)){
                val from=maxOf(begin,textLayout.getLineStart(line))
                val until=minOf(end,textLayout.getLineVisibleEnd(line))
                if(until>from){
                    textLayout.getSelectionPath(from,until,linePath)
                    // A soft-wrap endpoint belongs to the next line. Layout's
                    // path can therefore include trailing fill and zero-width
                    // contours there. Clip to this line, preserving bidi runs,
                    // then union before rounding so shared edges have no dents.
                    lineBounds.rewind()
                    lineBounds.addRect(textLayout.getLineLeft(line),textLayout.getLineTop(line).toFloat(),
                        textLayout.getLineRight(line),textLayout.getLineBottom(line).toFloat(),android.graphics.Path.Direction.CW)
                    linePath.op(lineBounds,android.graphics.Path.Op.INTERSECT)
                    selectionPath.op(linePath,android.graphics.Path.Op.UNION)
                }
            }
        }
        if(codeBackgrounds.isNotEmpty()||selected){
            val saved=canvas.save()
            canvas.clipRect(scrollX+totalPaddingLeft,scrollY+totalPaddingTop,scrollX+width-totalPaddingRight,scrollY+height-totalPaddingBottom)
            canvas.translate(totalPaddingLeft.toFloat(),totalPaddingTop.toFloat())
            for(background in codeBackgrounds){codePaint.color=background.color;canvas.drawPath(background.path,codePaint)}
            if(selected)canvas.drawPath(selectionPath,selectionPaint)
            canvas.restoreToCount(saved)
        }
        // A recycled AndroidView can receive a longer layout before its lazy
        // row is remeasured. Keep the native display list inside its own bounds.
        val textSave=canvas.save()
        canvas.clipRect(scrollX,scrollY,scrollX+width,scrollY+height)
        super.onDraw(canvas)
        canvas.restoreToCount(textSave)
    }
    fun applySelectionColors(colors:TextSelectionColors){
        if(selectionPalette==colors)return
        selectionPalette=colors
        selectionPaint.color=colors.backgroundColor.toArgb()
        // Keep Android's handles, selection range and actions. Only replace
        // its full-paragraph background with the shaped, cached text selection.
        highlightColor=android.graphics.Color.TRANSPARENT
        if(android.os.Build.VERSION.SDK_INT>=29){
            textSelectHandleLeft?.mutate()?.let{it.setTint(colors.handleColor.toArgb());setTextSelectHandleLeft(it)}
            textSelectHandleRight?.mutate()?.let{it.setTint(colors.handleColor.toArgb());setTextSelectHandleRight(it)}
            textSelectHandle?.mutate()?.let{it.setTint(colors.handleColor.toArgb());setTextSelectHandle(it)}
            textCursorDrawable?.mutate()?.let{it.setTint(colors.handleColor.toArgb());setTextCursorDrawable(it)}
        }
    }
    override fun onTouchEvent(event:android.view.MotionEvent):Boolean{
        if(event.actionMasked==android.view.MotionEvent.ACTION_DOWN){downX=event.x;downY=event.y;downAt=event.eventTime;selecting=hasTextSelection}
        val slop=android.view.ViewConfiguration.get(context).scaledTouchSlop
        val tap=event.actionMasked==android.view.MotionEvent.ACTION_UP&&!selecting&&event.eventTime-downAt<android.view.ViewConfiguration.getLongPressTimeout()&&kotlin.math.abs(event.x-downX)<slop&&kotlin.math.abs(event.y-downY)<slop
        val span=if(tap){
            val textLayout=layout
            val x=event.x-totalPaddingLeft+scrollX;val y=event.y-totalPaddingTop+scrollY
            if(textLayout!=null&&y>=0&&y<textLayout.height){
                val line=textLayout.getLineForVertical(y.toInt())
                if(x>=textLayout.getLineLeft(line)&&x<=textLayout.getLineRight(line)){
                    val offset=textLayout.getOffsetForHorizontal(line,x)
                    (text as? android.text.Spanned)?.getSpans(offset,offset,android.text.style.ClickableSpan::class.java)?.firstOrNull()
                }else null
            }else null
        }else null
        val handled=super.onTouchEvent(event)
        if(span!=null){span.onClick(this);return true}
        return handled
    }
}

internal data class NativeReplySelection(val document:String,val blockText:String,val blockStart:Int)
internal fun nativeReplySelection(blocks:List<NativeBlock>,key:String):NativeReplySelection?{
    // Completed turns keep commentary inside the process disclosure, before the conclusion.
    val replies=buildList<NativeBlock>{
        fun collect(nodes:List<NativeBlock>){
            for(block in nodes){
                if(block.event.type=="message.delta"&&block.replyScope.isNotBlank())add(block)
                if(block.children.isNotEmpty())collect(block.children)
            }
        }
        collect(blocks)
    }
    val target=replies.firstOrNull{it.key==key}?:return null
    val round=replies.filter{it.replyScope==target.replyScope}
        .map{it.key to nativeAnswerText(it.event.text)}.filter{it.second.isNotBlank()}
    val index=round.indexOfFirst{it.first==key};if(index<0)return null
    return NativeReplySelection(round.joinToString("\n\n"){it.second},round[index].second,round.take(index).sumOf{it.second.length+2})
}

internal data class NativePreparedTextSelection(val plain:String,val selection:TextRange)
internal suspend fun prepareNativeTextSelection(document:String,anchor:String,anchorStart:Int?):NativePreparedTextSelection=withContext(Dispatchers.Default){
    val plain=nativeSelectablePlainText(document)
    val selected=if(plain.contains(anchor))anchor else nativeSelectablePlainText(anchor).trim()
    val prefix=anchorStart?.let{nativeSelectablePlainText(document.take(it)).length}?:0
    val start=plain.indexOf(selected,(prefix-2).coerceAtLeast(0)).takeIf{it>=0}?:plain.indexOf(selected).coerceAtLeast(0)
    NativePreparedTextSelection(plain,TextRange(start,(start+selected.length).coerceAtMost(plain.length)))
}

/** Selection endpoints stay inside one assistant reply, including its body segments. */
@Composable internal fun NativeTextSelection(document:String,anchor:String,anchorStart:Int?=null,close:()->Unit){
    val preparation=remember(document,anchor,anchorStart){mutableStateOf<NativePreparedTextSelection?>(null)}
    LaunchedEffect(document,anchor,anchorStart){
        preparation.value=prepareNativeTextSelection(document,anchor,anchorStart)
    }
    val prepared=preparation.value
    val plain=prepared?.plain.orEmpty()
    val start=prepared?.selection?.start?:0
    var value by remember(prepared){mutableStateOf(TextFieldValue(plain,prepared?.selection?:TextRange.Zero))}
    val scroll=rememberScrollState();val focus=remember{FocusRequester()}
    var selectionTop by remember(prepared){mutableStateOf<Float?>(null)}
    val clipboard=LocalClipboardManager.current
    NativeReaderDialog(close=close,header={
        NativeReaderToolbar("本轮回复","关闭",close){
            ChromeControl({value=value.copy(selection=TextRange(0,plain.length))},emphasized=false,enabled=prepared!=null){Text("全选",fontSize=13.sp,color=NativeInk)}
            ChromeButton(R.drawable.ic_lucide_copy,"复制所选",{clipboard.setText(AnnotatedString(plain.substring(value.selection.min,value.selection.max)))},enabled=!value.selection.collapsed)
        }
    }){topInset->
        LaunchedEffect(prepared,selectionTop){if(prepared!=null)selectionTop?.let{focus.requestFocus();scroll.scrollTo((it-scroll.viewportSize/3).toInt().coerceAtLeast(0))}}
        Column(Modifier.fillMaxSize().padding(top=topInset)){
            if(prepared==null)Box(Modifier.weight(1f).fillMaxWidth().testTag("replySelectionLoading"),contentAlignment=Alignment.Center){
                NativeRunningTitle("正在整理文本…",rememberNativeRunningPulse(true))
            }else BasicTextField(value=value,onValueChange={value=it},readOnly=true,
                textStyle=TextStyle(color=MaterialTheme.colors.onBackground,fontSize=16.sp,lineHeight=25.sp),
                onTextLayout={if(selectionTop==null)selectionTop=it.getCursorRect(start).top},
                modifier=Modifier.weight(1f).fillMaxWidth().verticalScroll(scroll).padding(horizontal=20.dp,vertical=12.dp).focusRequester(focus).testTag("replySelectionText"))
        }
    }
}
