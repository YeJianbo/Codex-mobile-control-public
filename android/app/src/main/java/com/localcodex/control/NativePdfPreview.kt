package com.localcodex.control

import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

private data class PdfPage(val bitmap:Bitmap,val count:Int)

@Composable fun NativePdfPreview(pdf:NativePdf,close:()->Unit) {
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    val density=LocalDensity.current
    val screenWidth=with(density){LocalConfiguration.current.screenWidthDp.dp.toPx()}
    var page by remember(pdf.path){mutableStateOf(0)}
    var zoom by remember(pdf.path){mutableStateOf(1f)}
    var count by remember(pdf.path){mutableStateOf(0)}
    var bitmap by remember(pdf.path){mutableStateOf<Bitmap?>(null)}
    var failure by remember(pdf.path){mutableStateOf("")}
    var saving by remember{mutableStateOf(false)}
    val horizontal=rememberScrollState()
    val vertical=rememberScrollState()
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")){uri->
        if(uri!=null){saving=true;scope.launch{
            val result=runCatching{withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.use{File(pdf.path).inputStream().use{source->source.copyTo(it)}}?:error("无法写入文件")}}
            saving=false
            Toast.makeText(context,if(result.isSuccess)"PDF 已保存" else "保存失败，请重试",Toast.LENGTH_SHORT).show()
        }}
    }
    LaunchedEffect(pdf.path,page,zoom,screenWidth){
        bitmap=null;failure=""
        try {
            val result=withContext(Dispatchers.IO){
                ParcelFileDescriptor.open(File(pdf.path),ParcelFileDescriptor.MODE_READ_ONLY).use{descriptor->
                    PdfRenderer(descriptor).use{renderer->
                        require(renderer.pageCount>0){"PDF 没有页面"}
                        renderer.openPage(page.coerceIn(0,renderer.pageCount-1)).use{source->
                            val width=(screenWidth*zoom).toInt().coerceIn(320,2400)
                            val height=(width.toFloat()*source.height/source.width).toInt().coerceIn(1,3600)
                            val image=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888)
                            image.eraseColor(AndroidColor.WHITE)
                            source.render(image,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            PdfPage(image,renderer.pageCount)
                        }
                    }
                }
            }
            count=result.count;bitmap=result.bitmap
            horizontal.scrollTo(0);vertical.scrollTo(0)
        }catch(error:Exception){failure=error.message?:"无法预览 PDF"}
    }
    Dialog(onDismissRequest=close,properties=DialogProperties(usePlatformDefaultWidth=false)){
        Column(Modifier.fillMaxSize().background(MaterialTheme.colors.background)){
            Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal=8.dp),verticalAlignment=Alignment.CenterVertically){
                IconButton(onClick=close){Icon(Icons.Outlined.ArrowBack,"关闭 PDF 预览")}
                Text(pdf.name,Modifier.weight(1f),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=16.sp)
                IconButton(onClick={save.launch(pdf.name)},enabled=!saving){Icon(Icons.Outlined.Download,"保存 PDF")}
            }
            Divider()
            Box(Modifier.weight(1f).fillMaxWidth().background(if(MaterialTheme.colors.isLight)androidx.compose.ui.graphics.Color(0xffeceef0) else androidx.compose.ui.graphics.Color(0xff25272b)),contentAlignment=Alignment.Center){
                when {
                    failure.isNotEmpty()->Text(failure,Modifier.padding(24.dp))
                    bitmap==null->CircularProgressIndicator()
                    else->Box(Modifier.fillMaxSize().verticalScroll(vertical).horizontalScroll(horizontal)){
                        Image(bitmap!!.asImageBitmap(),"PDF 第 ${page+1} 页",Modifier.width(with(density){bitmap!!.width.toDp()}).padding(10.dp))
                    }
                }
            }
            Divider()
            Row(Modifier.fillMaxWidth().height(62.dp).padding(horizontal=8.dp),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
                IconButton(onClick={page--},enabled=page>0){Icon(Icons.Outlined.ChevronLeft,"上一页")}
                Text("${page+1} / ${count.coerceAtLeast(1)}",fontSize=15.sp)
                IconButton(onClick={page++},enabled=page+1<count){Icon(Icons.Outlined.ChevronRight,"下一页")}
                Spacer(Modifier.width(8.dp))
                IconButton(onClick={zoom=(zoom-0.25f).coerceAtLeast(0.75f)},enabled=zoom>0.75f){Icon(Icons.Outlined.ZoomOut,"缩小 PDF")}
                Text("${(zoom*100).toInt()}%",fontSize=13.sp)
                IconButton(onClick={zoom=(zoom+0.25f).coerceAtMost(2.5f)},enabled=zoom<2.5f){Icon(Icons.Outlined.ZoomIn,"放大 PDF")}
            }
        }
    }
}
