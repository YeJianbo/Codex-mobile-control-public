package com.localcodex.control

import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.core.content.ContextCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.BinaryBitmap
import com.google.zxing.common.HybridBinarizer
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** A local QR scanner; camera frames and pairing data never leave the device. */
@Composable internal fun NativePairScanner(onResult:(String)->Unit,onError:(String)->Unit,onClose:()->Unit){
    val context=LocalContext.current
    val lifecycle=LocalLifecycleOwner.current
    val currentResult by rememberUpdatedState(onResult)
    val currentError by rememberUpdatedState(onError)
    val view=remember(context){PreviewView(context)}
    DisposableEffect(view,lifecycle){
        val closed=AtomicBoolean(false)
        val found=AtomicBoolean(false)
        val executor=Executors.newSingleThreadExecutor()
        val main=ContextCompat.getMainExecutor(context)
        val providerFuture=ProcessCameraProvider.getInstance(context)
        var provider:ProcessCameraProvider?=null
        var preview:Preview?=null
        var analysis:ImageAnalysis?=null
        providerFuture.addListener({
            if(!closed.get())try{
                val camera=providerFuture.get();provider=camera
                val live=Preview.Builder().build().also{it.setSurfaceProvider(view.surfaceProvider)}
                val reader=MultiFormatReader().apply{setHints(mapOf(DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE)))}
                val frames=ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                var lastRead=0L
                frames.setAnalyzer(executor){image->
                    try{
                        val now=android.os.SystemClock.elapsedRealtime()
                        if(!closed.get()&&!found.get()&&now-lastRead>=200){
                            lastRead=now
                            val plane=image.planes[0];val data=plane.buffer;val crop=image.cropRect
                            val width=crop.width();val height=crop.height();val bytes=ByteArray(width*height)
                            val start=data.position()
                            for(y in 0 until height)for(x in 0 until width)bytes[y*width+x]=data.get(start+(y+crop.top)*plane.rowStride+(x+crop.left)*plane.pixelStride)
                            val source=PlanarYUVLuminanceSource(bytes,width,height,0,0,width,height,false)
                            val value=try{reader.decodeWithState(BinaryBitmap(HybridBinarizer(source))).text}catch(_:com.google.zxing.ReaderException){null}finally{reader.reset()}
                            if(value!=null&&found.compareAndSet(false,true))main.execute{if(!closed.get())currentResult(value)}
                        }
                    }catch(_:Exception){}finally{image.close()}
                }
                preview=live;analysis=frames
                val selector=if(camera.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA))CameraSelector.DEFAULT_BACK_CAMERA else CameraSelector.DEFAULT_FRONT_CAMERA
                camera.bindToLifecycle(lifecycle,selector,live,frames)
            }catch(_:Exception){if(!closed.get())currentError("无法打开相机，请检查相机权限和设备状态")}
        },main)
        onDispose{
            closed.set(true)
            analysis?.clearAnalyzer()
            val useCases=listOfNotNull(preview,analysis)
            if(useCases.isNotEmpty())provider?.unbind(*useCases.toTypedArray())
            executor.shutdown()
        }
    }
    Dialog(onDismissRequest=onClose){
        Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colors.surface){
            Column(Modifier.fillMaxWidth().heightIn(max=560.dp).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Text("扫描电脑二维码",Modifier.weight(1f),style=MaterialTheme.typography.subtitle1)
                    TextButton(onClick=onClose){Text("关闭")}
                }
                Box(Modifier.fillMaxWidth().weight(1f).clip(RoundedCornerShape(16.dp)).background(Color.Black),contentAlignment=Alignment.Center){
                    AndroidView(factory={view},modifier=Modifier.fillMaxSize())
                }
                Text("将电脑上的配对二维码放入画面",style=MaterialTheme.typography.body2,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
            }
        }
    }
}
