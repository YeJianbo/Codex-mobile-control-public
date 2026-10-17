package com.localcodex.control

internal data class NativeConversationSnapshot(val events:List<ChatEvent>,val turns:Int,val hasMore:Boolean,val actualModel:String)

/** Retain recently viewed conversations; oversized pages stay in the active view only. */
internal class NativeConversationCache(private val maxEntries:Int=8,private val maxBytes:Long=12L*1024*1024){
    private data class Entry(val snapshot:NativeConversationSnapshot,val bytes:Long)
    private val rows=LinkedHashMap<String,Entry>(16,0.75f,true)
    var bytes:Long=0;private set
    val size:Int get()=rows.size
    fun get(key:String):NativeConversationSnapshot?=rows[key]?.snapshot
    fun put(key:String,snapshot:NativeConversationSnapshot){
        rows.remove(key)?.let{bytes-=it.bytes}
        // Count retained fields without copying large message/command bodies into toString().
        val estimate=Weight(maxBytes)
        estimate.strings(key,snapshot.actualModel)
        estimate.add(snapshot.events.size*8L)
        for(event in snapshot.events){
            if(!estimate.fits)return
            estimate.event(event)
        }
        if(!estimate.fits)return
        val weight=estimate.bytes
        rows[key]=Entry(snapshot,weight);bytes+=weight
        while(rows.size>maxEntries||bytes>maxBytes){val first=rows.entries.iterator().next();bytes-=first.value.bytes;rows.remove(first.key)}
    }
    fun clear(){rows.clear();bytes=0}

    private class Weight(private val limit:Long){
        var bytes=0L;private set
        val fits get()=bytes<=limit
        fun add(value:Long){bytes+=value}
        fun strings(vararg values:String){for(value in values){if(!fits)return;add(40L+value.length*2L)}}
        fun event(event:ChatEvent){
            add(256L)
            strings(event.type,event.threadId,event.projectPath,event.stream,event.text,event.title,event.status,
                event.detail,event.itemId,event.commandId,event.cwd,event.command,event.createdAt,event.updatedAt,
                event.approvalId,event.approvalType,event.diff,event.eventId,event.displayKey,event.requestId,
                event.activityGroupId,event.activitySummary)
            for(value in event.files){if(!fits)return;add(8L);strings(value)}
            for(value in event.fileChanges){if(!fits)return;add(48L);strings(value.path)}
            for(value in event.images){if(!fits)return;add(32L);strings(value.id,value.name)}
            for(value in event.uploads){if(!fits)return;add(48L);strings(value.id,value.name,value.mime)}
            for(value in event.attachments){if(!fits)return;add(40L);strings(value.name,value.path,value.url)}
            for(value in event.questionReplies){if(!fits)return;add(32L);strings(value.question,value.answer)}
            event.messageSource?.let{add(40L);strings(it.kind,it.name,it.threadId,it.avatar)}
        }
    }
}
