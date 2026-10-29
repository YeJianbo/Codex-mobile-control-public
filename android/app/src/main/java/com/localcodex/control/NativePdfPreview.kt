package com.localcodex.control

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.calculateCentroid
import androidx.compose.foundation.gestures.calculatePan
import androidx.compose.foundation.gestures.calculateZoom
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.positionChanged
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import java.io.File
import kotlin.math.roundToInt

@Composable fun NativePdfPreview(pdf:NativePdf,close:()->Unit,overlay:(@Composable ()->Unit)?=null) {
    val context=LocalContext.current
    val density=LocalDensity.current
    val list=rememberLazyListState()
    val currentPage by remember(list){derivedStateOf{
        val layout=list.layoutInfo
        layout.visibleItemsInfo.maxByOrNull{item->
            (minOf(item.offset+item.size,layout.viewportEndOffset)-maxOf(item.offset,layout.viewportStartOffset)).coerceAtLeast(0)
        }?.index?.plus(1)?:1
    }}
    var zoom by remember(pdf.path){mutableFloatStateOf(1f)}
    var panX by remember(pdf.path){mutableFloatStateOf(0f)}
    var touching by remember(pdf.path){mutableStateOf(false)}
    var regions by remember(pdf.path){mutableStateOf<Map<Int,NativePdfRegion>>(emptyMap())}
    var document by remember(pdf.path){mutableStateOf<NativePdfPages?>(null)}
    var failure by remember(pdf.path){mutableStateOf("")}
    val save=rememberNativeSaveAction{
        nativeSavePublicFile(context,pdf.name,"application/pdf"){output->File(pdf.path).inputStream().use{it.copyTo(output)}}
        "已保存到下载/Codex"
    }
    LaunchedEffect(pdf.path){
        var opened:NativePdfPages?=null
        try {
            withContext(Dispatchers.IO){
                val loadingContext=currentCoroutineContext()
                opened=NativePdfPages(File(pdf.path)){loadingContext.ensureActive()}
            }
            document=opened
            awaitCancellation()
        }catch(error:Exception){
            if(error is kotlinx.coroutines.CancellationException)throw error
            failure=error.message?:"无法预览 PDF"
        }finally{
            document=null
            opened?.let{withContext(NonCancellable){it.dispose()}}
        }
    }
    NativeReaderDialog(close=close,overlay=overlay,header={
        NativeReaderToolbar(pdf.name,"关闭 PDF 预览",close,subtitle=document?.let{"$currentPage / ${it.ratios.size}"}.orEmpty()){
            ChromeButton(R.drawable.ic_lucide_arrow_down_to_line,"保存 PDF",save.save,enabled=!save.saving)
        }
    }){topInset->
            NativeBackdropScrollMotion{31*list.firstVisibleItemIndex+list.firstVisibleItemScrollOffset}
            BoxWithConstraints(Modifier.fillMaxSize()){
                val viewportWidth=maxWidth
                val viewportHeight=maxHeight
                val widthPx=with(density){viewportWidth.toPx()}
                val pages=document
                LaunchedEffect(pages,widthPx,density.density){
                    if(pages==null)return@LaunchedEffect
                    snapshotFlow{
                        if(touching||list.isScrollInProgress)null else {
                            val info=list.layoutInfo
                            info.visibleItemsInfo.mapNotNull{item->nativePdfVisibleRegion(
                                widthPx-20f*density.density,pages.ratios[item.index],zoom,panX,10f*density.density,
                                widthPx,item.offset,info.viewportStartOffset,info.viewportEndOffset)?.let{item.index to it}}.toMap()
                        }
                    }.collectLatest{request->
                        if(request!=null){delay(100);regions=request}
                    }
                }
                when {
                    failure.isNotEmpty()->Text(failure,Modifier.align(Alignment.Center).padding(24.dp))
                    pages==null->CircularProgressIndicator(Modifier.align(Alignment.Center))
                    else->Box(Modifier.fillMaxSize().clipToBounds().testTag("pdfGestureSurface")
                        .semantics{stateDescription="缩放 ${(zoom*100).roundToInt()}%"}
                        .pointerInput(pdf.path,widthPx){
                            awaitEachGesture{
                                awaitFirstDown(requireUnconsumed=false,pass=PointerEventPass.Initial)
                                touching=true
                                var transforming=false
                                var totalPan=Offset.Zero
                                try{
                                do{
                                    // Claim transforms before the list scrolls. At 1x a single
                                    // finger still belongs to LazyColumn, including its fling.
                                    val event=awaitPointerEvent(PointerEventPass.Initial)
                                    val movement=event.calculatePan()
                                    totalPan+=movement
                                    if(event.changes.count{it.pressed}>1 ||
                                        (zoom>1f&&totalPan.getDistance()>viewConfiguration.touchSlop))transforming=true
                                    if(transforming){
                                        val previousZoom=zoom
                                        val nextZoom=(previousZoom*event.calculateZoom()).coerceIn(1f,4f)
                                        val centroid=event.calculateCentroid(useCurrent=false)
                                        if(centroid!=Offset.Unspecified){
                                            // Keep the document point under the pinch centroid
                                            // stationary while using unscaled list coordinates.
                                            panX=(centroid.x-(centroid.x-panX)*(nextZoom/previousZoom)+movement.x)
                                                .coerceIn(widthPx*(1f-nextZoom),0f)
                                            list.dispatchRawDelta(centroid.y/previousZoom-centroid.y/nextZoom-movement.y/nextZoom)
                                        }
                                        zoom=nextZoom
                                        event.changes.forEach{if(it.positionChanged())it.consume()}
                                    }
                                }while(event.changes.any{it.pressed})
                                // Refine visible pages after release, rather than rerendering
                                // bitmaps on every pinch frame.
                                }finally{touching=false}
                            }
                        }){
                        LazyColumn(state=list,userScrollEnabled=zoom<=1f,
                            modifier=Modifier.width(viewportWidth).height(viewportHeight/zoom)
                                .graphicsLayer{
                                    transformOrigin=TransformOrigin(0f,0f)
                                    scaleX=zoom;scaleY=zoom
                                    translationX=panX.coerceIn(widthPx*(1f-zoom),0f)
                                }.testTag("pdfPages"),
                            contentPadding=PaddingValues(start=10.dp,end=10.dp,top=10.dp+topInset/zoom,bottom=10.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                            items(pages.ratios.size,key={it}){index->
                                PdfPageImage(pages,index,widthPx-20f*density.density,pages.ratios[index])
                            }
                        }
                        regions.forEach{(index,region)->key(pages,index){
                            PdfPageDetail(pages,index,region,widthPx-20f*density.density,10f*density.density,
                                list,{zoom},{panX},Modifier.align(Alignment.TopStart))
                        }}
                    }
                }
            }
    }
}

@Composable private fun PdfPageImage(document:NativePdfPages,index:Int,widthPx:Float,ratio:Float){
    var bitmap by remember(document,index){mutableStateOf<Bitmap?>(null)}
    var failure by remember(document,index,widthPx){mutableStateOf(false)}
    LaunchedEffect(document,index,widthPx){
        var rendered:Bitmap?=null
        try{
            withContext(Dispatchers.IO){rendered=document.render(index,widthPx.toInt())}
            bitmap=rendered
            rendered=null
        }catch(error:Exception){
            if(error is kotlinx.coroutines.CancellationException)throw error
            failure=true
        }finally{rendered?.recycle()}
    }
    Box(Modifier.fillMaxWidth().aspectRatio(1f/ratio).background(Color.White),contentAlignment=Alignment.Center){
        when {
            bitmap!=null->Image(bitmap!!.asImageBitmap(),"PDF 第 ${index+1} 页",Modifier.fillMaxSize(),contentScale=ContentScale.FillBounds)
            failure->Text("第 ${index+1} 页无法显示",color=Color.DarkGray)
            else->CircularProgressIndicator(Modifier.size(22.dp),strokeWidth=2.dp)
        }
    }
}

/** Detail lives in the physical viewport, outside the scaled scrolling layer. */
@Composable private fun PdfPageDetail(document:NativePdfPages,index:Int,region:NativePdfRegion,widthPx:Float,padding:Float,
    list:LazyListState,zoom:()->Float,panX:()->Float,modifier:Modifier=Modifier){
    val density=LocalDensity.current
    var detail by remember(document,index){mutableStateOf<Pair<NativePdfRegion,Bitmap>?>(null)}
    var failed by remember(document,index){mutableStateOf(false)}
    var retry by remember(document,index){mutableIntStateOf(0)}
    LaunchedEffect(document,index,region,retry){
        var rendered:Bitmap?=null
        failed=false
        try{
            withContext(Dispatchers.IO){rendered=document.renderRegion(index,region)}
            detail=region to checkNotNull(rendered);rendered=null
        }catch(error:Exception){
            if(error is kotlinx.coroutines.CancellationException)throw error
            failed=true
        }finally{rendered?.recycle()}
    }
    detail?.let{(crop,image)->
        Image(image.asImageBitmap(),null,modifier.requiredSize((image.width/density.density).dp,(image.height/density.density).dp)
            .graphicsLayer{
                val info=list.layoutInfo
                val item=info.visibleItemsInfo.firstOrNull{it.index==index}
                alpha=if(item==null)0f else 1f
                val currentZoom=zoom()
                val rasterScale=crop.pageWidth/widthPx
                val displayScale=currentZoom/rasterScale
                transformOrigin=TransformOrigin(0f,0f)
                scaleX=displayScale;scaleY=displayScale
                translationX=panX()+padding*currentZoom+crop.left*displayScale
                translationY=((item?.offset?:0)-info.viewportStartOffset)*currentZoom+crop.top*displayScale
            }.testTag("pdfDetail-$index-${crop.pageWidth}-${crop.left}-${crop.top}"),contentScale=ContentScale.FillBounds)
    }
    if(failed)TextButton(onClick={retry++},modifier=modifier){Text("重新加载页面")}
}
