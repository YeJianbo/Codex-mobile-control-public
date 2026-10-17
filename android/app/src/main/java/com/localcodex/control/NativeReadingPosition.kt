package com.localcodex.control

/** Local UI state only: opaque row key/offset, no messages or credentials on disk. */
internal data class NativeReadingPosition(val anchorKey:String,val fallbackIndex:Int,val scrollOffset:Int,val followLatest:Boolean,val historyTurns:Int=10)
internal class NativeReadingPositions(private val limit:Int=40){
    private val values=LinkedHashMap<String,NativeReadingPosition>()
    fun get(threadId:String)=values[threadId]
    fun save(threadId:String,value:NativeReadingPosition){
        if(threadId.isBlank())return
        values.remove(threadId);values[threadId]=value
        while(values.size>limit)values.remove(values.keys.first())
    }
}
