package com.localcodex.control

internal enum class NativePerformanceStage { RESUME, SOCKET_VERIFIED, SOCKET_OPEN, HISTORY_READY, SEND_READY }
internal enum class NativeNetworkOperation { HEALTH, SOCKET, HISTORY, MODELS, SIDEBAR }
internal enum class NativePerformanceRoute { LOCAL, PUBLIC }
internal data class NativePerformanceMark(val cycle:Int,val stage:NativePerformanceStage,val atMs:Long)
internal data class NativeComposerMark(val cycle:Int,val gate:NativeComposerGate,val atMs:Long)
internal data class NativeNetworkTiming(
    val operation:NativeNetworkOperation,val route:NativePerformanceRoute,val atMs:Long,val durationMs:Long,
    val dnsMs:Long,val connectMs:Long,val tlsMs:Long,val firstByteMs:Long?,val status:Int?,val error:String?,
)
internal data class NativeNetworkTimingTicket(val session:Long,val operation:NativeNetworkOperation,val route:NativePerformanceRoute,val startedAt:Long)
internal data class NativePerformanceReport(
    val session:Long,val elapsedMs:Long,val frames:Long,val overBudgetFrames:Long,val droppedSamples:Long,
    val retainedFrameSamples:Int,val p50Ms:Double,val p95Ms:Double,val p99Ms:Double,val maxMs:Double,
    val marks:List<NativePerformanceMark>,val network:List<NativeNetworkTiming>,val dialogFrames:Long,
    val composer:List<NativeComposerMark>,
)

// Frame callbacks mutate only bounded plain data. No frame-rate Compose state,
// allocation, disk writes, URLs or conversation identifiers enter this store.
internal class NativePerformanceSession(private val now:()->Long) {
    @Volatile var active=false;private set
    @Volatile var session=0L;private set
    private var startedAt=0L
    private var cycle=0
    private var frames=0L
    private var dialogFrames=0L
    private var overBudget=0L
    private var dropped=0L
    private var maxNanos=0L
    private val durations=LongArray(8192)
    private val marked=mutableSetOf<NativePerformanceStage>()
    private val marks=ArrayDeque<NativePerformanceMark>()
    private val network=ArrayDeque<NativeNetworkTiming>()
    private val composer=ArrayDeque<NativeComposerMark>()
    private var lastComposerGate:NativeComposerGate?=null

    @Synchronized fun start():Long {
        session++;active=true;startedAt=now();cycle=0;frames=0;dialogFrames=0;overBudget=0;dropped=0;maxNanos=0
        marked.clear();marks.clear();network.clear();composer.clear();lastComposerGate=null
        return session
    }
    @Synchronized fun resume(){
        if(!active||expired())return
        cycle++;marked.clear();lastComposerGate=null;mark(NativePerformanceStage.RESUME)
    }
    @Synchronized fun mark(stage:NativePerformanceStage){
        if(!active||expired()||!marked.add(stage))return
        if(marks.size==128)marks.removeFirst()
        marks.addLast(NativePerformanceMark(cycle,stage,now()-startedAt))
    }
    @Synchronized fun composer(gate:NativeComposerGate){
        if(!active||expired()||gate==lastComposerGate)return
        lastComposerGate=gate
        if(composer.size==128)composer.removeFirst()
        composer.addLast(NativeComposerMark(cycle,gate,now()-startedAt))
        if(gate==NativeComposerGate.READY)mark(NativePerformanceStage.SEND_READY)
    }
    @Synchronized fun frame(owner:Long,durationNanos:Long,budgetNanos:Long,droppedSamples:Int,dialog:Boolean=false){
        if(!active||expired()||owner!=session||durationNanos<=0||budgetNanos<=0)return
        durations[(frames%durations.size).toInt()]=durationNanos
        frames++;if(dialog)dialogFrames++;if(durationNanos>budgetNanos)overBudget++
        dropped+=droppedSamples.coerceAtLeast(0);maxNanos=maxOf(maxNanos,durationNanos)
    }
    @Synchronized fun beginNetwork(operation:NativeNetworkOperation,route:NativePerformanceRoute):NativeNetworkTimingTicket? =
        if(active&&!expired())NativeNetworkTimingTicket(session,operation,route,now()) else null
    @Synchronized fun endNetwork(ticket:NativeNetworkTimingTicket,dnsMs:Long,connectMs:Long,tlsMs:Long,firstByteMs:Long?,status:Int?,error:String?){
        if(!active||expired()||ticket.session!=session)return
        if(network.size==128)network.removeFirst()
        network.addLast(NativeNetworkTiming(ticket.operation,ticket.route,ticket.startedAt-startedAt,now()-ticket.startedAt,dnsMs,connectMs,tlsMs,firstByteMs,status,error))
    }
    // Called off the UI thread once collection has stopped.
    @Synchronized fun finish():NativePerformanceReport? {
        if(!active)return null
        active=false
        val count=minOf(frames,durations.size.toLong()).toInt()
        val sorted=durations.copyOf(count).apply{sort()}
        fun percentile(p:Double)=if(count==0)0.0 else sorted[(kotlin.math.ceil(count*p).toInt()-1).coerceIn(0,count-1)]/1_000_000.0
        return NativePerformanceReport(session,(now()-startedAt).coerceAtMost(60000),frames,overBudget,dropped,count,percentile(.5),percentile(.95),percentile(.99),maxNanos/1_000_000.0,marks.toList(),network.toList(),dialogFrames,composer.toList())
    }
    @Synchronized fun expired()=active&&now()-startedAt>=60000
}
