package com.localcodex.control

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File

private class PdfPages(file:File,checkActive:()->Unit) {
    private val descriptor=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer=try{PdfRenderer(descriptor)}catch(error:Throwable){descriptor.close();throw error}
    private val renderLock=Mutex()
    val ratios:List<Float> = try{
        require(renderer.pageCount>0){"PDF 没有页面"}
        List(renderer.pageCount){index->
            checkActive()
            renderer.openPage(index).use{page->
                require(page.width>0&&page.height>0){"PDF 页面尺寸无效"}
                page.height.toFloat()/page.width
            }
        }
    }catch(error:Throwable){renderer.close();descriptor.close();throw error}

    // The caller owns the bitmap inside its IO block, including a cancelled delivery.
    suspend fun render(index:Int,targetWidth:Int):Bitmap=renderLock.withLock{
        renderer.openPage(index).use{page->
            val scale=minOf(targetWidth.coerceIn(320,1800).toDouble()/page.width,
                3600.0/page.height,kotlin.math.sqrt(2.0*1024*1024/(page.width.toDouble()*page.height)))
            val width=(page.width*scale).toInt().coerceAtLeast(1)
            val height=(page.height*scale).toInt().coerceAtLeast(1)
            val bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888)
            try{
                bitmap.eraseColor(AndroidColor.WHITE)
                page.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                bitmap
            }catch(error:Throwable){bitmap.recycle();throw error}
        }
    }

    suspend fun dispose()=withContext(Dispatchers.IO){renderLock.withLock{try{renderer.close()}finally{descriptor.close()}}}
}

@Composable fun NativePdfPreview(pdf:NativePdf,close:()->Unit) {
    val context=LocalContext.current
    val density=LocalDensity.current
    val screenWidth=with(density){LocalConfiguration.current.screenWidthDp.dp.toPx()}
    val list=rememberLazyListState()
    val currentPage by remember(list){derivedStateOf{
        val layout=list.layoutInfo
        layout.visibleItemsInfo.maxByOrNull{item->
            (minOf(item.offset+item.size,layout.viewportEndOffset)-maxOf(item.offset,layout.viewportStartOffset)).coerceAtLeast(0)
        }?.index?.plus(1)?:1
    }}
    val horizontal=rememberScrollState()
    var zoom by remember(pdf.path){mutableFloatStateOf(1f)}
    var document by remember(pdf.path){mutableStateOf<PdfPages?>(null)}
    var failure by remember(pdf.path){mutableStateOf("")}
    val save=rememberNativeSaveAction{
        nativeSavePublicFile(context,pdf.name,"application/pdf"){output->File(pdf.path).inputStream().use{it.copyTo(output)}}
        "已保存到下载/Codex"
    }
    LaunchedEffect(pdf.path){
        var opened:PdfPages?=null
        try {
            withContext(Dispatchers.IO){
                val loadingContext=currentCoroutineContext()
                opened=PdfPages(File(pdf.path)){loadingContext.ensureActive()}
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
    Dialog(onDismissRequest=close,properties=DialogProperties(usePlatformDefaultWidth=false)){
        NativeDialogSystemBars()
        Column(Modifier.fillMaxSize().background(MaterialTheme.colors.background)){
            Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal=8.dp),verticalAlignment=Alignment.CenterVertically){
                IconButton(onClick=close){Icon(painterResource(R.drawable.ic_lucide_arrow_left),"关闭 PDF 预览")}
                Text(pdf.name,Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=16.sp)
                document?.let{Text("$currentPage / ${it.ratios.size}",fontSize=13.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))}
                IconButton(onClick={zoom=(zoom-.25f).coerceAtLeast(1f)},enabled=zoom>1f){Icon(painterResource(R.drawable.ic_lucide_zoom_out),"缩小 PDF")}
                IconButton(onClick={zoom=(zoom+.25f).coerceAtMost(2.5f)},enabled=zoom<2.5f){Icon(painterResource(R.drawable.ic_lucide_zoom_in),"放大 PDF")}
                IconButton(onClick=save.save,enabled=!save.saving){Icon(painterResource(R.drawable.ic_lucide_arrow_down_to_line),"保存 PDF")}
            }
            BoxWithConstraints(Modifier.weight(1f).fillMaxWidth().background(if(MaterialTheme.colors.isLight)Color(0xffeceef0) else Color(0xff202124))){
                val viewportWidth=maxWidth
                val pages=document
                when {
                    failure.isNotEmpty()->Text(failure,Modifier.align(Alignment.Center).padding(24.dp))
                    pages==null->CircularProgressIndicator(Modifier.align(Alignment.Center))
                    else->Box(Modifier.fillMaxSize().horizontalScroll(horizontal)){
                        LazyColumn(state=list,modifier=Modifier.width(viewportWidth*zoom).fillMaxHeight().testTag("pdfPages"),
                            contentPadding=PaddingValues(10.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                            items(pages.ratios.size,key={it}){index->
                                PdfPageImage(pages,index,screenWidth*zoom-20f*density.density,pages.ratios[index])
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable private fun PdfPageImage(document:PdfPages,index:Int,widthPx:Float,ratio:Float){
    var bitmap by remember(document,index,widthPx){mutableStateOf<Bitmap?>(null)}
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
