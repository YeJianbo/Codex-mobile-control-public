package com.localcodex.control

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ColorSpace
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.os.Build
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import kotlin.math.min
import kotlin.math.sqrt
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

internal const val NativePickedImageLimit=20*1024*1024
internal const val NativeUploadedImageLimit=5*1024*1024
internal data class NativePreparedImageUpload(val bytes:ByteArray,val mime:String)

/** Picker MIME labels and filename extensions can disagree with the actual image encoding. */
internal fun nativeImageContentMime(bytes:ByteArray):String? {
    fun prefix(vararg values:Int)=bytes.size>=values.size&&values.indices.all{bytes[it].toInt() and 255==values[it]}
    fun ascii(start:Int,end:Int)=if(bytes.size>=end)String(bytes,start,end-start,Charsets.US_ASCII) else ""
    return when {
        prefix(137,80,78,71,13,10,26,10)->"image/png"
        prefix(255,216,255)->"image/jpeg"
        ascii(0,6) in listOf("GIF87a","GIF89a")->"image/gif"
        ascii(0,4)=="RIFF"&&ascii(8,12)=="WEBP"->"image/webp"
        ascii(4,8)=="ftyp"&&ascii(8,12) in listOf("heic","heix","hevc","hevx","mif1","msf1")->"image/heic"
        ascii(4,8)=="ftyp"&&ascii(8,12) in listOf("avif","avis")->"image/avif"
        else->null
    }
}

internal fun nativeImageUploadSize(width:Int,height:Int):Pair<Int,Int> {
    require(width>0&&height>0){"无法读取图片尺寸"}
    val scale=min(1.0,min(4096.0/maxOf(width,height),sqrt(8_000_000.0/(width.toDouble()*height))))
    return maxOf(1,(width*scale).toInt()) to maxOf(1,(height*scale).toInt())
}

internal suspend fun prepareNativeImageUpload(bytes:ByteArray):NativePreparedImageUpload {
    require(bytes.isNotEmpty()){ "图片为空" }
    require(bytes.size<=NativePickedImageLimit){"原图片不能超过 20 MB"}
    val mime=nativeImageContentMime(bytes)
    if(bytes.size<=NativeUploadedImageLimit&&mime in setOf("image/png","image/jpeg","image/gif","image/webp"))
        return NativePreparedImageUpload(bytes,mime!!)
    currentCoroutineContext().ensureActive()
    var bitmap=if(Build.VERSION.SDK_INT>=28){
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))){decoder,info,_->
            val (width,height)=nativeImageUploadSize(info.size.width,info.size.height)
            decoder.allocator=ImageDecoder.ALLOCATOR_SOFTWARE
            decoder.setTargetColorSpace(ColorSpace.get(ColorSpace.Named.SRGB))
            decoder.setTargetSize(width,height)
        }
    }else{
        val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
        BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
        val target=nativeImageUploadSize(bounds.outWidth,bounds.outHeight)
        var sample=1
        while(bounds.outWidth/sample>target.first||bounds.outHeight/sample>target.second)sample*=2
        val decoded=BitmapFactory.decodeByteArray(bytes,0,bytes.size,BitmapFactory.Options().apply{inSampleSize=sample})
            ?:error("无法解码此图片，请保存为 JPEG 或 PNG 后选择")
        val orientation=bytes.inputStream().use{ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL)}
        val matrix=Matrix().apply{when(orientation){
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL->setScale(-1f,1f)
            ExifInterface.ORIENTATION_ROTATE_180->setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL->setScale(1f,-1f)
            ExifInterface.ORIENTATION_TRANSPOSE->{setRotate(90f);postScale(-1f,1f)}
            ExifInterface.ORIENTATION_ROTATE_90->setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE->{setRotate(-90f);postScale(-1f,1f)}
            ExifInterface.ORIENTATION_ROTATE_270->setRotate(-90f)
        }}
        if(matrix.isIdentity)decoded else Bitmap.createBitmap(decoded,0,0,decoded.width,decoded.height,matrix,true).also{if(it!==decoded)decoded.recycle()}
    }
    try {
        repeat(4){attempt->
            currentCoroutineContext().ensureActive()
            val alpha=bitmap.hasAlpha()
            val output=ByteArrayOutputStream()
            val format=if(alpha)Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
            check(bitmap.compress(format,if(attempt==0)94 else 84,output)){"图片转换失败"}
            if(output.size()<=NativeUploadedImageLimit)return NativePreparedImageUpload(output.toByteArray(),if(alpha)"image/png" else "image/jpeg")
            val next=Bitmap.createScaledBitmap(bitmap,maxOf(1,(bitmap.width*.75f).toInt()),maxOf(1,(bitmap.height*.75f).toInt()),true)
            if(next!==bitmap)bitmap.recycle()
            bitmap=next
        }
        error("图片转换后仍超过 5 MB，请裁剪后上传")
    }finally{bitmap.recycle()}
}
