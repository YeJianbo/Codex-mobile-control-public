package com.localcodex.control

private object TimelineTypes {
    val signature=setOf("user.message","message.delta","reasoning.summary","tool.started","tool.output","tool.completed","plan.updated","file.changed","diff.updated")
    val text=setOf("message.delta","reasoning.summary")
    val compactionBoundary=setOf("context.compaction","turn.completed")
    val activityIndicator=setOf("user.message","message.delta","reasoning.summary","plan.updated","tool.started","tool.output","tool.completed","file.changed","diff.updated","context.compaction","turn.completed","error","approval.requested")
    val idleIndicator=setOf("tool.completed","turn.completed","error","approval.requested")
    val turnBoundary=setOf("turn.started","turn.completed")
    val compactionState=turnBoundary+"context.compaction"
    val retryBoundary=setOf("user.message","turn.started")
    val summaryBoundary=setOf("user.message","turn.started","context.compaction")
    val activity=setOf("tool.started","tool.output","tool.completed","reasoning.summary","file.changed","diff.updated","plan.updated")
    val mergeable=setOf("message.delta","reasoning.summary","tool.output")
    val visible=setOf("user.message","message.delta","reasoning.summary","context.compaction","plan.updated","tool.started","tool.output","tool.completed","approval.requested","file.changed","diff.updated","error","warning")
    val outsideCompletedProcess=setOf("error","warning","context.compaction")
    val failedStatus=setOf("interrupted","failed","error")
}

// The bound applies to complete exchanges, never to part of a long active reply.
internal fun retainNativeConversationEvents(events:List<ChatEvent>,limit:Int=5000):List<ChatEvent>{
    if(events.size<=limit)return events
    var start=events.size-limit
    while(start>0&&events[start].type!="user.message")start--
    return if(start==0)events else events.drop(start)
}

data class NativeBlock(val key:String, val event:ChatEvent, val activities:List<ChatEvent> = emptyList(),val boundary:Boolean=false,val children:List<NativeBlock> = emptyList(),val copyable:Boolean=false,val retryPrompt:ChatEvent?=null,val endedAt:String="",val retryFailure:Boolean=false,val replyScope:String="")
private data class NativeEventSignature(val type:String,val text:String,val title:String,val detail:String,val status:String,val images:List<NativeImage>,val uploads:List<NativeUploadedFile>,val attachments:List<NativeAttachment>)
private fun nativeEventSignature(event:ChatEvent):NativeEventSignature?{
    if(event.type !in TimelineTypes.signature)return null
    if(event.text.isBlank()&&event.title.isBlank()&&event.detail.isBlank()&&event.images.isEmpty()&&event.uploads.isEmpty()&&event.attachments.isEmpty())return null
    return NativeEventSignature(event.type,event.text,event.title,event.detail,event.status,event.images,event.uploads,event.attachments)
}
// A live event gets a new eventId when the Codex transcript replaces it. Reuse
// its row key only for an unambiguous match; eventId stays intact for APIs.
internal fun preserveNativeEventKeys(previous:List<ChatEvent>,incoming:List<ChatEvent>):List<ChatEvent>{
    // Polling can return new objects with identical values. Keep the active
    // snapshot so its streaming buffer and lookup index remain warm.
    if(previous==incoming)return previous
    val live=previous.filter{it.eventId.isNotBlank()&&!it.eventId.startsWith("history:")}
    val oldById=previous.filter{it.displayKey.isNotBlank()}.associateBy{it.eventId}
    if(live.isEmpty()&&oldById.isEmpty())return incoming
    val unique=live.mapNotNull{event->nativeEventSignature(event)?.let{it to event}}.groupBy({it.first},{it.second}).filterValues{it.size==1}.mapValues{it.value.single()}
    val counts=mutableMapOf<NativeEventSignature,Int>()
    if(unique.isNotEmpty())incoming.forEach{event->if(event.eventId.startsWith("history:"))nativeEventSignature(event)?.takeIf{it in unique}?.let{counts[it]=(counts[it]?:0)+1}}
    val incomingIds=incoming.map{it.eventId}.toSet()
    val identified=incoming.map{event->
        val known=oldById[event.eventId]
        if(known!=null){if(known.displayKey==event.displayKey)event else event.copy(displayKey=known.displayKey)}
        else if(event.eventId.startsWith("history:")){
            val signature=nativeEventSignature(event)
            val old=signature?.takeIf{counts[it]==1}?.let{unique[it]}
            if(old!=null&&old.eventId !in incomingIds){
                val key=old.displayKey.ifBlank{old.itemId.takeIf{it.isNotBlank()&&!it.startsWith("history:")}?.let{"${old.type}:item:$it"}?:old.eventId}
                event.copy(displayKey=key)
            }else event
        }else event
    }
    return if(identified==previous)previous else identified
}
// A bounded server window may advance while the user reads earlier loaded messages.
// Retain only the prefix before the first shared ID; the server remains authoritative
// for overlapping events (including edits to a streaming response).
internal fun retainNativeHistoryPrefix(previous:List<ChatEvent>,next:List<ChatEvent>):List<ChatEvent>{
    val positions=previous.mapIndexedNotNull{index,event->event.eventId.takeIf{it.isNotBlank()}?.let{it to index}}.toMap()
    val firstShared=next.firstNotNullOfOrNull{positions[it.eventId]}?:return next
    if(firstShared==0)return next
    val incomingIds=next.map{it.eventId}.toSet()
    return previous.take(firstShared).filter{it.eventId.isNotBlank()&&it.eventId !in incomingIds}+next
}
// Reconcile history with everything already displayed, not only notifications
// received after the request began. A delayed poll must not roll back a reply.
internal fun reconcileNativeHistory(previous:List<ChatEvent>,incoming:List<ChatEvent>,hasMore:Boolean,retainLive:Boolean=true):List<ChatEvent>{
    // Read-only cloud snapshots have versioned IDs, not live deltas. Their new
    // snapshot replaces the old one; otherwise each version would be appended.
    if(!retainLive)return if(hasMore)retainNativeHistoryPrefix(previous,incoming) else incoming
    val identified=preserveNativeCompactionKeys(previous,incoming)
    // An unchanged poll needs no insertion anchors, signatures or text assembly.
    if(identified==previous)return previous
    val textTypes=TimelineTypes.text
    fun item(event:ChatEvent)=event.itemId.takeIf{it.isNotBlank()&&!it.startsWith("history:")}?.let{event.type to it}
    val snapshots=identified.filter{it.type in textTypes&&it.eventId.startsWith("history:")&&item(it)!=null}.associateBy{item(it)!!}
    val partialItems=snapshots.filterValues{!it.textComplete}.keys
    val next=if(partialItems.isEmpty())identified else {
        val oldText=previous.filter{it.type in textTypes&&item(it) in partialItems}.groupBy{item(it)!!}
            .mapValues{(_,events)->events.joinToString(""){it.text}}
        val incomingText=identified.filter{it.type in textTypes&&item(it) in partialItems}.groupBy{item(it)!!}
            .mapValues{(_,events)->events.joinToString(""){it.text}}
        val expanded=partialItems.filter{key->
            val old=oldText[key].orEmpty();val text=incomingText[key].orEmpty()
            old.length>text.length&&old.startsWith(text)
        }.toSet()
        if(expanded.isEmpty())identified else identified.map{event->
            val key=item(event)
            if(key in expanded){
                // Fold the known full text once, retaining incoming delta IDs
                // so a late WebSocket delivery cannot append them again.
                event.copy(text=if(event.eventId==snapshots[key]?.eventId)oldText[key].orEmpty() else "")
            }else event
        }
    }
    val ids=next.map{it.eventId}.filter{it.isNotBlank()}.toSet()
    val submitted=next.filter{it.type=="user.message"&&it.requestId.isNotBlank()}.map{it.requestId}.toSet()
    val rawItems=next.filter{!it.eventId.startsWith("history:")}.mapNotNull{item(it)}.toSet()
    val compactedItems=next.filter{it.type=="context.compaction"&&it.status!="running"}.mapNotNull{item(it)}.toSet()
    val historyCutoffs=next.filter{it.eventId.startsWith("history:")&&it.createdAt.isNotBlank()}.groupBy{it.type}.mapValues{(_,events)->events.maxOf{it.createdAt}}
    val savedSignatures=next.filter{it.eventId.startsWith("history:")}.mapNotNull{nativeEventSignature(it)}.groupingBy{it}.eachCount()
    val previousSignatures=previous.mapNotNull{nativeEventSignature(it)}.groupingBy{it}.eachCount()
    val missing=previous.filter{event->
        val signature=nativeEventSignature(event)
        event.eventId.isNotBlank()&&event.eventId !in ids&&!event.eventId.startsWith("history:")&&
            !(event.type=="user.message"&&event.requestId.isNotBlank()&&event.requestId in submitted)&&
            item(event) !in snapshots&&
            !(event.type=="context.compaction"&&item(event) in compactedItems)&&
            !(signature!=null&&savedSignatures[signature]==1&&previousSignatures[signature]==1)&&
            (item(event) in rawItems||event.createdAt.isBlank()||event.createdAt>(historyCutoffs[event.type]?:""))
    }.map{it.eventId}.toSet()
    // Use shared event IDs as insertion anchors. Identical text fragments remain
    // distinct, and missing suffixes stay after the shared prefix, not before it.
    val positions=next.mapIndexed{index,event->event.eventId to index}.toMap()
    val requestPositions=next.mapIndexedNotNull{index,event->event.requestId.takeIf{event.type=="user.message"&&it.isNotBlank()}?.let{it to index}}
        .groupBy({it.first},{it.second}).filterValues{it.size==1}.mapValues{it.value.single()}
    val itemPositions=next.mapIndexedNotNull{index,event->item(event)?.let{it to index}}
        .groupBy({it.first},{it.second}).filterValues{it.size==1}.mapValues{it.value.single()}
    val before=mutableMapOf<Int,MutableList<ChatEvent>>()
    var anchor=next.size
    for(event in previous.asReversed()){
        val position=positions[event.eventId]?:requestPositions[event.requestId].takeIf{event.type=="user.message"}?:
            itemPositions[item(event)].takeIf{event.eventId !in missing}
        position?.let{anchor=it}
        if(event.eventId in missing)before.getOrPut(anchor){mutableListOf()}.add(event)
    }
    val merged=buildList{
        next.forEachIndexed{index,event->before[index]?.asReversed()?.let{addAll(it)};add(event)}
        before[next.size]?.asReversed()?.let{addAll(it)}
    }
    return retainNativeCompaction(previous,if(hasMore)retainNativeHistoryPrefix(previous,merged) else merged)
}
// History snapshots can lag live notifications. Keep a started compaction until
// its terminal notification (or turn termination), even across polling refreshes.
internal fun retainNativeCompaction(previous:List<ChatEvent>,next:List<ChatEvent>):List<ChatEvent>{
    val active=previous.lastOrNull{it.type in TimelineTypes.compactionBoundary}?.takeIf{it.type=="context.compaction"&&it.status=="running"}?:return next
    if(next.any{it.eventId.isNotBlank()&&it.eventId==active.eventId})return next
    val known=previous.map{it.eventId}.filter{it.isNotBlank()}.toSet()
    if(next.any{it.type in TimelineTypes.compactionBoundary&&it.eventId !in known&&(it.createdAt.isBlank()||active.createdAt.isBlank()||it.createdAt>=active.createdAt)})return next
    val position=next.indexOfFirst{it.createdAt.isNotBlank()&&active.createdAt.isNotBlank()&&it.createdAt>active.createdAt}.let{if(it<0)next.size else it}
    return next.toMutableList().apply{add(position,active)}
}
internal fun nativeActivityRunning(activities:List<ChatEvent>,events:List<ChatEvent>,running:Boolean):Boolean {
    if(!running)return false
    val latest=events.lastOrNull{it.type in TimelineTypes.activityIndicator}?:return false
    if(latest.type in TimelineTypes.idleIndicator)return false
    if(latest in activities)return true
    if(latest.type!="reasoning.summary")return false
    // Adjacent reasoning deltas are merged for display, retaining the first event ID.
    return activities.any{entry->
        if(entry.type!="reasoning.summary"||entry.itemId.isBlank()||entry.itemId!=latest.itemId)false
        else {
            val start=events.indexOfFirst{it.eventId.isNotBlank()&&it.eventId==entry.eventId}
            start>=0&&events.subList(start,events.indexOf(latest)+1).all{it.type==entry.type&&it.itemId==entry.itemId}
        }
    }
}
// A rollout marker is written during a live compaction, but lacks its item ID.
// Match only a unique marker within that item's lifecycle; no proximity window
// can safely identify two actual compactions that happen close together.
private val compactionCitation=Regex("<oai-mem-citation>[\\s\\S]*?(?:</oai-mem-citation>|$)")
private fun canonicalNativeCompactionText(text:String)=text.replace(compactionCitation,"").replace("\r\n","\n").trim()
private fun preserveNativeCompactionKeys(previous:List<ChatEvent>,incoming:List<ChatEvent>):List<ChatEvent>{
    fun realItem(event:ChatEvent)=event.itemId.takeUnless{it.isBlank()||it.startsWith("history:")}
    val markers=mutableListOf<Int>()
    incoming.forEachIndexed{index,event->
        if(event.type=="context.compaction"&&event.eventId.startsWith("history:")&&realItem(event)==null&&event.status!="running")markers.add(index)
    }
    if(markers.isEmpty())return incoming
    val all=previous+incoming
    val groups=all.filter{it.type=="context.compaction"&&realItem(it)!=null}.groupBy{it.threadId to realItem(it)!!}
    if(groups.isEmpty())return incoming
    val times=mutableMapOf<String,Long?>()
    fun time(event:ChatEvent):Long?{
        val text=event.createdAt
        if(text in times)return times[text]
        return runCatching{java.time.Instant.parse(text).toEpochMilli()}.getOrNull().also{times[text]=it}
    }
    val boundaries=all.filter{it.type in TimelineTypes.turnBoundary||it.type=="context.compaction"&&it.status=="running"}.groupBy{it.threadId}
    data class Window(val start:Long?,val finish:Long?=null,val boundary:Long?=null)
    val windows=mutableMapOf<Pair<String,String>,Window>()
    fun window(key:Pair<String,String>,rows:List<ChatEvent>)=windows.getOrPut(key){
        val start=rows.filter{it.status=="running"}.mapNotNull(::time).minOrNull()
        if(start==null)Window(null) else Window(start,
            rows.filter{it.status!="running"}.mapNotNull(::time).maxOrNull(),
            boundaries[key.first].orEmpty().filter{it.type in TimelineTypes.turnBoundary||realItem(it)!=key.second}.mapNotNull(::time).filter{it>start}.minOrNull())
    }
    val matches=mutableMapOf<Int,Pair<String,String>>()
    val summaries=mutableMapOf<ChatEvent,String>()
    fun summary(event:ChatEvent)=summaries.getOrPut(event){canonicalNativeCompactionText(event.text)}
    markers.forEach{index->
        val event=incoming[index]
        val at=time(event)?:return@forEach
        val candidates=groups.filter{(key,rows)->
            if(key.first!=event.threadId||event.turnId.isNotBlank()&&rows.any{it.turnId.isNotBlank()&&it.turnId!=event.turnId})return@filter false
            if(rows.any{sameNativeCompaction(it,event)})return@filter true
            // A reconnect can see only item/completed. Its full summary still
            // identifies a unique rollout marker without needing item/started.
            if(summary(event).isNotEmpty()&&rows.any{row->row.status!="running"&&summary(row)==summary(event)&&time(row)?.let{done->
                boundaries[event.threadId].orEmpty().none{boundary->
                    (boundary.type!="context.compaction"||realItem(boundary)!=key.second)&&
                        time(boundary)?.let{it>minOf(at,done)&&it<=maxOf(at,done)}==true
                }
            }==true})return@filter true
            val bounds=window(key,rows)
            val start=bounds.start?:return@filter false
            at>=start&&(bounds.finish==null||at<=bounds.finish)&&(bounds.boundary==null||at<bounds.boundary)
        }.keys
        if(candidates.size==1)matches[index]=candidates.single()
    }
    val counts=matches.values.groupingBy{it}.eachCount()
    return incoming.mapIndexed{index,event->
        val key=matches[index]?.takeIf{counts[it]==1}?:return@mapIndexed event
        val rows=groups.getValue(key)
        val prior=rows.first()
        // The transcript can write an empty marker before item/completed arrives.
        // Keep the live phase; a saved summary or terminal notification ends it.
        val pendingMarker=event.text.isBlank()&&event.detail.isBlank()&&rows.any{it.status=="running"}&&
            rows.none{!it.eventId.startsWith("history:")&&it.status!="running"}
        event.copy(itemId=key.second,status=if(pendingMarker)"running" else event.status,
            displayKey=prior.displayKey.ifBlank{"context.compaction:item:${key.second}"},turnId=event.turnId.ifBlank{rows.lastOrNull{it.turnId.isNotBlank()}?.turnId.orEmpty()})
    }
}
internal fun nativeCompactionRunning(events:List<ChatEvent>,threadId:String):Boolean{
    val phases=events.filter{it.threadId==threadId&&it.type in TimelineTypes.compactionState}
    if(phases.none{it.type=="context.compaction"})return false
    // Reconnection matching only needs compaction phases and turn boundaries.
    // Keep colliding IDs so duplicate suppression still sees the original order.
    val ids=phases.map{it.eventId}.filter{it.isNotBlank()}.toSet()
    val relevant=if(ids.isEmpty())phases else events.filter{
        it.threadId==threadId&&(it.type in TimelineTypes.compactionState||it.eventId in ids)
    }
    return nativeReconnectEvents(relevant).lastOrNull{it.type in TimelineTypes.compactionBoundary}
        ?.let{it.type=="context.compaction"&&it.status=="running"}==true
}
private fun sameNativeCompaction(left:ChatEvent,right:ChatEvent):Boolean {
    if(left.type!="context.compaction"||right.type!=left.type||left.threadId!=right.threadId)return false
    if(left.turnId.isNotBlank()&&right.turnId.isNotBlank()&&left.turnId!=right.turnId)return false
    if(left.eventId.isNotBlank()&&left.eventId==right.eventId)return true
    val a=left.itemId.takeUnless{it.isBlank()||it.startsWith("history:")}
    val b=right.itemId.takeUnless{it.isBlank()||it.startsWith("history:")}
    if(a!=null&&b!=null)return a==b
    // Rollout line IDs can change between cached and refreshed history. The
    // original timestamp identifies that record without merging later compactions.
    return left.createdAt.isNotBlank()&&left.createdAt==right.createdAt
}
internal fun nativeReconnectEvents(events:List<ChatEvent>):List<ChatEvent>{
    val result=mutableListOf<ChatEvent>()
    val compactions=mutableListOf<Int>()
    val ids=mutableSetOf<String>()
    var pending:Int?=null
    fun finish(title:String){pending?.let{i->result[i]=result[i].copy(title=title)};pending=null}
    fun detail(event:ChatEvent)=listOf(event.title,event.detail.ifBlank{event.text}).filter{it.isNotBlank()}.joinToString("\n")
    for(event in preserveNativeCompactionKeys(events,events)){
        if(event.eventId.isNotBlank()&&!ids.add(event.eventId))continue
        if(event.type=="context.compaction"){
            val duplicate=compactions.asReversed().firstOrNull{sameNativeCompaction(result[it],event)}
            if(duplicate!=null){
                val previous=result[duplicate]
                if(previous.status=="running"||event.status!="running")result[duplicate]=event.copy(
                    displayKey=previous.displayKey.ifBlank{previous.itemId.takeUnless{it.isBlank()||it.startsWith("history:")}?.let{"${previous.type}:item:$it"}?:previous.eventId},
                    itemId=event.itemId.takeUnless{it.isBlank()||it.startsWith("history:")}?:previous.itemId,
                    text=event.text.ifBlank{previous.text},detail=event.detail.ifBlank{previous.detail},
                    turnId=event.turnId.ifBlank{previous.turnId})
                continue
            }
        }
        val retry=pending?.let{result[it]}
        if(retry!=null&&retry.turnId.isNotBlank()&&event.turnId.isNotBlank()&&retry.turnId!=event.turnId)finish("重试记录")
        if(event.type in TimelineTypes.retryBoundary)finish("重试记录")
        if(event.type=="error"&&event.willRetry){
            val index=pending
            if(index==null){pending=result.size;result.add(event.copy(title="正在重试",detail=detail(event)))}
            else {
                result[index]=result[index].copy(detail=result[index].detail+"\n\n"+detail(event))
            }
            continue
        }
        // Tool output may belong to a command started before the disconnect.
        // New model output or a successful turn proves that generation resumed.
        if(event.type in TimelineTypes.text&&event.text.isNotBlank())finish("执行已恢复")
        if(event.type=="error"&&!event.willRetry)finish("重试未成功")
        if(event.type=="turn.completed")finish(when(event.status){"completed","ok","success"->"执行已恢复";"interrupted","stopped"->"重试已停止";"failed","error"->"重试未成功";else->"重试记录"})
        result.add(event)
        if(event.type=="context.compaction")compactions.add(result.lastIndex)
    }
    return foldNativeCompactionSummaries(result)
}
internal fun foldNativeCompactionSummaries(events:List<ChatEvent>):List<ChatEvent>{
    fun canonical(text:String)=canonicalNativeCompactionText(text)
    val hidden=mutableSetOf<Int>()
    events.forEachIndexed{index,compact->
        if(compact.type!="context.compaction"||compact.text.isBlank())return@forEachIndexed
        for(i in index-1 downTo 0){
            val event=events[i]
            if(event.threadId!=compact.threadId)continue
            if(event.type in TimelineTypes.summaryBoundary)break
            if(event.type!="message.delta")continue
            var start=i
            if(!event.textComplete&&event.itemId.isNotBlank())while(start>0){
                val prior=events[start-1]
                if(prior.type!="message.delta"||prior.threadId!=event.threadId||prior.itemId!=event.itemId||prior.textComplete)break
                start--
            }
            if(canonical(events.subList(start,i+1).joinToString(""){it.text})==canonical(compact.text))hidden.addAll(start..i)
            break
        }
    }
    return if(hidden.isEmpty())events else events.filterIndexed{index,_->index !in hidden}
}
internal fun orderNativeTurnEvents(events:List<ChatEvent>):List<ChatEvent>{
    val activityTypes=TimelineTypes.activity
    val starts=mutableMapOf<String,Int>();val ends=mutableMapOf<String,Int>()
    val owners=mutableMapOf<Int,String>();val items=mutableMapOf<String,String>()
    val duplicate=mutableSetOf<Int>();val replacements=mutableMapOf<Int,ChatEvent>();val aliases=mutableMapOf<String,String>()
    var active:String?=null;var recent:String?=null
    events.forEachIndexed{index,event->when(event.type){
        "turn.started"->{
            val id=event.turnId.ifBlank{"start:$index"}
            if(id in starts)duplicate.add(index)
            else {starts[id]=index;active=id;recent=id}
        }
        "user.message"->if(active==null)recent=null
        "turn.completed"->{
            if(event.turnId.isNotBlank()&&active?.startsWith("start:")==true&&event.turnId !in starts)aliases[event.turnId]=active!!
            val id=aliases[event.turnId]?:event.turnId.ifBlank{active?:recent.orEmpty()}
            if(id.isNotBlank()){
                val prior=ends[id]
                if(prior==null)ends[id]=index
                else {duplicate.add(index);if(event.eventId.startsWith("history:")&&!events[prior].eventId.startsWith("history:"))replacements[prior]=event}
                if(active==id)active=null
            }
        }
        in activityTypes->{
            val id=aliases[event.turnId]?:event.turnId.takeIf{it.isNotBlank()}?:items[event.itemId]?:active?:recent
            if(id!=null){owners[index]=id;if(event.itemId.isNotBlank())items[event.itemId]=id}
        }
    }}
    val moved=mutableSetOf<Int>();val before=mutableMapOf<Int,MutableList<ChatEvent>>()
    owners.forEach{(index,id)->ends[id]?.takeIf{it<index}?.let{end->moved.add(index);before.getOrPut(end){mutableListOf()}.add(events[index])}}
    if(moved.isEmpty()&&duplicate.isEmpty())return events
    // Late tool receipts belong before their own terminal marker, including
    // when a later user turn has already started. Never move another turn's work.
    return buildList{events.forEachIndexed{index,event->before[index]?.let{addAll(it)};if(index !in moved&&index !in duplicate)add(replacements[index]?:event)}}
}
fun nativeTimeline(events:List<ChatEvent>, threadId:String, warnings:Boolean=false, running:Boolean=false):List<NativeBlock> {
    val result=mutableListOf<NativeBlock>()
    val runningCompactions=mutableSetOf<Int>()
    val ids=mutableSetOf<String>()
    val submitted=mutableSetOf<String>()
    val blockKeys=mutableSetOf<String>()
    var boundary=true
    var mergedText:StringBuilder?=null
    fun flushMergedText(){
        val text=mergedText?:return
        val previous=result.last()
        result[result.lastIndex]=previous.copy(event=previous.event.copy(text=text.toString()))
        mergedText=null
    }
    nativeReconnectEvents(orderNativeTurnEvents(events.filter { it.threadId==threadId })).forEachIndexed { index,incoming ->
        val text=if(incoming.type=="user.message"&&incoming.eventId.startsWith("history:"))nativeVisibleHistoryText(incoming.text) else incoming.text
        if(text.isBlank()&&incoming.type=="user.message"&&incoming.images.isEmpty()&&incoming.uploads.isEmpty()&&incoming.attachments.isEmpty())return@forEachIndexed
        val event=if(text==incoming.text)incoming else incoming.copy(text=text)
        if(event.eventId.isNotBlank()&&!ids.add(event.eventId))return@forEachIndexed
        if(event.type=="user.message"&&event.requestId.isNotBlank()&&!submitted.add(event.requestId))return@forEachIndexed
        if(event.type in TimelineTypes.text&&event.text.isEmpty()&&event.title.isBlank()&&event.detail.isBlank()&&!event.detailsDeferred&&event.activityGroupId.isBlank())return@forEachIndexed
        val previous=result.lastOrNull()
        if(!boundary&&event.type in TimelineTypes.mergeable&&previous?.event?.type==event.type&&previous.event.itemId==event.itemId&&(event.type!="reasoning.summary"||event.itemId.isNotBlank())){
            if(mergedText==null)mergedText=StringBuilder(previous.event.text)
            mergedText!!.append(event.text)
            return@forEachIndexed
        }
        flushMergedText()
        if(event.type=="turn.completed"){
            runningCompactions.forEach{i->result[i]=result[i].copy(event=result[i].event.copy(status="cancelled"))}
            runningCompactions.clear()
        }
        if(event.type=="context.compaction"&&event.status!="running"){
            val active=runningCompactions.lastOrNull{index->event.itemId.isBlank()||result[index].event.itemId.isBlank()||result[index].event.itemId==event.itemId}
            if(active!=null){result[active]=result[active].copy(event=event);runningCompactions.remove(active);return@forEachIndexed}
        }
        if(event.type in TimelineTypes.turnBoundary) {result.add(NativeBlock("lifecycle:$index",event));boundary=true;return@forEachIndexed}
        if(event.type=="warning"&&!warnings)return@forEachIndexed
        if(event.type !in TimelineTypes.visible){if(event.type in TimelineTypes.turnBoundary)boundary=true;return@forEachIndexed}
        if(!boundary&&previous!=null&&sameNativeCompaction(previous.event,event)) {
            result[result.lastIndex]=previous.copy(event=event)
        } else {
            // Live events and the saved transcript use different event IDs for the same
            // Codex item. Keep its LazyColumn identity when polling replaces the stream.
            val itemKey=event.itemId.takeIf{it.isNotBlank()&&!it.startsWith("history:")}?.let{"${event.type}:item:$it"}
            val preferred=event.displayKey.ifBlank{itemKey.orEmpty()}
            val key=preferred.takeIf{it.isNotBlank()&&blockKeys.add(it)}?:event.eventId.ifBlank { "${event.type}:${event.itemId}:$index" }
            blockKeys.add(key)
            result.add(NativeBlock(key,event,boundary=boundary))
        }
        if(event.type=="context.compaction"){
            if(event.status=="running")runningCompactions.add(result.lastIndex) else runningCompactions.remove(result.lastIndex)
        }
        boundary=false
    }
    flushMergedText()
    val grouped=mutableListOf<NativeBlock>()
    val segment=mutableListOf<NativeBlock>()
    val activityTypes=TimelineTypes.activity
    fun flush(){
        if(segment.isEmpty())return
        grouped.add(segment.first().copy(activities=segment.map{it.event}))
        segment.clear()
    }
    for(block in result){
        if(block.boundary)flush()
        if(block.event.type in activityTypes)segment.add(block)
        else {flush();grouped.add(block)}
    }
    flush()
    val folded=mutableListOf<NativeBlock>();val turn=mutableListOf<NativeBlock>()
    var startedAt=""
    var precedingUser:ChatEvent?=null
    var turnOpen=false
    val turnChanges=mutableListOf<ChatEvent>()
    var changeSummaryKey:String?=null
    fun finish(completed:Boolean,endedAt:String="",terminal:Boolean=false){
        val hasTurn=turn.isNotEmpty()||precedingUser!=null
        val ended=completed||terminal||!running
        turnChanges.addAll(turn.flatMap{it.activities})
        val summaryKey=turn.firstOrNull()?.key
        if(changeSummaryKey==null&&turnChanges.isNotEmpty())changeSummaryKey=summaryKey
        val replyScope=summaryKey.orEmpty()
        val summarize=terminal||!turnOpen&&!running
        val changedFiles=if(summarize)nativeFileChanges(turnChanges,includeLineCounts=false) else emptyList()
        val hasChanges=changedFiles.isNotEmpty()
        if(hasChanges)turn.removeAll{block->block.activities.isNotEmpty()&&block.activities.all{it.type=="diff.updated"&&it.activityGroupId.isBlank()}}
        val finalIndex=turn.indexOfLast{it.event.type=="message.delta"}
        val failedIndex=if(!completed&&(terminal||!running))turn.indexOfLast{it.event.type=="error"&&!it.event.willRetry} else -1
        val retryIndex=if(failedIndex>=0)failedIndex else finalIndex
        if(finalIndex>=0&&(completed||terminal||!running))turn[finalIndex]=turn[finalIndex].copy(copyable=true,endedAt=if(terminal)endedAt else "")
        if(retryIndex>=0&&(completed||terminal||!running))turn[retryIndex]=turn[retryIndex].copy(retryPrompt=precedingUser?.takeIf{it.attachments.isEmpty()&&it.files.isEmpty()&&(it.text.isNotBlank()||it.images.isNotEmpty()||it.uploads.isNotEmpty())},retryFailure=failedIndex>=0)
        val contents=turn.map{if(it.event.type=="message.delta")it.copy(replyScope=replyScope) else it}
        val collapse=ended&&finalIndex>=0
        val collapseCommentary=completed||!terminal&&!running
        fun inside(index:Int,block:NativeBlock)=index!=finalIndex&&block.event.type !in TimelineTypes.outsideCompletedProcess&&
            (block.event.type!="message.delta"||collapseCommentary)
        val children=if(collapse)contents.filterIndexed(::inside) else emptyList()
        val first=if(children.isNotEmpty())contents.indexOfFirst{it===children.first()} else -1
        // One outer disclosure owns the completed turn. Its operation segments
        // retain their own keys and disclosures, interleaved with plain commentary.
        contents.forEachIndexed{index,block->
            if(index==first)folded.add(NativeBlock("completed:$summaryKey",ChatEvent(type="process.completed",threadId=threadId,title=nativeProcessDuration(startedAt,endedAt)),children=children))
            if(!collapse||children.isEmpty()||!inside(index,block))folded.add(block)
        }
        if(hasChanges)folded.add(NativeBlock("files:"+changeSummaryKey,ChatEvent(type="files.summary",threadId=threadId,fileChanges=changedFiles),activities=turnChanges.toList()))
        if(summarize){turnChanges.clear();changeSummaryKey=null}
        if(terminal&&hasTurn&&finalIndex<0&&endedAt.isNotBlank())folded.add(NativeBlock("ended:${summaryKey?:endedAt}",ChatEvent(type="run.ended",threadId=threadId),endedAt=endedAt))
        turn.clear()
        if(terminal||!turnOpen)startedAt=""
        if(terminal){precedingUser=null;turnOpen=false}
    }
    for(block in grouped){
        when(block.event.type){
            "turn.started"->{finish(false);turnChanges.clear();changeSummaryKey=null;turnOpen=true;startedAt=block.event.createdAt}
            "turn.completed"->finish(block.event.status !in TimelineTypes.failedStatus,block.event.createdAt,terminal=true)
            "user.message"->{if(turn.isNotEmpty())finish(false);folded.add(block);precedingUser=block.event.takeUnless{nativeScheduledMessage(it)!=null}}
            else->turn.add(block)
        }
    }
    finish(false)
    val newestUser=folded.indexOfLast{it.event.type=="user.message"}
    val newestAnswer=folded.indexOfLast{it.retryPrompt!=null||it.retryFailure}
    return folded.mapIndexed{index,block->if(index==newestAnswer&&index>newestUser&&!running)block else block.copy(retryPrompt=null,retryFailure=false)}
}
fun nativeProcessDuration(start:String,end:String):String {
    val seconds=runCatching{java.time.Duration.between(java.time.Instant.parse(start),java.time.Instant.parse(end)).seconds}.getOrNull()?:return "处理过程"
    if(seconds<0)return "处理过程"
    return if(seconds<60)"用时 ${seconds}秒" else "用时 ${seconds/60}分 ${seconds%60}秒"
}
private fun nativeVisibleHistoryText(input:String):String {
    val aborted=Regex("^<turn_aborted>\\s*The user interrupted the previous turn on purpose\\.[\\s\\S]*?</turn_aborted>\\s*$",RegexOption.IGNORE_CASE)
    if(aborted.matches(input.trim()))return ""
    var removed=false
    val ambient=Regex("<in-app-browser-context source=\"ambient-ui-state\">([\\s\\S]*?)</in-app-browser-context>\\s*",RegexOption.IGNORE_CASE)
    var text=ambient.replace(input){match->
        if(match.groupValues[1].contains("This block is automatically supplied ambient UI state")){removed=true;""}else match.value
    }.trim()
    if(removed)text=text.replaceFirst(Regex("^## My request(?: for Codex)?:\\s*",RegexOption.IGNORE_CASE),"")
    return text.trim()
}
fun nativeQueueError(value:String):String {
    if(value.contains("thread not found",true))return "会话连接已失效，消息已保留，请重试"
    if(value.contains("active writer",true)||value.contains("桌面版仍持有"))return "等待桌面会话连接，消息已保留"
    if(value.contains("timeout",true)||value.contains("超时"))return "连接超时，消息已保留，请重试"
    return value
}
fun nativePath(path:String)=path.replace('\\','/').removePrefix("//?/").trimEnd('/').lowercase()
