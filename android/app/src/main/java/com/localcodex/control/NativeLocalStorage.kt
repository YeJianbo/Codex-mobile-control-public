package com.localcodex.control

import android.content.Context
import java.io.File
import java.security.MessageDigest
import java.util.UUID

internal data class NativeStorageState(val limitMb:Int=1024,val bytes:Long=0,val files:Int=0,val busy:Boolean=false,val message:String="",val error:String="")

/** Retained encoded media; bitmap memory limits are managed separately. */
internal class NativeLocalStorage(context:Context){
    private val app=context.applicationContext
    private val prefs=app.getSharedPreferences("native",Context.MODE_PRIVATE)
    private val root=File(app.filesDir,"retained-cache")
    private val images=File(root,"images")
    private val documents=File(root,"documents")
    private val staging=File(root,"staging")
    private val roots=listOf(images,documents,File(app.cacheDir,"outputs"),File(app.cacheDir,"pdf-previews"),File(app.cacheDir,"markdown-previews"))
    val revision:Long get()=synchronized(lock){cacheRevision}
    fun limitMb()=prefs.getInt("cache.limitMb",1024).coerceIn(128,8192)
    private fun key(scope:String,endpoint:String)=MessageDigest.getInstance("SHA-256").digest((scope+"\u0000"+endpoint).toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it.toInt() and 255)}
    private fun managedFiles()=roots.flatMap{directory->
        val parent=directory.canonicalFile
        directory.listFiles().orEmpty().filter{it.isFile&&it.canonicalFile.parentFile==parent}
    }
    private fun initialize(){
        images.mkdirs();documents.mkdirs();staging.mkdirs()
        if(initialized.add(root.absolutePath)){
            // Only unfinished writes from the previous process; completed files have no time expiry.
            staging.listFiles().orEmpty().filter{it.isFile&&it.canonicalFile.parentFile==staging.canonicalFile}.forEach{it.delete()}
        }
    }
    fun temporaryFile(suffix:String):File=synchronized(lock){initialize();File.createTempFile("download-",suffix,staging)}
    fun image(scope:String,endpoint:String):ByteArray?=synchronized(lock){
        initialize()
        val file=File(images,key(scope,endpoint)+".image")
        if(!file.isFile)return@synchronized null
        if(file.length()>32L*1024*1024){file.delete();return@synchronized null}
        val bytes=file.readBytes();file.setLastModified(System.currentTimeMillis());bytes
    }
    fun putImage(scope:String,endpoint:String,bytes:ByteArray,expectedRevision:Long):Boolean=synchronized(lock){
        initialize()
        if(expectedRevision!=cacheRevision)return@synchronized false
        val target=File(images,key(scope,endpoint)+".image")
        val temp=File(staging,UUID.randomUUID().toString()+".part")
        try{temp.writeBytes(bytes);check(temp.renameTo(target)){"无法写入图片缓存"};trimLocked();target.isFile}finally{temp.delete()}
    }
    private fun documentFile(scope:String,endpoint:String,name:String)=File(documents,key(scope,endpoint)+"-"+nativeOutputName(name))
    fun document(scope:String,endpoint:String,name:String):File?=synchronized(lock){
        initialize()
        val expected=documentFile(scope,endpoint,name)
        val prefix=key(scope,endpoint)+"-"
        // Earlier versions altered literal percent/hash characters in the name.
        // The endpoint key still identifies the same retained document.
        val file=expected.takeIf{it.isFile}?:documents.listFiles().orEmpty()
            .filter{it.isFile&&it.name.startsWith(prefix)}
            .maxByOrNull{it.lastModified()}?:return@synchronized null
        file.setLastModified(System.currentTimeMillis());pins[file.absolutePath]=(pins[file.absolutePath]?:0)+1
        file
    }
    fun retainDocument(temp:File,name:String,scope:String,endpoint:String):File=synchronized(lock){
        initialize()
        require(temp.canonicalFile.parentFile==staging.canonicalFile){"无效的下载临时文件"}
        val target=documentFile(scope,endpoint,name)
        check(temp.renameTo(target)){"无法保留文件缓存"}
        pins[target.absolutePath]=(pins[target.absolutePath]?:0)+1
        runCatching{trimLocked()};target
    }
    fun release(path:String)=synchronized(lock){
        val count=pins[path]?:return@synchronized
        if(count<=1)pins.remove(path)else pins[path]=count-1
    }
    private fun trimLocked(){
        val files=managedFiles();var total=files.sumOf{it.length()};val limit=limitMb().toLong()*1024*1024
        for(file in files.sortedBy{it.lastModified()}){
            if(total<=limit)break
            if(file.absolutePath in pins)continue
            val size=file.length();if(file.delete())total-=size
        }
    }
    fun trim()=synchronized(lock){initialize();trimLocked()}
    fun snapshot():NativeStorageState=synchronized(lock){initialize();val files=managedFiles();NativeStorageState(limitMb(),files.sumOf{it.length()},files.size)}
    fun setLimit(value:Int)=synchronized(lock){
        require(value in 128..8192){"请输入 128–8192 MB"}
        prefs.edit().putInt("cache.limitMb",value).apply();initialize();trimLocked()
    }
    fun clear()=synchronized(lock){
        initialize();cacheRevision++
        managedFiles().filter{it.absolutePath !in pins}.forEach{check(it.delete()||!it.exists()){ "部分缓存暂时无法清理，请稍后重试" }}
    }
    private companion object{
        val lock=Any()
        val initialized=mutableSetOf<String>()
        val pins=mutableMapOf<String,Int>()
        var cacheRevision=0L
    }
}
