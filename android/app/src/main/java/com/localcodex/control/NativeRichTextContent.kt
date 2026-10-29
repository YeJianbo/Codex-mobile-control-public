@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class, androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control
import com.localcodex.control.NativeThemeSurface as Surface

import android.widget.TextView
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.text.selection.LocalTextSelectionColors
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.Markwon
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.latex.JLatexMathPlugin
import io.noties.markwon.inlineparser.MarkwonInlineParserPlugin
import kotlinx.coroutines.flow.first

internal val LocalChatMarkwon=staticCompositionLocalOf<Markwon?>{null}
internal val LocalChatMarkdownCache=staticCompositionLocalOf<NativeMarkdownRenderCache?>{null}
@Composable internal fun NativeRichText(vm:NativeViewModel,text:String,event:ChatEvent?=null){
    val open:(String)->Unit={href->vm.openOutput(href,event?.eventId.orEmpty(),event?.threadId?:vm.state.threadId)}
    val cacheOwner=event?.let{row->row.displayKey.ifBlank{row.itemId.ifBlank{row.eventId}}.takeIf{it.isNotBlank()}?.let{row.threadId+"\u0000"+row.type+"\u0000"+it}}
    NativeRichTextContent(text,open,cacheOwner,resolveImage={href->
        runCatching{nativeFileEndpoint(vm.state,href)}.getOrNull()
            ?:event?.takeIf{it.eventId.isNotBlank()&&"local-thread-output-files" in vm.state.capabilities}?.let{nativeThreadOutputEndpoint(it.threadId,it.eventId,href)}
    },image={endpoint,modifier->NativeImageView(vm,endpoint,modifier,adaptive=true)})
}

@Composable internal fun NativeRichTextContent(
    text:String,open:(String)->Unit,cacheOwner:String?=null,resolveImage:(String)->String?,
    image:@Composable (String,Modifier)->Unit,
){
    val matches=remember(text){Regex("!\\[([^]]*)\\]\\((?:<[^>\\n]+>|\\\\.|[^()\\n]|\\([^()\\n]*\\))+\\)").findAll(text).mapNotNull{match->nativeMarkdownImageDestination(match.value)?.let{match to it}}.toList()}
    Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        var start=0
        matches.forEachIndexed{index,(match,destination)->
            if(match.range.first>start)NativeDocument(text.substring(start,match.range.first),open,cacheOwner?.let{"$it/segment:$index"})
            val href=destination
            val endpoint=resolveImage(href)
            if(endpoint!=null)image(endpoint,Modifier.fillMaxWidth())
            else TextButton(onClick={open(destination)}){Text(match.groupValues[1].ifBlank{"打开图片"})}
            start=match.range.last+1
        }
        if(start<text.length)NativeDocument(text.substring(start),open,cacheOwner?.let{"$it/segment:${matches.size}"})
    }
}
@Composable private fun NativeDocument(text:String,open:(String)->Unit,cacheOwner:String?=null){
    val parts=remember(text){nativeDocumentParts(text)}
    val clipboard=LocalClipboardManager.current
    Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
        parts.forEachIndexed{index,part->when(part.kind){
            "code"->Surface(color=NativeWash,shape=Radius.Button,modifier=Modifier.fillMaxWidth()){
                Column{
                    Row(Modifier.padding(start=14.dp,end=4.dp),verticalAlignment=Alignment.CenterVertically){Text(part.language.ifBlank{"代码"},fontSize=12.sp,color=NativeMuted,modifier=Modifier.weight(1f));var copied by remember(part.text){mutableStateOf(false)};IconButton(onClick={clipboard.setText(AnnotatedString(part.text));copied=true}){ModernIcon(if(copied)R.drawable.ic_lucide_check else R.drawable.ic_lucide_copy,"复制代码",Modifier.size(17.dp),NativeMuted)}}
                    SelectionContainer{Text(part.text,fontSize=13.sp,lineHeight=21.sp,fontFamily=FontFamily.Monospace,color=NativeInk,softWrap=false,modifier=Modifier.horizontalScroll(rememberScrollState()).padding(start=14.dp,end=14.dp,bottom=16.dp))}
                }
            }
            "math","table"->NativeWideMarkdown(part.text,part.kind=="table",open,cacheOwner?.let{"$it/part:$index:${part.kind}"})
            else->NativeMarkdown(part.text,open,cacheOwner?.let{"$it/part:$index:${part.kind}"})
        }}
    }
}
@Composable private fun NativeWideMarkdown(text:String,table:Boolean,open:(String)->Unit,cacheOwner:String?=null){
    val selectionColors=LocalTextSelectionColors.current
    val context=LocalContext.current
    val ink=NativeInk.toArgb();val wash=NativeWash.toArgb();val surface=MaterialTheme.colors.surface.toArgb()
    val markwon=LocalChatMarkwon.current?:remember(ink,wash,surface,open){nativeMarkwon(context,open,ink,wash,surface)}
    val markdownCache=LocalChatMarkdownCache.current?:remember(markwon){NativeMarkdownRenderCache(markwon,background={nativeMarkwon(context,open,ink,wash,surface)})}
    if(table){
        val tableScroll=rememberScrollState()
        val thumbColor=NativeMuted.copy(alpha=0.45f)
        val rows=remember(text){nativeTableRows(text)}
        val clipboard=LocalClipboardManager.current
        val tableText=remember(rows){nativeTableTsv(rows)}
        var copyMenu by remember{mutableStateOf(false)}
        var copied by remember(text){mutableStateOf(false)}
        val columns=rows.firstOrNull()?.size?:1
        Column(Modifier.fillMaxWidth()){
            Box(Modifier.align(Alignment.End)){
                IconButton(onClick={copyMenu=true},modifier=Modifier.size(36.dp)){
                    ModernIcon(if(copied)R.drawable.ic_lucide_check else R.drawable.ic_lucide_copy,"复制表格",Modifier.size(17.dp),NativeMuted)
                }
                NativeDropdownMenu(expanded=copyMenu,onDismissRequest={copyMenu=false}){
                    DropdownMenuItem(onClick={clipboard.setText(AnnotatedString(tableText));copied=true;copyMenu=false}){Text("复制表格")}
                    DropdownMenuItem(onClick={clipboard.setText(AnnotatedString(text));copied=true;copyMenu=false}){Text("复制 Markdown")}
                }
            }
            BoxWithConstraints(Modifier.fillMaxWidth()){
                // Three-column tables should wrap in the phone viewport instead of
                // presenting only a horizontal scroller. Wider tables keep scrolling.
                val contentWidth=maxOf(maxWidth,(columns*(if(columns<=3)96 else 132)).dp)
                val cellWidth=contentWidth/columns
                Box(Modifier.testTag("markdownTable").fillMaxWidth().padding(bottom=8.dp).horizontalScroll(tableScroll)){
                    SelectionContainer{
                        Column(Modifier.width(contentWidth).border(1.dp,NativeMuted.copy(alpha=0.25f),Radius.Field).clip(Radius.Field)){
                            rows.forEachIndexed{index,cells->
                                Row(Modifier.fillMaxWidth().background(if(index==0)NativeWash else MaterialTheme.colors.surface)){
                                    repeat(columns){column->
                                        Text(cells.getOrNull(column).orEmpty(),Modifier.width(cellWidth).padding(horizontal=10.dp,vertical=9.dp),
                                            fontSize=14.sp,lineHeight=20.sp,color=NativeInk,fontWeight=if(index==0)FontWeight.SemiBold else FontWeight.Normal)
                                    }
                                }
                                if(index<rows.lastIndex)Divider(color=NativeMuted.copy(alpha=0.22f),thickness=1.dp)
                                }
                    }
                    }
                }
                if(tableScroll.maxValue>0)Canvas(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp)){
                    val fraction=size.width/(size.width+tableScroll.maxValue)
                    val thumb=(size.width*fraction).coerceAtLeast(24.dp.toPx())
                    val x=(size.width-thumb)*tableScroll.value/tableScroll.maxValue
                    drawRoundRect(thumbColor.copy(alpha=0.10f),cornerRadius=androidx.compose.ui.geometry.CornerRadius(size.height,size.height))
                    drawRoundRect(thumbColor,topLeft=Offset(x,0f),size=androidx.compose.ui.geometry.Size(thumb,size.height),cornerRadius=androidx.compose.ui.geometry.CornerRadius(size.height,size.height))
                }
            }
        }
        return
    }
    val prepared by rememberNativeRenderedMarkdown(markdownCache,text,cacheOwner)
    AndroidView(factory={android.widget.HorizontalScrollView(it).apply{
        isFillViewport=true;isHorizontalScrollBarEnabled=true
        addView(NativeSelectableTextView(it).apply{setTextColor(android.graphics.Color.rgb(32,33,36));textSize=16f;setTextIsSelectable(true);setPadding(0,12,0,16)},android.widget.FrameLayout.LayoutParams(-2,-2))
    }},modifier=Modifier.fillMaxWidth().clipToBounds(),onReset={scroll->val view=scroll.getChildAt(0) as TextView;view.text="";view.tag=null;scroll.scrollTo(0,0)},onRelease={scroll->(scroll.getChildAt(0) as TextView).text=""},update={scroll->val view=scroll.getChildAt(0) as NativeSelectableTextView;view.applySelectionColors(selectionColors);view.minWidth=if(table)(520*context.resources.displayMetrics.density).toInt() else 0;view.setTextColor(ink);if(view.tag!=Pair(prepared.source,ink)){markwon.setParsedMarkdown(view,prepared.rendered);view.tag=Pair(prepared.source,ink)};view.movementMethod=android.text.method.ArrowKeyMovementMethod.getInstance()})
}
private class NativeMarkdownLinkHandler(val open:(String)->Unit)
internal fun nativeMarkwon(context:android.content.Context,open:((String)->Unit)?,ink:Int,wash:Int,surface:Int):Markwon=Markwon.builder(context)
    .usePlugin(object:io.noties.markwon.AbstractMarkwonPlugin(){
        override fun configureSpansFactory(builder:io.noties.markwon.MarkwonSpansFactory.Builder){
            builder.setFactory(org.commonmark.node.Code::class.java){configuration,_->NativeInlineCodeSpan(configuration.theme())}
            builder.setFactory(org.commonmark.node.BlockQuote::class.java){_,_->NativeQuoteSpan(
                androidx.core.graphics.ColorUtils.setAlphaComponent(ink,if(androidx.core.graphics.ColorUtils.calculateLuminance(surface)<.5)76 else 46),context.resources.displayMetrics.density)}
        }
        override fun configureConfiguration(builder:io.noties.markwon.MarkwonConfiguration.Builder){if(open!=null)builder.linkResolver { view,link ->
            // Cached spans are shared, but the owning message supplies the event
            // needed to resolve local image/file links outside listed projects.
            val handler=view.getTag(R.id.markdown_link_handler) as? NativeMarkdownLinkHandler
            if(handler!=null)handler.open(link) else open?.invoke(link)
        }}
        override fun configureTheme(builder:io.noties.markwon.core.MarkwonTheme.Builder){builder.headingBreakHeight(0).headingTextSizeMultipliers(floatArrayOf(1.5f,1.25f,1.12f,1.05f,1f,1f)).linkColor(android.graphics.Color.rgb(45,96,156)).codeBackgroundColor(nativeInlineCodeBackground(ink,surface))}
    })
    .usePlugin(TablePlugin.create{it.tableBorderColor(android.graphics.Color.rgb(224,227,230)).tableBorderWidth(1).tableCellPadding((10*context.resources.displayMetrics.density).toInt()).tableHeaderRowBackgroundColor(wash).tableEvenRowBackgroundColor(surface).tableOddRowBackgroundColor(surface)})
    .usePlugin(MarkwonInlineParserPlugin.create())
    .usePlugin(JLatexMathPlugin.create(16f*context.resources.displayMetrics.scaledDensity){it.inlinesEnabled(true);it.executorService(nativeMathExecutor);it.theme().textColor(ink)}).build()
@Composable internal fun NativeMarkdown(text:String,open:((String)->Unit)?=null,cacheOwner:String?=null){
    val selectionColors=LocalTextSelectionColors.current
    val context=LocalContext.current
    val ink=NativeInk.toArgb();val wash=NativeWash.toArgb();val surface=MaterialTheme.colors.surface.toArgb()
    val markwon=LocalChatMarkwon.current?:remember(ink,wash,surface,open){nativeMarkwon(context,open,ink,wash,surface)}
    val markdownCache=LocalChatMarkdownCache.current?:remember(markwon){NativeMarkdownRenderCache(markwon,background={nativeMarkwon(context,open,ink,wash,surface)})}
    val prepared by rememberNativeRenderedMarkdown(markdownCache,text,cacheOwner)
    val selectAcross by rememberUpdatedState(LocalNativeTextSelection.current)
    AndroidView(factory={NativeSelectableTextView(it).apply{setTextColor(android.graphics.Color.rgb(36,36,36));textSize=16f;setLineSpacing(2f,1.12f);setTextIsSelectable(true)}},modifier=Modifier.fillMaxWidth().clipToBounds(),onReset={it.text="";it.tag=null},onRelease={it.text=""},update={it.applySelectionColors(selectionColors);it.setTextColor(ink);if(it.tag!=Pair(prepared.source,ink)){
        // Hidden trailing HTML can leave paragraph breaks in Markwon's output.
        // Trim the rendered tail, preserving spans and all spacing inside the answer.
        val rendered=prepared.rendered
        val end=rendered.indexOfLast{char->!char.isWhitespace()}+1
        markwon.setParsedMarkdown(it,android.text.SpannableStringBuilder(rendered,0,end))
        it.tag=Pair(prepared.source,ink)
    };it.setTag(R.id.markdown_link_handler,open?.let(::NativeMarkdownLinkHandler));val selectionView=it;it.customSelectionActionModeCallback=if(selectAcross==null)null else object:android.view.ActionMode.Callback{
        private val fullScreenId=android.view.View.generateViewId()
        override fun onCreateActionMode(mode:android.view.ActionMode,menu:android.view.Menu):Boolean{
            menu.add(0,fullScreenId,10,"整屏选文").setShowAsAction(android.view.MenuItem.SHOW_AS_ACTION_IF_ROOM)
            return true
        }
        override fun onPrepareActionMode(mode:android.view.ActionMode,menu:android.view.Menu):Boolean{
            return false
        }
        override fun onActionItemClicked(mode:android.view.ActionMode,item:android.view.MenuItem):Boolean{
            if(item.itemId!=fullScreenId)return false
            val start=minOf(selectionView.selectionStart,selectionView.selectionEnd).coerceAtLeast(0)
            val end=maxOf(selectionView.selectionStart,selectionView.selectionEnd).coerceIn(start,selectionView.text.length)
            selectAcross?.invoke(selectionView.text.subSequence(start,end).toString().ifBlank{text});mode.finish();return true
        }
        override fun onDestroyActionMode(mode:android.view.ActionMode){}
    };it.movementMethod=android.text.method.ArrowKeyMovementMethod.getInstance()})
}
@Composable internal fun NativeMarkdownReaderContent(
    document:NativeReadableFile,open:(String)->Unit,resolveImage:(String)->String?,
    image:@Composable (String,Modifier)->Unit,
    modifier:Modifier=Modifier,listState:LazyListState=rememberLazyListState(),topInset:Dp=0.dp,
){
    val selectionColors=LocalTextSelectionColors.current
    val context=LocalContext.current
    val ink=NativeInk.toArgb();val wash=NativeWash.toArgb();val surface=MaterialTheme.colors.surface.toArgb()
    // Reader links have the document's base directory, independently of chat link handlers.
    val markwon=remember(context,ink,wash,surface,open){nativeMarkwon(context,open,ink,wash,surface)}
    val parts=remember(markwon,document.content){nativeReaderParts(markwon,document.content)}
    LazyColumn(modifier,state=listState,contentPadding=PaddingValues(start=20.dp,end=20.dp,top=18.dp+topInset,bottom=18.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        items(parts,contentType={if(it.code!=null)"code" else if(it.rendered!=null)"text" else "image"}){part->
            when{
                part.code!=null->{
                    val fence="`".repeat(maxOf(3,(Regex("`+").findAll(part.code).maxOfOrNull{it.value.length}?:0)+1))
                    NativeDocument("$fence${part.language}\n${part.code}\n$fence",open)
                }
                part.rendered!=null->AndroidView(factory={NativeSelectableTextView(it).apply{textSize=16f;setLineSpacing(2f,1.12f)}},modifier=Modifier.fillMaxWidth().clipToBounds(),
                    onReset={it.text="";it.tag=null},onRelease={it.text=""},update={view->
                        view.applySelectionColors(selectionColors)
                        view.setTextColor(ink)
                        if(view.tag!==part){
                            val end=part.rendered.indexOfLast{!it.isWhitespace()}+1
                            markwon.setParsedMarkdown(view,android.text.SpannableStringBuilder(part.rendered,0,end));view.tag=part
                        }
                        view.movementMethod=android.text.method.ArrowKeyMovementMethod.getInstance()
                    })
                part.image.isNotBlank()->{
                    val target=nativeMarkdownTarget(document.sourcePath,part.image)
                    val endpoint=resolveImage(target)
                    if(endpoint!=null)image(endpoint,Modifier.fillMaxWidth())
                    else TextButton(onClick={open(part.image)}){Text(part.label.ifBlank{"打开图片"})}
                }
            }
        }
    }
}
@Composable internal fun NativeDocumentPreview(vm:NativeViewModel,document:NativeReadableFile,close:()->Unit,overlay:(@Composable ()->Unit)?=null){
    val context=LocalContext.current
    val save=rememberNativeSaveAction{
        nativeSavePublicFile(context,document.name,document.mime){output->
            if(document.originalPath.isNotEmpty())java.io.File(document.originalPath).inputStream().use{it.copyTo(output)}
            else output.write(document.encoding.encode(document.content,document.hasBom))
        }
        "已保存到下载/Codex"
    }
    val open:(String)->Unit=remember(vm,document){ {href->
        if(!href.startsWith("#"))vm.openOutput(nativeMarkdownTarget(document.sourcePath,href),document.eventId,document.threadId.ifBlank{vm.state.threadId})
    } }
    NativeDocumentPreviewContent(document,save.saving,save.save,close,overlay=overlay,reader={modifier,listState,topInset->
        NativeMarkdownReaderContent(document,open,resolveImage={target->
            runCatching{nativeFileEndpoint(vm.state,target)}.getOrNull()
                ?:document.takeIf{it.eventId.isNotBlank()&&it.threadId.isNotBlank()&&"local-thread-output-files" in vm.state.capabilities}?.let{nativeThreadOutputEndpoint(it.threadId,it.eventId,target,it.sourcePath)}
        },image={endpoint,imageModifier->NativeImageView(vm,endpoint,imageModifier,adaptive=true)},modifier=modifier,listState=listState,topInset=topInset)
    },open=open,feedback={
        val feedback=vm.state
        if(feedback.fileFeedbackVisible)NativeFileFeedback(feedback.fileBusy,feedback.fileMessage,feedback.fileError,
            vm::retryFile,vm::hideFileFeedback,Modifier.padding(12.dp).navigationBarsPadding(),kind=NativeGlassKind.INSET)
    })
}

@Composable internal fun NativeDocumentPreviewContent(
    document:NativeReadableFile,saving:Boolean,onSave:()->Unit,close:()->Unit,
    reader:@Composable (Modifier,LazyListState,Dp)->Unit,feedback:@Composable ()->Unit={},overlay:(@Composable ()->Unit)?=null,
    open:(String)->Unit={},
){
    val markdown=nativeIsMarkdownFile(document.name,document.mime)
    val rich=markdown||document.pages.isNotEmpty()
    var source by remember(document.sourcePath){mutableStateOf(false)}
    var section by remember(document.sourcePath){mutableIntStateOf(0)}
    val readingPosition=key(document.sourcePath){rememberLazyListState()}
    val sourcePosition=key(document.sourcePath){rememberScrollState()}
    NativeReaderDialog(close=close,overlay=overlay,header={
        Column{
            NativeReaderToolbar(document.name,"关闭阅读器",close){
                if(markdown||document.pages.isNotEmpty()&&document.originalPath.isNotEmpty()&&!nativeIsOfficeFile(document.name))ChromeButton(
                    if(source)R.drawable.ic_lucide_file_text else R.drawable.ic_lucide_terminal,
                    if(source)"阅读文档" else if(markdown)"查看源码" else "查看原文",{source=!source},emphasized=source)
                ChromeButton(R.drawable.ic_lucide_arrow_down_to_line,if(saving)"正在保存文档" else "保存文档",onSave,enabled=!saving)
            }
            if(!source&&document.pages.size>1)LazyRow(Modifier.fillMaxWidth().padding(bottom=8.dp),contentPadding=PaddingValues(horizontal=16.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                itemsIndexed(document.pages){index,page->NativeLiquidSurface(
                    modifier=Modifier.height(40.dp).widthIn(min=48.dp,max=220.dp).clip(Radius.Chip).clickable{section=index},
                    shape=Radius.Chip,color=if(section==index)NativeWash else MaterialTheme.colors.surface,
                ){
                    Box(Modifier.padding(horizontal=14.dp),contentAlignment=Alignment.Center){Text(page.name,maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=13.sp,color=NativeInk)}
                }}
            }
        }
    }){topInset->
        if(source||!rich||document.pages.isEmpty())NativeBackdropScrollMotion{
            if(source||!rich)sourcePosition.value else 31*readingPosition.firstVisibleItemIndex+readingPosition.firstVisibleItemScrollOffset
        }
        Column(Modifier.fillMaxSize()){
            if(source||!rich)Column(Modifier.fillMaxWidth().weight(1f).verticalScroll(sourcePosition).padding(start=20.dp,end=20.dp,top=18.dp+topInset,bottom=18.dp)){
                val prose=document.name.endsWith(".txt",true)
                SelectionContainer{Text(document.content,fontFamily=if(prose)FontFamily.Default else FontFamily.Monospace,fontSize=if(prose)16.sp else 13.sp,lineHeight=if(prose)26.sp else 20.sp)}
            }else if(document.pages.isNotEmpty())NativeDocumentWebContent(document.pages[section.coerceAtMost(document.pages.lastIndex)],topInset,open,Modifier.fillMaxWidth().weight(1f))
            else reader(Modifier.fillMaxWidth().weight(1f),readingPosition,topInset)
            feedback()
        }
    }
}
