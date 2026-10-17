package com.localcodex.control

import androidx.compose.runtime.mutableStateListOf
import java.util.ArrayDeque

/** Publish immutable snapshots while sharing the unchanged part of streaming history. */
internal class NativeEventBuffer {
    private val events=mutableStateListOf<ChatEvent>()
    private val userStarts=ArrayDeque<Int>()
    private var source:List<ChatEvent>?=null
    private var firstIndex=0

    fun onEventsChanged(value:List<ChatEvent>){
        if(source===value)return
        source=null;events.clear();userStarts.clear();firstIndex=0
    }

    fun append(previous:List<ChatEvent>,event:ChatEvent,limit:Int=5000):List<ChatEvent>{
        if(source!==previous){
            onEventsChanged(previous)
            events.addAll(previous)
            previous.forEachIndexed{index,row->if(row.type=="user.message")userStarts.addLast(index)}
        }
        if(event.type=="user.message")userStarts.addLast(firstIndex+events.size)
        events.add(event)
        if(events.size>limit){
            val threshold=firstIndex+events.size-limit
            var start=firstIndex
            while(userStarts.isNotEmpty()&&userStarts.first<=threshold)start=userStarts.removeFirst()
            if(start>firstIndex){events.removeRange(0,start-firstIndex);firstIndex=start}
        }
        return events.toList().also{source=it}
    }
}
