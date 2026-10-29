package com.localcodex.control

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.ceil
import kotlin.math.floor

internal data class NativePdfRegion(val pageWidth:Int,val left:Int,val top:Int,val right:Int,val bottom:Int){
    val width get()=right-left
    val height get()=bottom-top
}

/** All coordinates are pixels in the page raster at the settled zoom. */
internal fun nativePdfVisibleRegion(pageWidth:Float,ratio:Float,zoom:Float,panX:Float,padding:Float,
    viewportWidth:Float,itemOffset:Int,viewportStart:Int,viewportEnd:Int):NativePdfRegion?{
    val width=ceil(pageWidth*zoom).toInt().coerceAtLeast(1)
    val scale=width/pageWidth
    val height=ceil(width*ratio).toInt()
    val left=floor((-panX/zoom-padding)*scale).toInt().coerceIn(0,width)
    val right=ceil(((viewportWidth-panX)/zoom-padding)*scale).toInt().coerceIn(0,width)
    val top=floor((viewportStart-itemOffset)*scale).toInt().coerceIn(0,height)
    val bottom=ceil((viewportEnd-itemOffset)*scale).toInt().coerceIn(0,height)
    return if(right>left&&bottom>top)NativePdfRegion(width,left,top,right,bottom)else null
}

internal class NativePdfPages(file:File,checkActive:()->Unit){
    private val descriptor=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)
    private val renderer=try{PdfRenderer(descriptor)}catch(error:Throwable){descriptor.close();throw error}
    private val renderLock=Mutex()
    val ratios:List<Float> = try{
        require(renderer.pageCount>0){"PDF 没有页面"}
        List(renderer.pageCount){index->checkActive();renderer.openPage(index).use{page->
            require(page.width>0&&page.height>0){"PDF 页面尺寸无效"};page.height.toFloat()/page.width
        }}
    }catch(error:Throwable){renderer.close();descriptor.close();throw error}

    /** Small full-page backdrop keeps scrolling and pinch frames immediate. */
    suspend fun render(index:Int,targetWidth:Int):Bitmap=renderLock.withLock{
        renderer.openPage(index).use{page->
            val scale=minOf(targetWidth.coerceIn(320,1800).toDouble()/page.width,
                3600.0/page.height,kotlin.math.sqrt(2.0*1024*1024/(page.width.toDouble()*page.height)))
            render(page,(page.width*scale).toInt().coerceAtLeast(1),(page.height*scale).toInt().coerceAtLeast(1),null)
        }
    }

    /** Allocate only the visible crop, never a whole page enlarged to 4x. */
    suspend fun renderRegion(index:Int,region:NativePdfRegion):Bitmap=renderLock.withLock{
        renderer.openPage(index).use{page->
            val scale=region.pageWidth.toFloat()/page.width
            val matrix=Matrix().apply{setScale(scale,scale);postTranslate(-region.left.toFloat(),-region.top.toFloat())}
            render(page,region.width,region.height,matrix)
        }
    }
    private fun render(page:PdfRenderer.Page,width:Int,height:Int,matrix:Matrix?):Bitmap{
        val bitmap=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888)
        return try{bitmap.eraseColor(Color.WHITE);page.render(bitmap,null,matrix,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);bitmap}
        catch(error:Throwable){bitmap.recycle();throw error}
    }
    suspend fun dispose()=withContext(Dispatchers.IO){renderLock.withLock{try{renderer.close()}finally{descriptor.close()}}}
}
