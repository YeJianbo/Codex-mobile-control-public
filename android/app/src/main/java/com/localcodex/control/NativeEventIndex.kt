package com.localcodex.control

/** Lookup state belongs to one immutable conversation event list. */
internal class NativeEventIndex {
    private var source:List<ChatEvent>?=null
    private val eventIds=hashSetOf<String>()
    private val completedItems=hashSetOf<String>()

    fun onEventsChanged(events:List<ChatEvent>){
        if(source===events)return
        source=null;eventIds.clear();completedItems.clear()
    }
    private fun include(event:ChatEvent){
        if(event.eventId.isNotBlank())eventIds.add(event.eventId)
        if(event.type=="message.delta"&&event.textComplete&&event.itemId.isNotBlank())completedItems.add(event.itemId)
    }
    private fun ensure(events:List<ChatEvent>){
        if(source===events)return
        onEventsChanged(events)
        events.forEach(::include)
        source=events
    }
    fun containsId(events:List<ChatEvent>,id:String):Boolean{
        if(id.isBlank())return false
        ensure(events)
        return id in eventIds
    }
    fun messageComplete(events:List<ChatEvent>,itemId:String):Boolean{
        if(itemId.isBlank())return false
        ensure(events)
        return itemId in completedItems
    }
    // The caller creates next by appending event and optionally trimming its
    // prefix. A trim invalidates the index so removed IDs cannot remain present.
    fun appended(previous:List<ChatEvent>,event:ChatEvent,next:List<ChatEvent>){
        if(source===previous&&next.size==previous.size+1){include(event);source=next}
        else onEventsChanged(next)
    }
}
