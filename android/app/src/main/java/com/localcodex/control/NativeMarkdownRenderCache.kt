package com.localcodex.control

import android.text.SpannedString
import android.util.LruCache
import io.noties.markwon.Markwon
import androidx.compose.runtime.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import java.util.concurrent.atomic.AtomicInteger

internal class NativeMarkdownRenderCache(private val markwon:Markwon,private val maxChars:Int=500_000,background:()->Markwon={markwon}){
    private data class Owner(val key:String)
    private data class Entry(val source:String,val rendered:SpannedString)
    private val entries=object:LruCache<Any,Entry>(maxChars){
        override fun sizeOf(key:Any,value:Entry)=value.source.length+value.rendered.length
    }
    private val renderCount=AtomicInteger()
    internal val misses get()=renderCount.get()
    private val worker by lazy(background)
    private val workerMutex=Mutex()

    fun render(source:String,owner:String?=null):SpannedString=synchronized(markwon){renderWith(markwon,source,owner)}

    suspend fun renderAsync(source:String,owner:String?=null):SpannedString{
        entries.get(owner?.let(::Owner)?:source)?.takeIf{it.source==source}?.let{return it.rendered}
        return withContext(Dispatchers.Default){workerMutex.withLock{
            if(worker===markwon)render(source,owner) else renderWith(worker,source,owner)
        }}
    }

    private fun renderWith(renderer:Markwon,source:String,owner:String?):SpannedString{
        val key=owner?.let(::Owner)?:source
        val previous=entries.get(key)
        previous?.takeIf{it.source==source}?.let{return it.rendered}
        val parsed=nativeRenderMarkdown(renderer,source)
        val end=parsed.indexOfLast{!it.isWhitespace()}+1
        val result=SpannedString(parsed.subSequence(0,end))
        // Streamed versions replace their slot. An oversized reply must not evict every other message.
        synchronized(entries){
            // A newer foreground render may have replaced this owner's slot.
            if(entries.get(key)===previous){
                if(source.length.toLong()+result.length<=maxChars)entries.put(key,Entry(source,result)) else entries.remove(key)
            }
        }
        renderCount.incrementAndGet()
        return result
    }
}

internal data class NativeRenderedMarkdown(val source:String,val rendered:SpannedString)

@Composable internal fun rememberNativeRenderedMarkdown(cache:NativeMarkdownRenderCache,source:String,owner:String?):State<NativeRenderedMarkdown>{
    val current=rememberUpdatedState(source)
    // Cold content keeps its established measurement/scroll-restoration path.
    val unownedSource=source.takeIf{owner==null}
    val result=remember(cache,owner,unownedSource){mutableStateOf(NativeRenderedMarkdown(source,cache.render(source,owner)))}
    LaunchedEffect(cache,owner,unownedSource){
        collectNativeRenderUpdates(snapshotFlow{current.value},{cache.renderAsync(it,owner)}){input,rendered->
            result.value=NativeRenderedMarkdown(input,rendered)
        }
    }
    return result
}
