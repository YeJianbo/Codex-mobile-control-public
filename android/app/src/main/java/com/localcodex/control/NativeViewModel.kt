package com.localcodex.control

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.util.UUID

private data class NativePending(val id:String,val threadId:String,val selection:Int,val text:String,val images:List<NativeImage>,val uploads:List<NativeUploadedFile>,val plan:Boolean=false,val restoreDraft:Boolean=true,
    val address:String="",val draftKey:String="",val projectId:String="",val model:String="",val effort:String="",val permission:String="full",val mode:String="",val fast:Boolean?=null,val submittedAt:String=java.time.Instant.now().toString(),val uncertain:Boolean=true,val failure:String="",val wireCommand:String="",val goal:Boolean=false,val certificateSha256:String?=null)
class NativeViewModel(application:Application):AndroidViewModel(application) {
    suspend fun managementRequest(route:String,body:JSONObject?=null):JSONObject {
        val api=client?:throw IllegalStateException("尚未连接电脑")
        if(!state.connected)throw IllegalStateException("连接电脑后使用管理功能")
        val epoch=generation
        val result=api.managementRequest(route,body)
        if(epoch!=generation||client!==api)throw CancellationException("电脑连接已变化")
        return result
    }
    private val accounts=NativeAccountsController(viewModelScope,{
        val api=client
        if(api==null||!state.connected)null else {
            val epoch=generation
            NativeAccountConnection(api){client===api&&generation==epoch}
        }
    },::nativeError)
    val accountsState:NativeAccountsState get()=accounts.state
    fun loadAccounts(service:String)=accounts.load(service)
    internal fun cancelAccountRead(service:String)=accounts.cancelRead(service)
    fun accountAction(service:String,action:String,body:JSONObject)=accounts.action(service,action,body)
    fun dismissAccountConfirmation()=accounts.dismissConfirmation()
    var subagentClose by mutableStateOf(NativeSubagentCloseState());private set
    fun dismissSubagentClose(){if(!subagentClose.busy)subagentClose=NativeSubagentCloseState()}
    private fun managementConnection():NativeManagementConnection?{
        val api=client?:return null
        if(!state.connected)return null
        val epoch=generation
        return NativeManagementConnection(api){client===api&&generation==epoch}
    }
    private val agentHealthController=NativeAgentHealthController(viewModelScope,::managementConnection,::nativeError,::consoleError)
    val agentHealth:NativeAgentHealthState get()=agentHealthController.state
    fun setHarnessPublicAccess(agent:String,enabled:Boolean)=agentHealthController.setPublicAccess(agent,enabled)
    fun loadAgentHealth(force:Boolean=false):Job?=agentHealthController.load(force)
    fun checkAgentUpdates():Job?=agentHealthController.checkUpdates()
    private val networkController=NativeNetworkController(viewModelScope,::managementConnection,::nativeError)
    internal val networkState:NativeNetworkState get()=networkController.state
    private fun resetNetwork()=networkController.reset()
    fun loadNetwork()=networkController.load()
    fun selectNetworkNode(group:String,node:String)=networkController.selectNode(group,node)
    fun testNetworkNode(group:String,node:String)=networkController.testNode(group,node)
    internal val readingPositions=NativeReadingPositions()
    internal val readingHistoryWindow get()=historyTurns
    private val store=ConnectionStore(application)
    private val localStorage=NativeLocalStorage(application)
    internal var storageState by mutableStateOf(NativeStorageState(limitMb=localStorage.limitMb()));private set
    internal var uploadStorageState by mutableStateOf(NativeUploadStorageState());private set
    private val uploadDraftMutex=Mutex()
    private var uploadDraftJob:Job?=null
    private fun uploadDraftBody():JSONObject {
        val records=(failedSends.values.toList()+listOfNotNull(pending)).filter(::sameComputer)
        val refs=store.uploadDraftRefs(state.address,state.certificateSha256)+
            (state.images+records.flatMap{it.images}).map{JSONObject().put("kind","image").put("id",it.id)}+
            (state.uploads+records.flatMap{it.uploads}).map{JSONObject().put("kind","file").put("id",it.id)}
        return JSONObject().put("owner",store.uploadOwner()).put("items",org.json.JSONArray(refs.distinctBy{it.toString()}))
    }
    private fun scheduleUploadDraftSync(){
        if(!state.connected||state.uploading)return
        uploadDraftJob?.cancel()
        uploadDraftJob=viewModelScope.launch{
            delay(250)
            try{uploadDraftMutex.withLock{val api=client?:return@withLock;val body=uploadDraftBody();withContext(Dispatchers.IO){api.nativeJson("PUT","/api/uploads/drafts",body)}}}
            catch(error:CancellationException){throw error}catch(_:Exception){/* A later refresh retries; existing pins remain protective. */}
        }
    }
    internal fun refreshUploadStorage(items:List<NativeStoredUpload>?=null){
        val api=client?:run{uploadStorageState=uploadStorageState.copy(error="请先连接电脑");return}
        if(uploadStorageState.busy||state.uploading)return
        val epoch=generation
        uploadStorageState=uploadStorageState.copy(busy=true,error="",message="")
        viewModelScope.launch{
            try{
                val result=uploadDraftMutex.withLock{
                    if(client!==api||epoch!=generation)throw CancellationException()
                    val body=uploadDraftBody()
                    withContext(Dispatchers.IO){
                        api.nativeJson("PUT","/api/uploads/drafts",body)
                        val cleaned=items?.let{rows->api.nativeJson("POST","/api/uploads/cleanup",JSONObject().put("items",org.json.JSONArray(rows.map{JSONObject().put("kind",it.kind).put("id",it.id)})))}
                        api.nativeJson("GET","/api/uploads/storage") to cleaned
                    }
                }
                if(client===api&&epoch==generation){
                    val (listing,cleaned)=result;val rows=listing.getJSONArray("items")
                    val message=cleaned?.let{"已清理 ${it.optInt("deletedCount")} 个附件 · 跳过 ${it.optJSONArray("skipped")?.length()?:0} 个 · 失败 ${it.optJSONArray("failed")?.length()?:0} 个"}.orEmpty()
                    uploadStorageState=NativeUploadStorageState((0 until rows.length()).map{rows.getJSONObject(it).let{row->NativeStoredUpload(row.getString("kind"),row.getString("id"),row.getString("name"),row.getLong("size"),row.getString("createdAt"),row.optString("protectedReason"))}},listing.getLong("totalBytes"),listing.optString("blockedReason"),message=message)
                }
            }catch(error:CancellationException){if(client===api)uploadStorageState=uploadStorageState.copy(busy=false);throw error}
            catch(error:Exception){if(client===api&&epoch==generation)uploadStorageState=uploadStorageState.copy(busy=false,error=nativeError(error))}
        }
    }
    private val originalImageLoads=NativeSharedLoads<Pair<Long,String>,ByteArray>(viewModelScope)
    private val checkedImageFiles=mutableSetOf<String>()
    private fun cacheScope()=store.baseUrl()+"\u0000"+store.certificateSha256()+"\u0000"+store.token()
    private fun storageWork(action:()->String){
        if(storageState.busy)return
        storageState=storageState.copy(busy=true,error="",message="")
        viewModelScope.launch{
            try{val result=withContext(Dispatchers.IO){val message=action();localStorage.snapshot().copy(message=message)};storageState=result}
            catch(error:CancellationException){throw error}
            catch(error:Exception){storageState=storageState.copy(busy=false,error=error.message?:"无法读取本地缓存")}
        }
    }
    internal fun refreshStorage()=storageWork{""}
    internal fun setCacheLimit(value:Int)=storageWork{localStorage.setLimit(value);"缓存上限已保存"}
    internal fun clearStorage(){
        if(state.fileBusy){storageState=storageState.copy(error="文件处理完成后再清理缓存");return}
        storageWork{
            localStorage.clear()
            synchronized(imageCacheLock){thumbnailCache.evictAll();previewCache.evictAll();imageDimensions.evictAll();checkedImageFiles.clear()}
            "未使用的缓存已清理"
        }
    }
    internal suspend fun originalImageBytes(endpoint:String):ByteArray {
        val epoch=imageEpoch.get();val scope=cacheScope()
        return originalImageLoads.get(epoch to endpoint){
            val revision=localStorage.revision
            val cached=localStorage.image(scope,endpoint)
            if(cached!=null&&(!state.connected||synchronized(imageCacheLock){endpoint in checkedImageFiles}))return@get cached
            val api=client
            check(state.connected&&api!=null){"连接已断开"}
            val bytes=try{api.nativeImageBytes(endpoint)}catch(error:java.io.IOException){if(cached!=null)return@get cached else throw error}
            currentCoroutineContext().ensureActive()
            if(imageEpoch.get()!=epoch)throw CancellationException("图片连接已切换")
            val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true}
            android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
            require(bounds.outWidth>0&&bounds.outHeight>0){"图片格式无法解码"}
            // A full disk should not prevent an already downloaded image from being displayed or saved.
            val stored=runCatching{localStorage.putImage(scope,endpoint,bytes,revision)}.getOrDefault(false)
            if(stored)synchronized(imageCacheLock){if(imageEpoch.get()==epoch){checkedImageFiles.add(endpoint);if(checkedImageFiles.size>2048)checkedImageFiles.remove(checkedImageFiles.first())}}
            bytes
        }
    }
    internal val thumbnailCache=object:android.util.LruCache<String,Pair<android.graphics.Bitmap,String>>(16*1024){
        override fun sizeOf(key:String,value:Pair<android.graphics.Bitmap,String>)=(value.first.byteCount/1024).coerceAtLeast(1)
    }
    private val previewCache=object:android.util.LruCache<Pair<String,Int>,Pair<android.graphics.Bitmap,String>>(32*1024){
        override fun sizeOf(key:Pair<String,Int>,value:Pair<android.graphics.Bitmap,String>)=((value.first.byteCount+1023)/1024).coerceAtLeast(1)
    }
    private val imageDimensions=android.util.LruCache<String,android.util.Size>(256)
    private val imageLoads=NativeSharedLoads<Triple<Long,String,Int>,Pair<android.graphics.Bitmap,String>>(viewModelScope)
    private val imageEpoch=java.util.concurrent.atomic.AtomicLong()
    private val imageCacheLock=Any()
    internal var imageRevision by mutableStateOf(0L);private set
    private fun clearImageLoads(){
        synchronized(imageCacheLock){imageRevision=imageEpoch.incrementAndGet();thumbnailCache.evictAll();previewCache.evictAll();imageDimensions.evictAll();checkedImageFiles.clear()}
        imageLoads.clear()
        originalImageLoads.clear()
    }
    internal fun cachedImage(endpoint:String,maxSide:Int):Pair<android.graphics.Bitmap,String>?=synchronized(imageCacheLock){
        if(maxSide==512)thumbnailCache.get(endpoint) else previewCache.get(endpoint to maxSide)
    }
    internal fun cachedImageDimensions(endpoint:String):android.util.Size?=synchronized(imageCacheLock){imageDimensions.get(endpoint)}
    internal suspend fun loadImage(endpoint:String,maxSide:Int):Pair<android.graphics.Bitmap,String> {
        require(maxSide>0)
        val epoch:Long
        synchronized(imageCacheLock){
            epoch=imageEpoch.get()
            cachedImage(endpoint,maxSide)?.let{return it}
        }
        return imageLoads.get(Triple(epoch,endpoint,maxSide)){
            synchronized(imageCacheLock){
                if(imageEpoch.get()!=epoch)throw CancellationException("图片连接已切换")
                cachedImage(endpoint,maxSide)?.let{return@get it}
            }
            val bytes=originalImageBytes(endpoint)
            currentCoroutineContext().ensureActive()
            val bounds=android.graphics.BitmapFactory.Options().apply{inJustDecodeBounds=true}
            android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
            require(bounds.outWidth>0&&bounds.outHeight>0){"图片格式无法解码"}
            var sample=1
            while(bounds.outWidth/sample>maxSide||bounds.outHeight/sample>maxSide)sample*=2
            val bitmap=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size,android.graphics.BitmapFactory.Options().apply{inSampleSize=sample})?:kotlin.error("图片格式无法解码")
            currentCoroutineContext().ensureActive()
            val result=bitmap to (bounds.outMimeType?:"image/png")
            synchronized(imageCacheLock){
                if(imageEpoch.get()!=epoch)throw CancellationException("图片连接已切换")
                imageDimensions.put(endpoint,android.util.Size(bounds.outWidth,bounds.outHeight))
                if(maxSide==512)thumbnailCache.put(endpoint,result) else previewCache.put(endpoint to maxSide,result)
            }
            result
        }
    }
    // Keep explicit disclosure choices when lazy rows leave the viewport or move into a completed turn.
    private val timelineDisclosures=LinkedHashMap<Triple<String,String,String>,androidx.compose.runtime.MutableState<Boolean>>(16,0.75f,true)
    internal fun timelineDisclosure(threadId:String,kind:String,id:String,initial:Boolean=false):androidx.compose.runtime.MutableState<Boolean>{
        val value=timelineDisclosures.getOrPut(Triple(threadId,kind,id)){mutableStateOf(initial)}
        while(timelineDisclosures.size>2000)timelineDisclosures.remove(timelineDisclosures.keys.first())
        return value
    }
    private val prefs=application.getSharedPreferences("native",0)
    private val modelServiceNotices=ModelServiceNoticeTracker()
    private val eventIndex=NativeEventIndex()
    private val eventBuffer=NativeEventBuffer()
    fun dismissModelServiceNotice(){state=state.copy(modelServiceNotice=null)}
    private var currentState by mutableStateOf(NativeState(route=store.route(),harness=prefs.getString("harness","codex")?:"codex",address=store.baseUrl().trimEnd('/'),publicUrl=store.publicUrl(),remotePassword=store.remotePassword(),certificateSha256=store.certificateSha256(),permission=prefs.getString("permission","full")?:"full"))
    var state:NativeState
        get()=currentState
        private set(value){
            val previous=currentState
            if(previous.events!==value.events){eventIndex.onEventsChanged(value.events);eventBuffer.onEventsChanged(value.events)}
            currentState=value
            if(previous.threadId!=value.threadId)client?.focusEvents(value.threadId)
            if(previous.connected&&!value.connected||previous.address!=value.address||previous.certificateSha256!=value.certificateSha256)uploadStorageState=NativeUploadStorageState()
            // Streaming text does not write preferences. Only attachment edits
            // within one draft persist here; navigation restores its own draft.
            if((previous.images!==value.images||previous.uploads!==value.uploads)&&attachmentScope(previous)==attachmentScope(value)){
                store.saveAttachmentDraft(attachmentScope(value),value.images,value.uploads)
                scheduleUploadDraftSync()
            }
            if(value.connected&&(!previous.connected||previous.uploading&&!value.uploading))scheduleUploadDraftSync()
            if(value.recoveryVersion!=previous.recoveryVersion)scheduleUploadDraftSync()
        }
    var client:GatewayClient?=null
        private set
    private var connection:Job?=null
    private var connectionRetry:(()->Unit)?=null
    private var polling:Job?=null
    private val pollingWake=Channel<Unit>(Channel.CONFLATED)
    private var localRouteProbe:Job?=null
    private var foregroundSocketCheck:Job?=null
    private var preferLocalReconnect=false
    private var nextLocalRouteProbeAt=0L
    internal var uiForeground by mutableStateOf(true)
        private set
    private val reconnectWake=Channel<Unit>(Channel.CONFLATED)
    private val networkMonitor=NativeNetworkMonitor(application){
        if(uiForeground&&connection?.isActive==true){
            if(state.connected)verifyForegroundConnection() else requestConnectionRestart()
        }
    }
    private fun requestConnectionRestart(){
        if(connection?.isActive==true){preferLocalReconnect=true;reconnectWake.trySend(Unit)}
    }
    private fun verifyForegroundConnection(){
        foregroundSocketCheck?.cancel()
        val active=client?:return;val epoch=generation
        if("foreground-websocket-probe" !in state.capabilities)return
        foregroundSocketCheck=viewModelScope.launch{
            val alive=active.verifyEventConnection(if(state.activeAddress==state.address)2000L else 5000L)
            if(!alive&&epoch==generation&&client===active)requestConnectionRestart()
        }
    }
    private suspend fun awaitReconnectRetry(attempts:Int){
        withTimeoutOrNull((1000L*attempts).coerceAtMost(15000)){reconnectWake.receive()}
    }
    private val pendingReads=mutableMapOf<String,Long>()
    private val pendingReadJobs=mutableMapOf<String,Job>()
    private var manualUnreadSelection:Int?=null
    private fun applyThreadRead(id:String,readThrough:Long){
        fun read(row:ThreadRecord)=if(row.id==id&&row.completedAt>0&&row.completedAt<=readThrough)row.copy(unread=false) else row
        state=state.copy(threads=state.threads.map(::read),projectThreads=state.projectThreads.mapValues{(_,page)->page.copy(rows=page.rows.map(::read))})
    }
    internal fun markResultRead(id:String){
        val api=client?:return
        if(!uiForeground||id!=state.threadId||state.loadingHistory||state.running||manualUnreadSelection==selection||"thread-read-state" !in state.capabilities)return
        val thread=state.threads.find{it.id==id}?:return
        if(!thread.unread||thread.completedAt<=0||pendingReads[id]==thread.completedAt)return
        // A sidebar refresh may arrive before the new result's history.
        if(state.events.none{it.type=="turn.completed"&&runCatching{java.time.Instant.parse(it.createdAt).toEpochMilli()}.getOrDefault(0)>=thread.completedAt})return
        val at=thread.completedAt;val epoch=generation
        pendingReads[id]=at
        pendingReadJobs[id]=viewModelScope.launch{
            try{
                val readThrough=withContext(Dispatchers.IO){api.markThreadRead(id,at)}
                if(epoch==generation&&api===client)applyThreadRead(id,readThrough)
            }catch(e:CancellationException){throw e}catch(_:Exception){/* Retry after the next sidebar refresh. */}
            finally{if(pendingReads[id]==at){pendingReads.remove(id);pendingReadJobs.remove(id)}}
        }
    }
    fun setForeground(visible:Boolean){
        if(uiForeground==visible)return
        uiForeground=visible
        foregroundSocketCheck?.cancel()
        if(!visible)state=state.copy(taskNotice=null)
        if(visible){
            // Silence during an idle conversation does not mean its transport is dead.
            if(state.connected)verifyForegroundConnection()
            else if(state.connecting)requestConnectionRestart()
            nextLocalRouteProbeAt=0L;probeLocalRoute();loadFast()
        }else localRouteProbe?.cancel()
        if(state.connected&&visible)startPolling()
    }
    private fun probeLocalRoute(){
        localRouteProbe?.cancel()
        val active=client?:return
        val local=state.address
        if(state.route!=ConnectionRoute.AUTO||!uiForeground||!state.connected||local.isBlank()||state.activeAddress==local||state.activeAddress!=state.publicUrl)return
        val epoch=generation
        val probe=GatewayClient(local,store.token(),certificateSha256=state.certificateSha256,useDeviceCertificate=true)
        localRouteProbe=viewModelScope.launch{
            while(isActive&&uiForeground&&generation==epoch&&client===active&&state.connected){
                val wait=nextLocalRouteProbeAt-android.os.SystemClock.elapsedRealtime()
                if(wait>0)delay(wait)
                nextLocalRouteProbeAt=android.os.SystemClock.elapsedRealtime()+30000
                val available=try{probe.probeHealth().let{it.ok&&it.minAndroidProtocolVersion<=1}}
                    catch(e:CancellationException){throw e}catch(_:Exception){false}
                if(available&&isActive&&uiForeground&&generation==epoch&&client===active&&state.connected){
                    // Return through the existing socket loop; keep the conversation and caches.
                    requestConnectionRestart()
                    return@launch
                }
            }
        }
    }
    private fun startPolling(){
        // Foreground changes adjust cadence without aborting a history/sidebar read.
        // Only the connection lifecycle cancels the polling job and its reads.
        if(polling?.isActive==true){pollingWake.trySend(Unit);return}
        while(pollingWake.tryReceive().isSuccess){}
        polling=viewModelScope.launch{
            if(!uiForeground)withTimeoutOrNull(30000L){pollingWake.receive()}
            while(isActive&&state.connected){
                if(uiForeground&&!state.fastBusy&&android.os.SystemClock.elapsedRealtime()-lastFastReadAt>=30000)loadFast()
                if(listJob?.isActive!=true)launch{refreshLists()}
                if(pinJob?.isActive!=true)pinJob=launch{refreshPinOrder()}
                refreshHistory()
                if(uiForeground&&!state.usageLoading&&System.currentTimeMillis()-lastUsageRefresh>=60000)loadUsage()
                // A wake received during this read is already satisfied by its result.
                while(pollingWake.tryReceive().isSuccess){}
                val interval=when{!uiForeground->30000L;state.running||state.sending||pending!=null||state.queue.isNotEmpty()->2500L;else->10000L}
                withTimeoutOrNull(interval){pollingWake.receive()}
            }
        }
    }
    private var historyJob:Job?=null
    private var historyTicket=0
    private var projectTicket=0
    private var historyTurns=10
    private var threadLimit=10
    private var projectLimit=5
    private var sidebarRefreshPending=false
    private var sidebarFilterRevision=0
    private val activityGroups=linkedMapOf<Pair<String,String>,List<ChatEvent>>()
    private val activityDetails=linkedMapOf<Pair<String,String>,ChatEvent>()
    private val activityDetailPending=mutableSetOf<Triple<GatewayClient,String,String>>()
    private val activityLoadJobs=mutableSetOf<Job>()
    internal var activityLoadEpoch by mutableStateOf(0);private set
    private fun cancelActivityLoads(){
        activityLoadEpoch++
        activityLoadJobs.toList().forEach{it.cancel()};activityLoadJobs.clear()
        activityDetailPending.clear()
        state=state.copy(activityLoading=emptySet())
    }
    // HTTP history may include a delta before its WebSocket delivery, and later
    // replace that delta with a full item. Keep a bounded identity ring separately
    // from rendered rows so those late deliveries remain duplicates.
    private val outputEventIds=linkedSetOf<Pair<String,String>>()
    private fun rememberOutputEvent(event:ChatEvent):Boolean{
        if(event.type !in setOf("message.delta","reasoning.summary")||event.eventId.isBlank())return false
        val known=!outputEventIds.add(event.threadId to event.eventId)
        if(outputEventIds.size>16000)outputEventIds.iterator().let{it.next();it.remove()}
        return known
    }
    private fun hydratedActivities(events:List<ChatEvent>):List<ChatEvent> = hydrateNativeActivities(events,activityGroups,activityDetails)
    fun loadActivityGroups(events:List<ChatEvent>){events.filter{it.activityGroupId.isNotBlank()}.forEach{loadActivity(it.threadId,it.activityGroupId)}}
    fun loadActivityDetails(threadId:String,eventIds:List<String>,retry:Boolean=true){val api=client?:return;eventIds.filter{it.isNotBlank()&&!activityDetails.containsKey(threadId to it)&&Triple(api,threadId,it) !in activityDetailPending&&(retry||it !in state.activityErrors)}.distinct().chunked(100).forEach{loadActivity(threadId,eventIds=it)}}
    private fun loadActivity(threadId:String,groupId:String="",eventIds:List<String> = emptyList()){
        val api=client?:return;val epoch=generation;val chosen=selection;val loadEpoch=activityLoadEpoch
        fun current()=epoch==generation&&chosen==selection&&client===api&&loadEpoch==activityLoadEpoch
        val key=groupId.ifBlank{eventIds.joinToString("|")}
        if(threadId!=state.threadId||key in state.activityLoading)return
        if(groupId.isNotBlank()&&activityGroups.containsKey(threadId to groupId)||groupId.isBlank()&&eventIds.all{activityDetails.containsKey(threadId to it)})return
        val pendingIds=eventIds.map{Triple(api,threadId,it)};activityDetailPending.addAll(pendingIds)
        state=state.copy(activityLoading=state.activityLoading+eventIds+key,activityErrors=state.activityErrors-eventIds.toSet()-key)
        val job=viewModelScope.launch(start=CoroutineStart.LAZY){
            try{
                val events=withContext(Dispatchers.IO){api.nativeActivity(threadId,groupId,eventIds)}
                if(current()){
                    if(groupId.isNotBlank()&&events.isEmpty())throw IllegalStateException("此记录的详情暂不可用")
                    if(groupId.isNotBlank())activityGroups[threadId to groupId]=events else events.forEach{activityDetails[threadId to it.eventId]=it}
                    while(activityGroups.size>200)activityGroups.remove(activityGroups.keys.first())
                    while(activityDetails.size>1000)activityDetails.remove(activityDetails.keys.first())
                    val received=events.map{it.eventId}.toSet()
                    val missing=eventIds.filter{it !in received}.associateWith{"此记录的详情暂不可用"}
                    state=state.copy(events=preserveNativeEventKeys(state.events,hydratedActivities(state.events)),activityLoading=state.activityLoading-key,activityErrors=state.activityErrors+missing)
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current()){val message=nativeError(e);state=state.copy(activityErrors=state.activityErrors+eventIds.associateWith{message}+(key to message))}}
            finally{
                currentCoroutineContext()[Job]?.let{activityLoadJobs.remove(it)}
                // A replacement view may already be requesting the same event IDs.
                if(loadEpoch==activityLoadEpoch)activityDetailPending.removeAll(pendingIds.toSet())
                if(current())state=state.copy(activityLoading=state.activityLoading-eventIds.toSet()-key)
            }
        }
        activityLoadJobs.add(job);job.start()
    }
    private var historyInFlightFor:String?=null
    private class HistoryRead(val api:GatewayClient,val generation:Int,val selection:Int){
        var pending=false
        var forced=false
    }
    private var historyRead:HistoryRead?=null
    private val historyRetryAfter=mutableMapOf<String,Long>()
    private var listJob:Job?=null
    private var pinJob:Job?=null
    private var lastPinOrder:List<String>?=null
    private var pending:NativePending?=null
    private var submissionWatch:Job?=null
    private var submissionRetry:Job?=null
    private val failedSends=linkedMapOf<String,NativePending>()
    private fun sameComputer(p:NativePending)=p.address.trimEnd('/')==state.address.trimEnd('/')&&p.certificateSha256?.lowercase()==state.certificateSha256.lowercase()
    private fun persistSend(p:NativePending){
        val value=JSONObject().put("id",p.id).put("threadId",p.threadId).put("text",p.text).put("plan",p.plan).put("restoreDraft",p.restoreDraft)
            .put("address",p.address).put("certificateSha256",p.certificateSha256?:JSONObject.NULL).put("draftKey",p.draftKey).put("projectId",p.projectId).put("model",p.model).put("effort",p.effort).put("permission",p.permission)
            .put("mode",p.mode).put("fast",p.fast?:JSONObject.NULL).put("submittedAt",p.submittedAt).put("uncertain",p.uncertain).put("failure",p.failure).put("wireCommand",p.wireCommand).put("goal",p.goal)
            .put("images",org.json.JSONArray(p.images.map{JSONObject().put("id",it.id).put("name",it.name)}))
            .put("uploads",org.json.JSONArray(p.uploads.map{JSONObject().put("id",it.id).put("name",it.name).put("mime",it.mime).put("size",it.size)}))
        check(prefs.edit().putString("send:${p.id}",value.toString()).commit()){"无法保存待发送消息，请稍后重试"}
    }
    private fun forgetSend(id:String){
        failedSends.remove(id);prefs.edit().remove("send:$id").remove("sendNoticeDismissed:$id").apply()
        state=state.copy(recoveryVersion=state.recoveryVersion+1)
        if(state.submissionNoticeRequestId==id)state=state.copy(submissionNotice="",submissionNoticeRequestId="")
    }
    private fun showSubmissionNotice(id:String,message:String){
        val record=failedSends[id]?:pending?.takeIf{it.id==id}?:return
        if(!sameComputer(record)||prefs.getBoolean("sendNoticeDismissed:$id",false))return
        if(record.draftKey!=key()&&(record.threadId.isBlank()||record.threadId!=state.threadId))return
        state=state.copy(submissionNotice=message,submissionNoticeRequestId=id)
    }
    fun dismissSubmissionNotice(){
        state.submissionNoticeRequestId.takeIf{it.isNotBlank()}?.let{prefs.edit().putBoolean("sendNoticeDismissed:$it",true).apply()}
        state=state.copy(submissionNotice="",submissionNoticeRequestId="")
    }
    fun discardFailedMessage(id:String){
        if(id==pending?.id)return
        val record=failedSends[id]?:return
        if(!sameComputer(record)||(record.draftKey!=key()&&record.threadId!=state.threadId))return
        forgetSend(id)
    }
    fun clearFailedMessages(){
        val ids=failedMessages().map{it.requestId}
        ids.forEach(::discardFailedMessage)
        dismissSubmissionNotice()
    }
    internal fun unassignedMessages():List<NativeLegacySubmission> = failedSends.values.filter{it.certificateSha256==null}
        .sortedByDescending{it.submittedAt}.map{p->NativeLegacySubmission(p.id,p.address,p.text,
            p.images.map{it.name.ifBlank{"未命名图片"}}+p.uploads.map{it.name.ifBlank{"未命名文件"}},p.submittedAt)}
    internal fun failedMessages():List<ChatEvent> = failedSends.values.filter{it.id!=pending?.id&&sameComputer(it)&&(it.draftKey==key()||it.threadId.isNotBlank()&&it.threadId==state.threadId)}.map{
        ChatEvent(type="user.message",threadId=state.threadId,eventId="outgoing:${it.id}",requestId=it.id,text=it.text,images=if(it.goal)emptyList() else it.images,uploads=if(it.goal)emptyList() else it.uploads,status="send.failed",detail=it.failure.ifBlank{"发送状态尚未确认，内容已保留"})
    }
    private fun sendingRecord(id:String,text:String,images:List<NativeImage>,uploads:List<NativeUploadedFile>,restore:Boolean=true)=NativePending(id,state.threadId,selection,text,images,uploads,state.nextMode=="plan",restore,store.baseUrl().trimEnd('/'),key(),state.projectId,state.model,state.effort,state.permission,state.nextMode,if(state.harness=="codex")state.fastMode else null,certificateSha256=state.certificateSha256.lowercase())
    private fun freezeCommand(p:NativePending,thread:ThreadRecord?=state.threads.find{it.id==p.threadId}):NativePending {
        val command=client!!.nativeCommand(thread,state.projects.find{it.id==p.projectId},p.text,p.model,p.effort,p.permission,p.id,if(p.goal)emptyList() else p.images,if(p.goal)emptyList() else p.uploads,p.mode,p.fast)
        return p.copy(wireCommand=command.toString())
    }
    private fun confirmSend(id:String,threadId:String="",status:String=""){
        val p=pending?.takeIf{it.id==id}?:failedSends[id]?:return
        if(!sameComputer(p))return
        val confirmedThread=threadId.ifBlank{p.threadId}
        val scopes=listOfNotNull(attachmentScope(draftKey=p.draftKey),confirmedThread.takeIf{it.isNotBlank()}?.let{
            attachmentScope(state.copy(threadId=it,harness=nativeThreadAgent(it)))
        }).distinct()
        val sameContext=attachmentScope() in scopes
        // Acknowledgements can arrive after switching away and reopening.
        // Recovered text belongs to the submission's scopes, not its old selection.
        val recovered=failedSends.containsKey(id)&&p.restoreDraft
        if(recovered){
            for(scope in scopes)if(store.chatDraft(scope)==p.text)store.saveChatDraft(scope,"")
            if(sameContext&&state.draft==p.text)state=state.copy(draft="")
        }
        if(p.restoreDraft&&!p.goal){
            val imageIds=p.images.map{it.id}.toSet();val fileIds=p.uploads.map{it.id}.toSet()
            // A late acknowledgement can arrive after a draft was restored or
            // reopened. Remove only this submission's IDs, including on disk.
            for(scope in scopes){
                val (images,files)=store.attachmentDraft(scope)
                store.saveAttachmentDraft(scope,images.filter{it.id !in imageIds},files.filter{it.id !in fileIds})
            }
            if(sameContext)state=state.copy(images=state.images.filter{it.id !in imageIds},uploads=state.uploads.filter{it.id !in fileIds})
        }
        if(sameContext&&(pending==null||pending?.id==id)&&(p.selection==selection||failedSends.containsKey(id))){
            if(threadId.isNotBlank()&&(state.threadId.isBlank()||state.threadId==p.threadId)){
                moveCreatedConversationDraft(p,threadId)
                state=state.copy(threadId=threadId,fastMode=null)
            }
            val recoveredDraft=p.restoreDraft&&failedSends.containsKey(id)&&state.draft==p.text
            val draft=if(recoveredDraft)"" else state.draft
            state=state.copy(sending=false,sendingStage="",draft=draft,nextMode=if(p.plan&&state.nextMode=="plan")"default" else state.nextMode,error="",running=if(status.isNotBlank())status=="running" else state.running)
            store.saveChatDraft(attachmentScope(),draft)
            if(p.draftKey!=key()&&store.chatDraft(attachmentScope(draftKey=p.draftKey))==p.text)store.saveChatDraft(attachmentScope(draftKey=p.draftKey),"")
        }
        moveGoalAttachments(p,threadId)
        if(pending?.id==id){submissionWatch?.cancel();submissionWatch=null;pending=null}
        if(p.goal&&sameComputer(p))viewModelScope.launch{refreshLists(true)}
        forgetSend(id);state=state.copy(submissionNotice="",submissionNoticeRequestId="")
    }
    private fun watchSubmission(p:NativePending){
        submissionWatch?.cancel();val api=client?:return;val epoch=generation
        submissionWatch=viewModelScope.launch{
            delay(8000)
            val deadline=System.currentTimeMillis()+90000
            while(pending?.id==p.id&&epoch==generation){
                state=state.copy(sendingStage="正在确认电脑是否收到消息…")
                try{
                    val receipt=withContext(Dispatchers.IO){api.nativeJsonAsync("GET","/api/threads/${pending?.threadId?.ifBlank{"_new"}?:"_new"}/submission?requestId=${p.id}")}
                    if(epoch!=generation||client!==api||pending?.id!=p.id)return@launch
                    val value=receipt.getJSONObject("submission")
                    when(value.optString("state")){
                        "accepted"->{confirmSend(p.id,value.optString("threadId"),receipt.optString("status"));refreshHistory(changed=true);return@launch}
                        "failed"->{recoverPending(value.optString("error").ifBlank{"发送失败"},false);return@launch}
                        "unknown","uncertain"->{recoverPending(value.optString("error").ifBlank{"发送状态尚未确认，内容已保留，可重试确认"});return@launch}
                    }
                }catch(e:CancellationException){throw e}catch(e:Exception){recoverPending("发送确认失败：${nativeError(e)}。内容已保留");return@launch}
                if(System.currentTimeMillis()>=deadline){recoverPending("电脑仍未确认消息，内容已保留");return@launch}
                delay(3000)
            }
        }
    }
    fun retryFailedMessage(id:String){
        if(isReadOnly())return
        val p=failedSends[id]?.takeIf{sameComputer(it)}?:return;val api=client?:return
        nativeModelSelectionError(nativeAgent(p.model),p.model,state.models).takeIf{it.isNotBlank()}?.let{error(it);return}
        if(state.sending||!state.connected)return
        val epoch=generation;val chosen=selection;val current=p.copy(selection=chosen)
        pending=current;state=state.copy(sending=true,sendingStage="正在确认上次发送结果…",error="")
        submissionRetry?.cancel()
        val retryJob=viewModelScope.launch(start=CoroutineStart.LAZY){try{
            var previous=current
            var reuseId=current.uncertain
            if(current.uncertain||state.harness=="codex"||"harness-durable-submissions" in state.capabilities){
                try{
                    val receipt=withContext(Dispatchers.IO){api.nativeJsonAsync("GET","/api/threads/${current.threadId.ifBlank{"_new"}}/submission?requestId=$id")}
                    if(epoch!=generation||chosen!=selection||pending?.id!=id)return@launch
                    val value=receipt.getJSONObject("submission")
                    when(value.optString("state")){
                        "accepted"->{confirmSend(id,value.optString("threadId"),receipt.optString("status"));refreshHistory(changed=true);return@launch}
                        "processing"->{failedSends.remove(id);persistSend(current);state=state.copy(recoveryVersion=state.recoveryVersion+1);watchSubmission(current);return@launch}
                        "failed"->{previous=current.copy(uncertain=false);reuseId=value.optBoolean("retryAllowed")}
                        "uncertain"->{recoverPending(value.optString("error").ifBlank{"上次提交结果未知，请先查看会话，系统不会重发"});return@launch}
                    }
                }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation&&chosen==selection)recoverPending("无法确认上次发送结果：${nativeError(e)}。内容已保留");return@launch}
            }
            if(epoch!=generation||chosen!=selection||pending?.id!=id)return@launch
            var next=previous.copy(id=if(reuseId)previous.id else UUID.randomUUID().toString(),failure="")
            next=if(next.wireCommand.isNotBlank())next.copy(wireCommand=JSONObject(next.wireCommand).put("requestId",next.id).toString()) else freezeCommand(next,next.threadId.takeIf{it.isNotBlank()}?.let{state.threads.find{t->t.id==it}?:ThreadRecord(it)})
            persistSend(next);if(next.id!=id)forgetSend(id) else {failedSends.remove(id);state=state.copy(recoveryVersion=state.recoveryVersion+1)};pending=next
            if(current.restoreDraft&&state.draft==current.text&&(current.goal||state.images==current.images&&state.uploads==current.uploads)){state=state.copy(draft="",images=if(current.goal)state.images else emptyList(),uploads=if(current.goal)state.uploads else emptyList());store.saveChatDraft(attachmentScope(),"")}
            state=state.copy(sendingStage="",error="")
            if(!api.sendSocketMessage(JSONObject(next.wireCommand)))recoverPending("连接已断开，消息尚未确认") else watchSubmission(next)
        }finally{if(submissionRetry===currentCoroutineContext()[Job])submissionRetry=null}}
        submissionRetry=retryJob;retryJob.start()
    }
    private val outgoingKeys=mutableMapOf<Pair<String,String>,String>()
    internal fun outgoingKey(event:ChatEvent)=outgoingKeys[event.threadId to event.eventId]
    internal fun pendingMessage():ChatEvent?=pending?.takeIf{it.selection==selection&&!it.goal&&
        !(runCatching{JSONObject(it.wireCommand).has("replaceTurnId")}.getOrDefault(false)&&state.events.any{event->event.type=="user.message"})}?.let{
        ChatEvent(type="user.message",threadId=state.threadId,eventId="outgoing:${it.id}",requestId=it.id,text=it.text,images=it.images,uploads=it.uploads)
    }
    private var selection=0
    private var generation=0
    private var consoleInfoJob:Job?=null
    private var consoleStatisticsJob:Job?=null
    private var consoleActionJob:Job?=null
    private var consoleInfoTicket=0
    private var consoleStatisticsTicket=0
    private var consoleStatisticsRequest:String?=null
    private val consoleStatisticsCache=linkedMapOf<String,ConsoleStatistics>()
    private var hydration:MutableList<ChatEvent>?=null
    private var searchJob:Job?=null
    private var searchTicket=0
    private var modelRevision=0
    private var usageJob:Job?=null
    private data class UsageRead(val api:GatewayClient,val generation:Int,val selection:Int,val model:String,val harness:String,val days:Int){var pending=false}
    private var usageRead:UsageRead?=null
    private val conversations=NativeConversationCache()
    private fun conversationKey(id:String,harness:String=state.harness)=state.address+"|"+harness+"|"+id
    internal fun readingPositionKey(id:String)=conversationKey(id,nativeThreadAgent(id))
    private fun rememberConversation(){if(state.threadId.isNotBlank()&&state.events.isNotEmpty())conversations.put(conversationKey(state.threadId),NativeConversationSnapshot(state.events.toList(),historyTurns,state.hasMoreHistory,state.actualModel))}
    private var usageTicket=0
    private var lastUsageRefresh=0L
    private fun resetUsageRefresh(){usageJob?.cancel();usageRead=null;usageTicket++;lastUsageRefresh=0;state=state.copy(usageLoading=false)}
    private var statusReadRevision=0L
    private fun resetStatusReads(){
        statusReadRevision++
        // Read ownership ends with the connection. Pending saves retain their own jobs.
        fastTicket++;fastJob?.cancel();fastJob=null
        fastReadClient=null;fastReadContext=null;lastFastReadAt=0L
        recoveryQuery?.cancel();recoveryQuery=null
        submissionRetry?.cancel();submissionRetry=null
        resetUsageRefresh()
        state=state.copy(fastBusy=client?.let{fastWrites[it to state.threadId]?.isActive}==true,remoteApprovalBusy=false,capacityRetryBusy=false)
    }
    private fun clearConversationModelServiceNotice(){if(state.modelServiceNotice?.quotaSnapshot!=true)dismissModelServiceNotice()}
    private var stopRequestId:String?=null
    private var stopJob:Job?=null
    private fun clearStop(){
        stopJob?.cancel();stopJob=null;stopRequestId=null
        val previous=state.stopError
        state=state.copy(stopping=false,stopError="",error=if(previous.isNotBlank()&&(state.error==previous||state.error=="停止失败：$previous"))"" else state.error)
    }
    private data class DesktopModelSettings(val model:String,val effort:String,val generation:Int,val selection:Int,val revision:Int,var applied:Boolean=false)
    private val desktopModels=mutableMapOf<String,DesktopModelSettings>()
    private fun syncDesktopModel(id:String,model:String,effort:String,revision:Int=modelRevision) {
        if(id!=state.threadId||model.isBlank())return
        val previous=desktopModels[id]
        if(previous==null||previous.model!=model||previous.effort!=effort||previous.generation!=generation||previous.selection!=selection)
            desktopModels[id]=DesktopModelSettings(model,effort,generation,selection,revision)
        applyDesktopModel()
    }
    private fun applyDesktopModel():Boolean {
        val pending=desktopModels[state.threadId]?:return false
        if(pending.applied||pending.generation!=generation||pending.selection!=selection)return false
        // A later catalog may complete history synchronization, but never replace a manual choice.
        if(pending.revision!=modelRevision){pending.applied=true;return false}
        val available=state.models.find{it.id==pending.model}?:(if(state.harness=="opencode")nativeOpenCodeSelection(state.models,pending.model) else null)?:return false
        pending.applied=true
        state=state.copy(models=nativeModelsWithSelection(state.models,available),model=available.id,effort=if(pending.effort in available.efforts)pending.effort else available.defaultEffort)
        rememberThreadSettings()
        return true
    }
    private fun applyConnectedModelCatalog(api:GatewayClient,address:String,incoming:List<NativeModel>,pending:Set<String>){
        val models=nativeMergeModelDirectory(incoming,state.models,pending)
        if(models.isEmpty()&&state.harness in pending)return
        val candidates=models.filter{it.harness==state.harness&&it.available}
        val model=if(state.harness=="opencode"&&state.harness !in pending)nativeOpenCodeSelection(models,state.model.takeIf{it.startsWith("opencode::")}?:prefs.getString("model:opencode","").orEmpty(),state.models)
            else candidates.firstOrNull{it.id==state.model}?:candidates.firstOrNull{it.id==prefs.getString("model:${state.harness}",prefs.getString("model",""))}?:candidates.firstOrNull{it.id.endsWith("::default")}?:candidates.find{it.id=="gpt-6-sol"}?:candidates.find{it.id=="gpt-6.1-sol"}?:candidates.firstOrNull()
        val keepSelection=model==null&&state.harness in pending
        val savedEffort=if(model?.id==state.model)state.effort else model?.let{prefs.getString("effort:${it.id}",nativeTaskDefaultEffort(it.id,it.defaultEffort)).orEmpty()}
        state=state.copy(models=nativeModelsWithSelection(models,model),modelsFallback=false,backends=api.nativeBackendStatuses,backendStatusError="",model=if(keepSelection)state.model else model?.id.orEmpty(),effort=if(keepSelection)state.effort else if(model?.efforts?.contains(savedEffort)==true)savedEffort.orEmpty() else model?.defaultEffort.orEmpty(),activeAddress=address)
        applyDesktopModel()
    }
    private fun key(value:NativeState=state)="native:"+(if(value.harness=="codex")"" else value.harness+":")+value.threadId.ifBlank { "new:${value.projectId}" }
    private fun attachmentScope(value:NativeState=state,draftKey:String=key(value))=org.json.JSONArray(listOf(value.address.trimEnd('/'),value.certificateSha256.lowercase(),draftKey)).toString()
    private fun restoreAttachmentDraft(){
        val (images,files)=store.attachmentDraft(attachmentScope())
        state=state.copy(images=images,uploads=files)
    }
    private fun assignDraftProject(projectId:String){
        state=state.copy(projectId=projectId)
        store.saveAttachmentDraft(attachmentScope(),state.images,state.uploads)
    }
    private fun moveCreatedConversationDraft(p:NativePending,threadId:String){
        if(threadId.isBlank()||state.threadId.isNotBlank()||p.selection!=selection||!sameComputer(p)||key()!=p.draftKey)return
        val destination=state.copy(threadId=threadId)
        // Sending already removed the submitted attachments; these belong to the next message.
        store.saveChatDraft(attachmentScope(destination),state.draft)
        store.saveChatDraft(attachmentScope(draftKey=p.draftKey),"")
        store.saveAttachmentDraft(attachmentScope(destination),state.images,state.uploads)
        store.saveAttachmentDraft(attachmentScope(),emptyList(),emptyList())
    }
    private fun moveGoalAttachments(p:NativePending,threadId:String){
        if(!p.goal||threadId.isBlank()||!sameComputer(p))return
        val source=attachmentScope(draftKey=p.draftKey)
        val destination=attachmentScope(draftKey="native:$threadId")
        if(source==destination)return
        val (images,files)=store.attachmentDraft(source)
        val (targetImages,targetFiles)=store.attachmentDraft(destination)
        store.saveAttachmentDraft(destination,(targetImages+images).distinctBy{it.id},(targetFiles+files).distinctBy{it.id})
        store.saveAttachmentDraft(source,emptyList(),emptyList())
        if(attachmentScope()==source||attachmentScope()==destination)restoreAttachmentDraft()
    }
    private fun restoreModels(address:String,preserveSelection:Boolean=false){
        val cached=store.models(address)
        val models=nativeModelCatalogOrDefaults(cached).map{if(it.harness=="opencode")it.copy(available=false,unavailableReason="正在确认 OpenCode 模型，请刷新模型目录") else it}
        val candidates=models.filter{it.harness==state.harness&&it.available}
        val current=state.model.takeIf{preserveSelection}
        val model=if(state.harness=="opencode")nativeOpenCodeSelection(models,current?:prefs.getString("model:opencode","").orEmpty()) else candidates.find{it.id==current}?:candidates.find{it.id==prefs.getString("model:${state.harness}","")}?:candidates.find{it.id=="gpt-6-sol"}?:candidates.find{it.id=="gpt-6.1-sol"}?:candidates.firstOrNull()
        val saved=if(model!=null&&model.id==current)state.effort else if(cached.isEmpty())"high" else model?.let{prefs.getString("effort:${it.id}",nativeTaskDefaultEffort(it.id,it.defaultEffort)).orEmpty()}
        state=state.copy(models=nativeModelsWithSelection(models,model),modelsFallback=cached.isEmpty(),model=model?.id.orEmpty(),effort=if(saved in model?.efforts.orEmpty())saved.orEmpty() else model?.defaultEffort.orEmpty())
    }
    private fun restoreSidebar(address:String,harness:String=state.harness,fingerprint:String=state.certificateSha256){
        val cached=store.sidebar(address,harness,fingerprint)
        threadLimit=cached?.threadLimit?:10;projectLimit=cached?.projectLimit?:5
        state=state.copy(threads=cached?.threads.orEmpty(),sidebarProjects=cached?.projects.orEmpty(),projects=cached?.allowedProjects.orEmpty(),
            moreThreads=cached?.moreThreads?:false,moreProjects=cached?.moreProjects?:false)
    }
    private fun rememberSidebar(){
        val address=state.address;val harness=state.harness;val fingerprint=state.certificateSha256
        val snapshot=NativeSidebarSnapshot(state.threads,state.sidebarProjects,state.projects,state.moreThreads,state.moreProjects,threadLimit,projectLimit)
        viewModelScope.launch{
            try{store.saveSidebar(address,harness,fingerprint,snapshot)}
            catch(e:CancellationException){throw e}
            catch(e:Exception){android.util.Log.w("CodexControl","Unable to save sidebar cache",e)}
        }
    }
    fun setThreadFilter(filter:NativeThreadFilter){
        if(filter==state.threadFilter||"thread-sidebar-filters" !in state.capabilities)return
        listJob?.cancel();listTicket++;sidebarFilterRevision++;threadLimit=10;sidebarRefreshPending=false
        state=state.copy(threadFilter=filter,projectThreads=emptyMap(),loadingSidebar=false,moreThreads=false)
        viewModelScope.launch{refreshLists(true)}
    }
    private fun expandedSidebarProjects():Set<String>{
        val saved=getApplication<Application>().getSharedPreferences("sidebar",0)
        return state.sidebarProjects.filter{saved.getBoolean("project:${it.id}",false)}.map{it.id}.toSet()
    }
    fun refreshSidebar(){
        if(!state.connected)return
        if(listJob?.isActive==true){sidebarRefreshPending=true;return}
        viewModelScope.launch{refreshLists(true)}
    }
    init {
        store.migrateNativeChatDrafts(store.baseUrl(),store.certificateSha256())
        prefs.all.filterKeys{it.startsWith("send:")}.values.forEach{raw->runCatching{
            val j=JSONObject(raw as String);val images=j.optJSONArray("images");val uploads=j.optJSONArray("uploads")
            val p=NativePending(j.getString("id"),j.optString("threadId"),selection,j.optString("text"),(0 until (images?.length()?:0)).map{images!!.getJSONObject(it).let{row->NativeImage(row.getString("id"),row.optString("name"))}},(0 until (uploads?.length()?:0)).map{uploads!!.getJSONObject(it).let{row->NativeUploadedFile(row.getString("id"),row.optString("name"),row.optString("mime"),row.optLong("size"))}},j.optBoolean("plan"),j.optBoolean("restoreDraft",true),j.optString("address").trimEnd('/'),j.optString("draftKey"),j.optString("projectId"),j.optString("model"),j.optString("effort"),j.optString("permission","full"),j.optString("mode"),if(j.isNull("fast"))null else j.optBoolean("fast"),j.optString("submittedAt"),j.optBoolean("uncertain",true),j.optString("failure"),j.optString("wireCommand"),j.optBoolean("goal"),if(j.has("certificateSha256")){if(j.isNull("certificateSha256"))null else j.optString("certificateSha256").lowercase()}else store.certificateSha256().lowercase().takeIf{j.optString("address").trimEnd('/')==store.baseUrl().trimEnd('/')})
            if(!j.has("certificateSha256"))persistSend(p)
            failedSends[p.id]=p
        }}
        restoreModels(store.baseUrl());restoreSidebar(store.baseUrl());state=state.copy(draft=store.chatDraft(attachmentScope()),permission=prefs.getString("permission:"+state.harness,"full")?:"full");restoreAttachmentDraft()}
    fun error(message:String){state=state.copy(error=message)}
    fun retryConnect(){val retry=connectionRetry;if(retry!=null)retry() else autoConnect()}
    fun testPublicConnection(publicUrl:String=state.publicUrl,password:String=state.remotePassword) {
        if(state.publicTestRunning)return
        val remote=publicUrl.trim().trimEnd('/')
        val uri=runCatching{java.net.URI(remote)}.getOrNull()
        val invalid=when {
            remote.isBlank()->"请先填写公网 HTTPS 地址"
            uri?.scheme!="https"||uri.host.isNullOrBlank()||uri.userInfo!=null||!uri.rawPath.isNullOrBlank()||uri.rawQuery!=null||uri.rawFragment!=null->"请输入完整的公网 HTTPS 地址，例如 https://example.com"
            password.isBlank()->"请先填写公网独立密码"
            else->null
        }
        if(invalid!=null){state=state.copy(publicTestMessage=invalid,publicTestPassed=false);return}
        val token=store.token()
        val testedGeneration=generation
        state=state.copy(publicTestRunning=true,publicTestPassed=false,publicTestMessage="正在测试公网 HTTPS 和密码…")
        viewModelScope.launch {
            var stage="公网 HTTPS"
            val started=android.os.SystemClock.elapsedRealtime()
            // A separate client keeps the current session and its socket untouched.
            val probe=GatewayClient(remote,token,remotePassword=password,useDeviceCertificate=true)
            try {
                withTimeout(25000) {
                    check(withContext(Dispatchers.IO){probe.health()}.ok){"服务健康检查未通过"}
                    if(token.isBlank()){
                        state=state.copy(publicTestMessage="公网可达，密码验证通过；配对后可继续验证设备认证和实时连接")
                        return@withTimeout
                    }
                    stage="设备认证"
                    state=state.copy(publicTestMessage="HTTPS 和密码通过，正在验证设备认证…")
                    withContext(Dispatchers.IO){probe.listProjects()}
                    stage="实时连接"
                    state=state.copy(publicTestMessage="设备认证通过，正在测试实时连接…")
                    withTimeout(10000){probe.events().first{it.type=="connected"}}
                    val seconds=(android.os.SystemClock.elapsedRealtime()-started)/1000.0
                    val activate=testedGeneration==generation&&shouldConnectTestedPublic(state.connected,state.activeAddress,state.address,remote)
                    state=state.copy(publicTestPassed=true,publicTestMessage="公网测试通过 · 用时 ${String.format(java.util.Locale.ROOT,"%.1f",seconds)} 秒\n"+when{
                        activate->"验证通过，已选择公网连接"
                        testedGeneration!=generation->"连接设置已改变，保留当前选择"
                        state.activeAddress==state.address->"内网已连接，继续使用内网"
                        else->"当前已连接公网"
                    })
                    if(activate)connect(state.address,publicUrl=remote,remotePassword=password,route=ConnectionRoute.PUBLIC)
                }
            } catch(e:TimeoutCancellationException){
                state=state.copy(publicTestMessage="$stage 超时，请检查公网地址和当前网络")
            } catch(e:CancellationException){throw e}
            catch(e:Exception){
                val detail=when {
                    e.message?.contains("401")==true&&stage=="公网 HTTPS"->"公网密码不正确"
                    e.message?.contains("401")==true->"设备认证未通过，请重新配对"
                    else->nativeError(e)
                }
                state=state.copy(publicTestMessage="$stage 测试失败：$detail")
            } finally {state=state.copy(publicTestRunning=false)}
        }
    }
    fun compactContext(){
        if(isReadOnly()){error("云端快照仅供查看");return}
        val id=state.threadId
        if(id.isBlank()||state.running||currentWorkBusy()||state.harness!="codex"||nativeCompactionRunning(state.events,id))return
        val api=client?:return;val epoch=generation;val chosen=selection
        fun current()=epoch==generation&&api===client&&chosen==selection&&state.threadId==id
        scopedWork(::current){api.nativeJson("POST","/api/threads/$id/compact",JSONObject());withContext(Dispatchers.Main){if(current())loadUsage()}}
    }
    fun loadUsage(days:Int=state.usageDays,changed:Boolean=false){
        if(isReadOnly())return
        val api=client?:return;val id=state.threadId;val chosen=selection;val epoch=generation;val harness=state.harness;val model=state.model
        val read=UsageRead(api,epoch,chosen,model,harness,days)
        usageRead?.takeIf{it==read&&usageJob?.isActive==true}?.let{if(changed)it.pending=true;return}
        usageJob?.cancel();val ticket=++usageTicket;lastUsageRefresh=System.currentTimeMillis()
        usageRead=read
        fun current()=epoch==generation&&api===client&&selection==chosen&&ticket==usageTicket
        fun matches()=current()&&state.harness==harness&&state.model==model&&state.usageDays==days
        state=state.copy(usageDays=days,usageLoading=true,usageError="")
        usageJob=viewModelScope.launch {
            try{
                val result=withContext(Dispatchers.IO){api.nativeJsonAsync("GET","/api/usage?agent=$harness&days=$days&model=${Uri.encode(model)}"+if(id.isNotBlank())"&threadId=$id" else "")}
                if(matches()){
                    state=state.copy(usage=result,usageDataDays=days)
                    val quota=result.optJSONObject("quota")
                    val rows=quota?.optJSONArray("windows")
                    val windows=(0 until (rows?.length()?:0)).mapNotNull{index->rows!!.optJSONObject(index)?.let{
                        NativeQuotaWindow(it.optString("name"),it.optLong("durationMins"),if(it.isNull("remainingPercent"))null else it.optDouble("remainingPercent"),if(it.isNull("resetsAt"))null else it.optLong("resetsAt").takeIf{at->at>0})
                    }}
                    val fresh=quota?.optBoolean("stale",true)==false
                    val now=System.currentTimeMillis()/1000
                    val notice=modelServiceNotices.quota(harness,windows,!fresh,now)
                    if(notice!=null&&(notice.kind=="quota"||state.modelServiceNotice?.kind !in setOf("capacity","quota")))state=state.copy(modelServiceNotice=notice)
                    else if(fresh&&state.modelServiceNotice?.quotaSnapshot==true){
                        val current=quotaWindowNotice(windows,now)
                        if(current!=null)state=state.copy(modelServiceNotice=current)
                        else if(windows.isNotEmpty()&&windows.all{it.remainingPercent?.let{value->value.isFinite()&&value>LOW_QUOTA_PERCENT}==true})dismissModelServiceNotice()
                    }
                }
            }
            catch(e:CancellationException){throw e}
            catch(e:Exception){if(matches())state=state.copy(usageError=if(e.message?.contains("404")==true)"电脑网关需要更新后才能查看用量，请运行“更新电脑网关”。" else nativeError(e))}
            finally{if(current()){
                usageRead=null
                state=state.copy(usageLoading=false)
                // A model changed during this read: discard its result and fetch the current selection.
                if(currentCoroutineContext().isActive&&(state.model!=model||read.pending))loadUsage()
            }}
        }
    }
    fun draft(text:String){state=state.copy(draft=text);store.saveChatDraft(attachmentScope(),text)}
    internal fun messageEditTurn(event:ChatEvent):String {
        if(state.harness!="codex"||isReadOnly()||state.running||state.sending||state.uploading||state.loadingHistory||"last-message-edit" !in state.capabilities)return ""
        if(event.type!="user.message"||event.threadId!=state.threadId||event.status=="send.failed"||event.text.isBlank()||event.questionReplies.isNotEmpty())return ""
        val latest=state.events.lastOrNull{it.type=="user.message"}?:return ""
        if(latest.eventId!=event.eventId||event.eventId.isBlank())return ""
        return event.turnId.ifBlank{state.events.lastOrNull{it.type=="turn.started"}?.turnId.orEmpty()}
    }
    fun editMessage(event:ChatEvent){if(messageEditTurn(event).isNotBlank())state=state.copy(editingMessage=event,messageEditText=event.text)}
    fun messageEditText(text:String){state=state.copy(messageEditText=text)}
    fun cancelMessageEdit(){state=state.copy(editingMessage=null,messageEditText="")}
    fun saveMessageEdit(){
        val event=state.editingMessage?:return;val api=client?:return
        if(!state.connected)return
        val turn=messageEditTurn(event);if(turn.isBlank()){error("这条消息已不是最后一条，请刷新后再编辑");return}
        val text=state.messageEditText.trim();if(text.isBlank())return
        val thread=state.threads.find{it.id==state.threadId}?:ThreadRecord(state.threadId)
        val record=freezeCommand(sendingRecord(UUID.randomUUID().toString(),text,event.images,event.uploads,false),thread)
            .let{it.copy(wireCommand=JSONObject(it.wireCommand).put("replaceTurnId",turn).toString())}
        persistSend(record);pending=record;cancelMessageEdit();state=state.copy(sending=true,error="")
        if(!api.sendSocketMessage(JSONObject(record.wireCommand)))recoverPending("连接已断开，编辑尚未提交") else watchSubmission(record)
    }
    fun reuseMessage(event:ChatEvent){
        if(event.threadId.isNotBlank()&&event.threadId!=state.threadId)return
        if(isReadOnly()){error("云端快照仅供查看");return}
        if(state.uploading){error("文件上传完成后再使用历史消息");return}
        val images=(event.images+state.images).distinctBy{it.id}
        val uploads=(event.uploads+state.uploads).distinctBy{it.id}
        if(uploads.size>8){error("文件附件已满，请先移除部分文件再使用历史消息");return}
        val current=state.draft
        val included=current.trim()==event.text.trim()||event.text.isNotBlank()&&current.startsWith(event.text+"\n\n")
        val text=if(included)current else listOf(event.text,current).filter{it.isNotBlank()}.joinToString("\n\n")
        state=state.copy(draft=text,images=images,uploads=uploads)
        store.saveChatDraft(attachmentScope(),text)
    }

    private fun consoleError(e:Exception)=when((e as? LocalConsoleRequestException)?.status){404->"电脑网关需要更新，请运行“更新电脑网关”后重试。";401->"连接鉴权已失效，请重新连接或配对电脑。";else->nativeError(e)}
    fun loadLocalConsole(source:String=state.localConsole.source,range:String=state.localConsole.range,pricing:String=state.localConsole.pricing,includeInfo:Boolean=true){
        if(!state.connected)return
        if(source !in listOf("codex","agy","claude","zcode","grok","hermes","deepseek","opencode")||range !in listOf("today","week","month","year")||pricing !in listOf("codex","api"))return
        val api=client?:return;val epoch=generation
        val requestKey="$source:$range:${if(source=="codex")pricing else ""}"
        if(consoleStatisticsJob?.isActive==true&&consoleStatisticsRequest==requestKey){if(includeInfo)loadConsoleInfo();return}
        val ticket=++consoleStatisticsTicket
        consoleStatisticsJob?.cancel()
        consoleStatisticsRequest=requestKey
        val previous=state.localConsole
        // Pricing changes only the amounts; keep the token/chart layout while its first request loads.
        val retained=consoleStatisticsCache[requestKey]?:previous.statistics?.takeIf{it.source==source&&it.range==range}
        state=state.copy(localConsole=previous.copy(source=source,range=range,pricing=pricing,statistics=retained,statisticsLoading=true,statisticsError="",actionMessage=if(previous.source==source&&previous.range==range&&previous.pricing==pricing)previous.actionMessage else ""))
        consoleStatisticsJob=viewModelScope.launch {
            try{
                val result=withContext(Dispatchers.IO){api.localConsoleStatisticsAsync(source,range,pricing)}
                if(generation==epoch&&ticket==consoleStatisticsTicket&&client===api){
                    consoleStatisticsCache.remove(requestKey);consoleStatisticsCache[requestKey]=result
                    if(consoleStatisticsCache.size>8)consoleStatisticsCache.remove(consoleStatisticsCache.keys.first())
                    state=state.copy(localConsole=state.localConsole.copy(statistics=result,statisticsLoading=false))
                }
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(generation==epoch&&ticket==consoleStatisticsTicket&&client===api)state=state.copy(localConsole=state.localConsole.copy(statisticsLoading=false,statisticsError=consoleError(e)))}
        }
        if(includeInfo)loadConsoleInfo()
    }
    fun loadConsoleInfo(){
        if(!state.connected||state.localConsole.busyAction.isNotBlank())return
        if(consoleInfoJob?.isActive==true)return
        val api=client?:return;val epoch=generation;val ticket=++consoleInfoTicket
        consoleInfoJob?.cancel();state=state.copy(localConsole=state.localConsole.copy(infoLoading=true,infoError=""))
        consoleInfoJob=viewModelScope.launch {
            try{
                val info=withContext(Dispatchers.IO){api.localConsoleInfoAsync()}
                if(generation==epoch&&ticket==consoleInfoTicket&&client===api)state=state.copy(localConsole=state.localConsole.copy(info=info,infoLoading=false))
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(generation==epoch&&ticket==consoleInfoTicket&&client===api)state=state.copy(localConsole=state.localConsole.copy(infoLoading=false,infoError=consoleError(e)))}
        }
    }
    fun localConsoleAction(action:String,id:String?=null,enabled:Boolean?=null){
        if(!state.connected||state.localConsole.busyAction.isNotBlank())return
        val api=client?:return;val epoch=generation
        consoleInfoTicket++;consoleInfoJob?.cancel()
        state=state.copy(localConsole=state.localConsole.copy(busyAction=action,infoLoading=false,infoError="",actionMessage=""))
        consoleActionJob=viewModelScope.launch {
            try{
                val info=withContext(Dispatchers.IO){api.localConsoleAction(action,id,enabled)}
                if(generation!=epoch||client!==api)return@launch
                val message=when(action){"refresh"->if(info.catalog.added.isEmpty())"官方模型已检查，${if(info.catalog.changed)"目录信息已更新" else "暂无新增模型"}" else "已更新模型目录，新增 ${info.catalog.added.size} 个模型";"rebuild"->"模型目录已重建";"toggle"->if(enabled==true)"模型已启用" else "模型已隐藏";"default"->"电脑默认模型已更新";else->"已开始更新统计索引"}
                state=state.copy(localConsole=state.localConsole.copy(info=info,busyAction="",actionMessage=message))
                if(action=="index")loadLocalConsole(includeInfo=false)
                else try{
                    val models=api.nativeModelsAsync(refresh=true)
                    if(generation==epoch&&client===api){
                        val selected=if(state.harness=="opencode")nativeOpenCodeSelection(models,state.model,state.models) else null
                        state=state.copy(models=nativeModelsWithSelection(nativeModelCatalogOrDefaults(models),selected),modelsFallback=models.isEmpty(),backends=api.nativeBackendStatuses)
                        if(!applyDesktopModel()){
                        if(state.harness=="opencode")state=state.copy(model=selected?.id.orEmpty(),effort=state.effort.takeIf{it in selected?.efforts.orEmpty()}?:selected?.defaultEffort.orEmpty())
                        else{
                            models.find{it.id==state.model}?.let{current->if(state.effort !in current.efforts)state=state.copy(effort=current.defaultEffort)}
                            if(state.threadId.isBlank()&&action=="default"&&state.harness=="codex")chooseModel(info.model)
                            else if(models.none{it.id==state.model})(models.firstOrNull{it.id==info.model&&it.harness==state.harness}?:models.firstOrNull{it.harness==state.harness})?.let{chooseModel(it.id)}
                        }
                        }
                        store.saveModelsAsync(state.address,models){generation==epoch&&client===api}
                    }
                }catch(e:CancellationException){throw e}catch(e:Exception){if(generation==epoch)state=state.copy(localConsole=state.localConsole.copy(infoError="控制台操作已完成，但会话模型列表刷新失败，请重连电脑。"))}
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(generation==epoch)state=state.copy(localConsole=state.localConsole.copy(busyAction="",infoError=consoleError(e)))}
        }
    }
    private fun resetConsole(){
        accounts.reset();subagentClose=NativeSubagentCloseState()
        consoleInfoTicket++;consoleStatisticsTicket++;consoleInfoJob?.cancel();consoleStatisticsJob?.cancel();consoleActionJob?.cancel()
        consoleStatisticsRequest=null;consoleStatisticsCache.clear()
        state=state.copy(localConsole=LocalConsoleUiState(source=state.localConsole.source,range=state.localConsole.range,pricing=state.localConsole.pricing))
    }
    fun autoConnect(){if(store.baseUrl().isNotBlank()&&store.token().isNotBlank())connect(store.baseUrl(),store.token())}
    fun hasSavedPairing():Boolean = store.token().isNotBlank()
    fun connect(address:String,token:String=store.token(),code:String="",publicUrl:String=store.publicUrl(),remotePassword:String=store.remotePassword(),certificateSha256:String=store.certificateSha256(),route:ConnectionRoute=store.route()):Boolean {
        val url=gatewayBaseUrlCandidates(address,"38457").first()
        val parsed=Uri.parse(url)
        if(parsed.host.isNullOrBlank()||parsed.userInfo!=null){error("请输入有效的电脑地址");return false}
        if(parsed.scheme!="https"&&parsed.host !in setOf("127.0.0.1","localhost","10.0.2.2")){error("内网地址必须使用 HTTPS");return false}
        val remote=publicUrl.trim().trimEnd('/')
        if(remote.isNotBlank()&&(Uri.parse(remote).scheme!="https"||Uri.parse(remote).host.isNullOrBlank()||Uri.parse(remote).userInfo!=null)){error("公网地址必须是 HTTPS 地址");return false}
        if(certificateSha256.isNotBlank()&&!certificateSha256.replace(":","").matches(Regex("[0-9a-fA-F]{64}"))){error("本地证书指纹应为 64 位 SHA-256 十六进制字符");return false}
        if(route==ConnectionRoute.PUBLIC&&(remote.isBlank()||remotePassword.isBlank())){error("请先填写公网地址和独立密码");return false}
        var retryToken=if(code.isNotBlank())"" else token
        var retryCode=code
        connectionRetry={connect(url,retryToken,retryCode,remote,remotePassword,certificateSha256,route)}
        val computerChanged=url.trimEnd('/')!=state.address.trimEnd('/')||certificateSha256.lowercase()!=state.certificateSha256.lowercase()
        val firstDraft=state.draft.takeIf{state.address.isBlank()&&computerChanged}
        recoverPending()
        if(computerChanged){
            store.saveChatDraft(attachmentScope(),state.draft)
            selection++;historyTicket++;historyJob?.cancel();historyInFlightFor=null;historyTurns=10
        }
        cancelActivityLoads();localRouteProbe?.cancel();foregroundSocketCheck?.cancel();preferLocalReconnect=false
        if(code.isNotBlank())state=state.copy(threads=emptyList(),projects=emptyList(),sidebarProjects=emptyList())
        else if(url!=state.address||certificateSha256!=state.certificateSha256||state.threads.isEmpty())restoreSidebar(url,fingerprint=certificateSha256)
        clearFileContext(preserveImage=code.isBlank()&&(!computerChanged||certificateSha256.isNotBlank()&&certificateSha256.equals(state.certificateSha256,ignoreCase=true)))
        if(computerChanged||code.isNotBlank()){
            outputEventIds.clear()
            conversations.clear()
            timelineDisclosures.clear()
        }
        clearStop()
        resetStatusReads()
        dismissModelServiceNotice()
        resetConsole()
        resetNetwork();resetArchivedThreads()
        searchJob?.cancel();searchTicket++;state=state.copy(remoteSearch=NativeThreadSearch());queueMutationVersions.clear();connection?.cancel();polling?.cancel();listJob?.cancel();historyJob?.cancel();historyTicket++;historyInFlightFor=null;hydration=null;lastPinOrder=null;clearImageLoads();activityGroups.clear();activityDetails.clear();lastListRefresh=0;nextListRetryAt=0;state=state.copy(projectThreads=emptyMap(),activityLoading=emptySet(),activityErrors=emptyMap());generation++;foregroundTasks=TaskNotificationTracker();completedGoalNotices.clear();state=state.copy(taskNotice=null,automationSaving=false,automationsLoading=false,automationError="");val epoch=generation
        if(computerChanged||code.isNotBlank()||retryToken!=store.token())client=null
        store.saveProfile(url,retryToken,remote,remotePassword,certificateSha256,route)
        restoreModels(url,preserveSelection=!computerChanged&&code.isBlank())
        agentHealthController.reset();state=state.copy(route=route,address=url,publicUrl=remote,remotePassword=remotePassword,certificateSha256=certificateSha256,connecting=true,connected=false,historySyncing=false,error="",codexReady=false,codexStarting=false,codexStatusLoading=false,codexStatusError="",backendRestart=NativeBackendRestart(),backendStatusLoading=false,backendStatusError="")
            .let{next->if(!computerChanged)next else next.copy(approvals=emptySet(),approvalResults=emptyMap(),threadId="",projectId="",draft="",images=emptyList(),uploads=emptyList(),events=emptyList(),queue=emptyList(),queueDrafts=emptyList(),pendingApprovals=emptyList(),running=false,sending=false,sendingStage="",loadingHistory=false,loadingOlderHistory=false,historySyncing=false,historyErrors=emptyMap(),hasMoreHistory=false,actualModel="",usage=null,usageError="",submissionNotice="",submissionNoticeRequestId="")}
        if(computerChanged){
            if(!firstDraft.isNullOrBlank())store.saveChatDraft(attachmentScope(),firstDraft)
            state=state.copy(draft=store.chatDraft(attachmentScope()))
        }
        restoreAttachmentDraft()
        while(reconnectWake.tryReceive().isSuccess){}
        connection=viewModelScope.launch {
            var savedToken=retryToken
            var pairPending=retryCode.isNotBlank()
            var attempts=0
            var immediateLocalRetryAvailable=true
            var recentLocalHealth:Pair<GatewayHealth,Long>?=null
            val transports=mutableMapOf<Pair<String,String>,GatewayClient>()
            fun transport(candidate:String):GatewayClient=transports.getOrPut(candidate to savedToken){
                val publicConnection=candidate==remote&&remote.isNotBlank()
                GatewayClient(candidate,savedToken,remotePassword=if(publicConnection)remotePassword else "",certificateSha256=if(publicConnection)"" else certificateSha256,useDeviceCertificate=true)
            }
            while(isActive&&generation==epoch) {
                var authenticationFailed=false
                val restarted=runNativeConnectionAttempt(reconnectWake){
                val candidates=connectionRouteCandidates(url,remote,remotePassword,route)
                val reusedLocal=recentLocalHealth?.takeIf{!pairPending&&state.activeAddress==url&&url in candidates&&android.os.SystemClock.elapsedRealtime()-it.second<60000}
                val ready=reusedLocal?.let{url to it.first}?:if(route==ConnectionRoute.AUTO&&!pairPending&&candidates.size>1){
                    try{firstResponsiveRoute(candidates){candidate->
                        transport(candidate).probeHealth().also{
                            check(it.ok){"服务健康检查未通过"}
                            check(it.minAndroidProtocolVersion<=1){"请更新客户端"}
                        }
                    }}catch(e:CancellationException){throw e}
                    catch(e:Exception){
                        state=state.copy(error="连接失败：${nativeError(e)}")
                        if(e.message?.contains("401")==true)authenticationFailed=true
                        return@runNativeConnectionAttempt
                    }
                }else null
                // A cached LAN route still falls through to public if its handshake fails.
                for((index,candidate) in (if(reusedLocal!=null)candidates else ready?.let{listOf(it.first)}?:candidates).withIndex()) {
                  if(!isActive||generation!=epoch)break
                  val publicConnection=candidate==remote&&remote.isNotBlank()
                  var opened=false
                  var openedAt=0L
                  state=state.copy(activeAddress=candidate)
                  val api=transport(candidate)
                  try {
                    if(pairPending){
                        savedToken=withContext(Dispatchers.IO){api.claimPairing(retryCode).token}
                        retryToken=savedToken;retryCode="";pairPending=false
                        store.saveProfile(url,savedToken,remote,remotePassword,certificateSha256,route)
                    }
                    val health=ready?.takeIf{it.first==candidate}?.second?:api.probeHealth()
                    val healthCheckedAt=if(reusedLocal!=null&&candidate==url)reusedLocal.second else android.os.SystemClock.elapsedRealtime()
                    check(health.ok){"服务健康检查未通过"}
                    state=state.copy(capabilities=health.capabilities,threadFilter=if("thread-sidebar-filters" in health.capabilities)state.threadFilter else NativeThreadFilter.ALL)
                    check(health.minAndroidProtocolVersion<=1){"请更新客户端"}
                    val nextClient=transport(candidate)
                    if(client!==nextClient)cancelActivityLoads()
                    client=nextClient
                    val connectedApi=client!!
                    state=state.copy(activeAddress=candidate)
                    listJob?.cancel()
                    launch{refreshLists(true,reportErrors=false)}
                    val modelJob=launch modelLoad@{
                    for(modelAttempt in 0..2){try{
                    val models=connectedApi.nativeModelUpdates(){partial,pending->
                        if(generation!=epoch||client!==connectedApi)throw CancellationException("电脑连接已变化")
                        applyConnectedModelCatalog(connectedApi,candidate,partial,pending)
                    }
                    check(models.isNotEmpty()){"电脑没有返回可选模型，请重试"}
                    if(generation!=epoch||client!==connectedApi)return@modelLoad
                    store.saveModelsAsync(url,models){generation==epoch&&client===connectedApi}
                    break
                    }catch(e:CancellationException){throw e}catch(e:Exception){
                        if(generation!=epoch||client!==connectedApi)return@modelLoad
                        if(modelAttempt<2)delay((modelAttempt+1)*1000L)
                        else state=state.copy(backendStatusError="模型目录读取失败：${nativeError(e)}")
                    }}
                    }
                    try{connectedApi.events(deferActivities="mobile-live-activity-details" in health.capabilities,streamThreadId=state.threadId.takeIf{"focused-thread-stream" in health.capabilities},discardPendingOnClose=true).collect { event ->
                        if(event.type=="connection.opened") {
                            opened=true
                            openedAt=android.os.SystemClock.elapsedRealtime()
                            preferLocalReconnect=false
                            if(!publicConnection)recentLocalHealth=health to healthCheckedAt
                            historyRetryAfter.clear();state=state.copy(connected=true,connecting=false,error="",fastBusy=fastWrites[connectedApi to state.threadId]?.isActive==true);connectedApi.focusEvents(state.threadId);checkSubmission()
                            probeLocalRoute()
                            startPolling()
                        } else receive(event)
                    }}finally{modelJob.cancel()}
                  }catch(e:CancellationException){throw e}
                  catch(e:Exception){if(!preferLocalReconnect)state=state.copy(error=if(route==ConnectionRoute.LOCAL)"内网连接失败：${nativeError(e)}" else if(!publicConnection&&index==0)"内网连接中断，正在重试：${nativeError(e)}" else connectionAttemptError(nativeError(e),publicConnection,remote,remotePassword));if(e.message?.contains("401")==true){authenticationFailed=true;break}}
                  finally{if(generation==epoch){
                  localRouteProbe?.cancel()
                  polling?.cancel()
                  listJob?.cancel()
                  resetStatusReads()
                  // A replacement socket must not inherit an HTTP read from the
                  // failed transport, even when the same GatewayClient is reused.
                  historyTicket++;historyInFlightFor=null;historyRead=null;historyJob?.cancel();hydration=null
                  recoverPending();state=state.copy(connected=false,connecting=true,historySyncing=false,loadingHistory=false,loadingOlderHistory=false)
                  }}
                  if(opened&&android.os.SystemClock.elapsedRealtime()-openedAt>=5000L){attempts=0;immediateLocalRetryAvailable=true}
                  if(opened&&!publicConnection&&uiForeground&&immediateLocalRetryAvailable){preferLocalReconnect=true;immediateLocalRetryAvailable=false}
                  if(preferLocalReconnect||opened&&!publicConnection)break
                }
                }
                if(restarted)preferLocalReconnect=true
                if(authenticationFailed){state=state.copy(connected=false,connecting=false);return@launch}
                polling?.cancel();recoverPending();state=state.copy(connected=false,connecting=true)
                if(preferLocalReconnect){preferLocalReconnect=false;attempts=0;reconnectWake.tryReceive()}else{attempts++;awaitReconnectRetry(attempts)}
            }
        }
        return true
    }
    fun connectRoute(route:ConnectionRoute){
        if(!hasSavedPairing()){error("请先连接电脑并完成配对");return}
        connect(state.address,publicUrl=state.publicUrl,remotePassword=state.remotePassword,certificateSha256=state.certificateSha256,route=route)
    }
    fun disconnect(){cancelActivityLoads();agentHealthController.reset();localRouteProbe?.cancel();foregroundSocketCheck?.cancel();preferLocalReconnect=false;clearFileContext();clearStop();resetStatusReads();resetConsole();resetNetwork();resetArchivedThreads();searchJob?.cancel();searchTicket++;state=state.copy(remoteSearch=NativeThreadSearch());queueMutationVersions.clear();generation++;foregroundTasks=TaskNotificationTracker();completedGoalNotices.clear();state=state.copy(taskNotice=null,automationSaving=false,automationsLoading=false,automationError="");connection?.cancel();polling?.cancel();listJob?.cancel();historyJob?.cancel();historyTicket++;historyInFlightFor=null;hydration=null;clearImageLoads();recoverPending();state=state.copy(connected=false,connecting=false,historySyncing=false,loadingHistory=false,loadingOlderHistory=false,codexReady=false,codexStarting=false,codexStatusLoading=false,codexStatusError="",backendRestart=NativeBackendRestart(),backendStatusLoading=false,backendStatusError="")}
    fun chooseModel(id:String){if(state.models.any{it.id==id&&!it.available}){error(state.models.find{it.id==id}?.unavailableReason.orEmpty());return};modelRevision++;if(nativeAgent(id)!=state.harness){error("请在新会话中切换助手");return};val m=state.models.find{it.id==id}?:return;val saved=prefs.getString("effort:$id",nativeTaskDefaultEffort(id,m.defaultEffort)).orEmpty();state=state.copy(model=id,effort=if(saved in m.efforts)saved else m.defaultEffort);prefs.edit().putString("model:${state.harness}",id).apply();rememberThreadSettings();if(state.harness=="antigravity"){resetUsageRefresh();state=state.copy(modelServiceNotice=state.modelServiceNotice?.takeUnless{it.quotaSnapshot});if(state.connected)loadUsage()}}
    fun effort(value:String){modelRevision++;if(state.models.find{it.id==state.model}?.efforts?.contains(value)==true){state=state.copy(effort=value);prefs.edit().putString("effort:${state.model}",value).apply();rememberThreadSettings()}}
    fun permission(value:String){if(value in setOf("ask","auto","full")||(value=="custom"&&state.harness=="codex")){state=state.copy(permission=value);prefs.edit().putString("permission:${state.harness}",value).apply();rememberThreadSettings()}}
    fun loadRemoteApproval()=remoteApprovalSetting(null)
    fun setRemoteAutoApproval(enabled:Boolean)=remoteApprovalSetting(enabled)
    private fun remoteApprovalSetting(enabled:Boolean?){
        val api=client?:return;val epoch=generation;val revision=statusReadRevision
        if(state.remoteApprovalBusy)return
        state=state.copy(remoteApprovalBusy=true)
        viewModelScope.launch{
            fun current()=api===client&&epoch==generation&&revision==statusReadRevision
            try{
                val result=withContext(Dispatchers.IO){api.nativeJson(if(enabled==null)"GET" else "PUT","/api/settings/remote-approval",enabled?.let{JSONObject().put("desktopAutoApprove",it)})}
                if(current())state=state.copy(desktopAutoApprove=result.optBoolean("desktopAutoApprove"),approvalBridgeConfigured=result.optBoolean("bridgeConfigured"),approvalBridgeConnected=result.optBoolean("connected"),error=if(result.optInt("failed")>0)"部分待处理审批未能自动完成，请手动处理" else state.error)
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current())state=state.copy(error=nativeError(e))}
            finally{if(current())state=state.copy(remoteApprovalBusy=false)}
        }
    }
    fun loadCapacityRetry()=capacityRetrySetting(null)
    fun setCapacityAutoRetry(enabled:Boolean)=capacityRetrySetting(enabled)
    private fun capacityRetrySetting(enabled:Boolean?){
        val api=client?:return;val epoch=generation;val revision=statusReadRevision
        if(state.capacityRetryBusy)return
        state=state.copy(capacityRetryBusy=true,capacityRetryError="")
        viewModelScope.launch{
            fun current()=api===client&&epoch==generation&&revision==statusReadRevision
            try{
                val result=withContext(Dispatchers.IO){api.nativeJson(if(enabled==null)"GET" else "PUT","/api/settings/capacity-retry",enabled?.let{JSONObject().put("enabled",it)})}
                if(current())state=state.copy(capacityAutoRetry=result.optBoolean("enabled"))
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current())state=state.copy(capacityRetryError=nativeError(e))}
            finally{if(current())state=state.copy(capacityRetryBusy=false)}
        }
    }
    private fun rememberThreadSettings(){if(state.threadId.isNotBlank())prefs.edit().putString("thread:${state.threadId}:model",state.model).putString("thread:${state.threadId}:effort",state.effort).putString("thread:${state.threadId}:permission",state.permission).apply()}
    fun switchHarness(harness:String){
        if(harness!=state.harness)dismissModelServiceNotice()
        if(harness==state.harness)return
        if(!nativeBackendAvailable(harness,state.models,state.backends)){error(nativeBackendReason(harness,state.models,state.backends));return}
        searchJob?.cancel();searchTicket++;state=state.copy(remoteSearch=NativeThreadSearch())
        if(state.sending){error("消息正在提交，请稍后切换");return}
        store.saveChatDraft(attachmentScope(),state.draft)
        prefs.edit().putString("workspace:"+state.harness+":thread",state.threadId).putString("workspace:"+state.harness+":project",state.projectId).apply()
        state=state.copy(harness=harness,draft="",images=emptyList(),uploads=emptyList(),codexStarting=false,codexStatusLoading=false,codexStatusError="");prefs.edit().putString("harness",harness).apply()
        restoreSidebar(state.address,harness)
        val project=state.projects.find{it.id==prefs.getString("workspace:"+harness+":project","")}
        newThread(project,false)
        val thread=state.threads.find{it.id==prefs.getString("workspace:"+harness+":thread","")&&nativeThreadAgent(it.id)==harness}
        if(thread!=null)openThread(thread)
        lastListRefresh=0
        notificationThreadId=if(thread==null)prefs.getString("workspace:"+harness+":thread","").orEmpty() else ""
        viewModelScope.launch{refreshLists(true)}
        state=state.copy(error="",usage=null,usageError="",files=emptyList(),file=null,fileDraft="",terminal="",terminalSession="",diff="",remoteSearch=NativeThreadSearch())
    }
    fun selectNewProject(project:Project?){
        if(state.threadId.isNotBlank())return
        clearFileContext()
        if(project==null){assignDraftProject("");return}
        val api=client;val epoch=generation;val chosen=selection;val ticket=projectTicket
        val existing=state.projects.find{nativePath(it.path)==nativePath(project.path)}
        fun current()=ticket==projectTicket&&epoch==generation&&chosen==selection&&api===client&&state.threadId.isBlank()
        scopedWork(::current){val added=existing?:checkNotNull(api){"尚未连接电脑，请先连接后重试"}.addProject(project.path);withContext(Dispatchers.Main){if(current()){state=state.copy(projects=state.projects.filter{it.id!=added.id}+added);assignDraftProject(added.id)}}}
    }
    fun createNewProject(path:String,done:()->Unit){
        clearFileContext();val api=client;val epoch=generation;val chosen=selection;val ticket=projectTicket
        fun current()=ticket==projectTicket&&epoch==generation&&chosen==selection&&api===client
        scopedWork(::current){val added=checkNotNull(api){"尚未连接电脑，请先连接后重试"}.addProject(path.trim(),true)
            withContext(Dispatchers.Main){if(current()){state=state.copy(projects=state.projects.filter{it.id!=added.id}+added);if(state.threadId.isBlank())assignDraftProject(added.id) else newThread(added);done()}}
        }
    }
    fun newThread(project:Project?=null,saveCurrent:Boolean=true){
        cancelActivityLoads()
        clearFileContext()
        if(saveCurrent)rememberConversation()
        recoverPending()
        clearStop()
        resetUsageRefresh()
        clearConversationModelServiceNotice()
        if(saveCurrent)store.saveChatDraft(attachmentScope(),state.draft);selection++;historyTicket++;historyInFlightFor=null;historyJob?.cancel()
        historyTurns=10
        val candidates=state.models.filter{it.harness==state.harness&&it.available}
        val preferred=if(state.harness=="opencode")nativeOpenCodeSelection(state.models,prefs.getString("model:opencode","").orEmpty()) else candidates.find{it.id==prefs.getString("model:"+state.harness,prefs.getString("model",""))}?:candidates.find{it.id=="gpt-6-sol"}?:candidates.find{it.id=="gpt-6.1-sol"}?:candidates.find{it.id.endsWith("::default")}?:candidates.firstOrNull()
        val effort=if(state.modelsFallback)"high" else prefs.getString("effort:"+preferred?.id,nativeTaskDefaultEffort(preferred?.id.orEmpty(),preferred?.defaultEffort.orEmpty())).orEmpty()
        state=state.copy(models=nativeModelsWithSelection(state.models,preferred),threadId="",submissionNotice="",submissionNoticeRequestId="",actualModel="",nextMode="default",fastMode=null,sessionFast=null,projectId=project?.id.orEmpty(),model=preferred?.id.orEmpty(),effort=if(effort in preferred?.efforts.orEmpty())effort else preferred?.defaultEffort.orEmpty(),permission=prefs.getString("permission:"+state.harness,"full")?:"full",events=emptyList(),pendingApprovals=emptyList(),queue=emptyList(),queueDrafts=emptyList(),canSteer=false,running=false,sending=false,loadingHistory=false,loadingOlderHistory=false,historySyncing=false,historyErrors=emptyMap(),hasMoreHistory=false,usage=null,usageError="")
        state=state.copy(draft=store.chatDraft(attachmentScope()));restoreAttachmentDraft()
    }
    fun startInProject(project:Project){
        val allowed=state.projects.find{nativePath(it.path)==nativePath(project.path)}
        if(allowed!=null){newThread(allowed);return}
        val api=client?:return;val epoch=generation;val chosen=selection
        fun current()=epoch==generation&&api===client
        scopedWork({current()&&chosen==selection}){
            val added=api.addProject(project.path)
            withContext(Dispatchers.Main){if(current()){
                state=state.copy(projects=state.projects.filter{it.id!=added.id}+added)
                if(chosen==selection)newThread(added)
            }}
        }
    }
    fun renameThread(thread:ThreadRecord,title:String){
        if(thread.readOnly||nativeReadOnlyThreadId(thread.id)){error("云端快照仅供查看");return}
        if(title.isBlank())return
        val api=client?:return;val epoch=generation
        fun current()=epoch==generation&&api===client
        scopedWork(::current){
            api.renameThread(thread.id,title.trim())
            withContext(Dispatchers.Main){if(current()){
                fun updated(row:ThreadRecord)=if(row.id==thread.id)row.copy(title=title.trim())else row
                state=state.copy(threads=state.threads.map(::updated),projectThreads=state.projectThreads.mapValues{(_,page)->page.copy(rows=page.rows.map(::updated))})
                refreshLists(true)
            }}
        }
    }
    fun pinThread(thread:ThreadRecord,pinned:Boolean){
        if(thread.readOnly||nativeReadOnlyThreadId(thread.id)){error("云端快照仅供查看");return}
        val api=client?:return;val epoch=generation
        fun current()=epoch==generation&&api===client
        scopedWork(::current){
            api.nativeJson("POST","/api/threads/${thread.id}/pin",JSONObject().put("pinned",pinned))
            withContext(Dispatchers.Main){if(current()){
                fun updated(row:ThreadRecord)=if(row.id==thread.id)row.copy(pinnedIndex=if(pinned)0 else -1)else row
                state=state.copy(threads=state.threads.map(::updated),projectThreads=state.projectThreads.mapValues{(_,page)->page.copy(rows=page.rows.map(::updated))})
                refreshLists(true)
            }}
        }
    }
    private val goalOperations=mutableStateMapOf<Pair<Int,String>,Any>()
    var threadSections by mutableStateOf<List<NativeThreadSection>>(emptyList());private set
    private var threadSectionsJob:Job?=null
    fun loadThreadSections(){
        val api=client?:return;if(!state.connected||threadSectionsJob?.isActive==true)return
        val epoch=generation
        threadSectionsJob=viewModelScope.launch{
            try{
                val rows=withContext(Dispatchers.IO){api.nativeJsonAsync("GET","/api/thread-sections").getJSONArray("sections")}
                if(epoch==generation&&api===client)threadSections=(0 until rows.length()).map{rows.getJSONObject(it).let{row->NativeThreadSection(row.getString("id"),row.optString("name"))}}
            }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation&&api===client)error(nativeError(e))}
        }
    }
    fun moveThreadToProject(thread:ThreadRecord,project:Project)=moveThread(thread,JSONObject().put("projectPath",project.path),project)
    fun moveThreadToSection(thread:ThreadRecord,sectionId:String?)=moveThread(thread,JSONObject().put("sectionId",sectionId?:JSONObject.NULL))
    private fun moveThread(thread:ThreadRecord,body:JSONObject,project:Project?=null){
        val api=client?:return;if(!state.connected||thread.readOnly||nativeReadOnlyThreadId(thread.id)||nativeThreadAgent(thread.id)!="codex")return
        val epoch=generation
        fun current()=epoch==generation&&api===client
        scopedWork(::current){
            api.moveThread(thread.id,body)
            withContext(Dispatchers.Main){if(current()){
                listJob?.cancel();listTicket++
                if(project!=null){
                    state=state.copy(threads=state.threads.map{if(it.id==thread.id)it.copy(projectPath=project.path)else it},projectThreads=emptyMap(),projectId=if(state.threadId==thread.id)project.id else state.projectId)
                }
                rememberSidebar();refreshSidebar()
            }}
        }
    }
    fun markThreadUnread(thread:ThreadRecord){
        val api=client?:return;if(!state.connected||thread.readOnly||nativeReadOnlyThreadId(thread.id))return
        val epoch=generation;val readJob=pendingReadJobs[thread.id]
        if(state.threadId==thread.id)manualUnreadSelection=selection
        fun current()=epoch==generation&&api===client
        scopedWork(::current){
            // Finish an already issued automatic read before applying the explicit unread override.
            readJob?.join()
            val completedAt=api.markThreadUnread(thread.id)
            withContext(Dispatchers.Main){if(current()){
                listJob?.cancel();listTicket++
                fun updated(row:ThreadRecord)=if(row.id==thread.id)row.copy(unread=true,completedAt=completedAt.takeIf{it>0}?:row.completedAt)else row
                state=state.copy(threads=state.threads.map(::updated),projectThreads=state.projectThreads.mapValues{(_,page)->page.copy(rows=page.rows.map(::updated))})
                rememberSidebar();refreshSidebar()
            }}
        }
    }
    private val goalFailures=mutableStateMapOf<Pair<Int,String>,String>()
    internal fun goalWorkBusy(threadId:String)=goalOperations.containsKey(generation to threadId)
    internal fun goalError(threadId:String)=goalFailures[generation to threadId].orEmpty()
    private fun goalWork(threadId:String,current:()->Boolean,action:suspend ()->Unit):Job?{
        val key=generation to threadId
        if(goalOperations.containsKey(key))return null
        val token=Any();goalOperations[key]=token;goalFailures.remove(key)
        goalFailures.keys.filter{it.first!=generation}.forEach{goalFailures.remove(it)}
        return scopedWork(current){
            try{action()}
            catch(e:CancellationException){throw e}
            catch(e:Exception){withContext(Dispatchers.Main){if(current()&&goalOperations[key]===token)goalFailures[key]=nativeError(e)};throw e}
            finally{withContext(NonCancellable+Dispatchers.Main){if(goalOperations[key]===token)goalOperations.remove(key)}}
        }
    }
    fun updateGoal(threadId:String,objective:String?=null,status:String?=null,draftToClear:String?=null,onSaved:(()->Unit)?=null,onFailed:((String)->Unit)?=null){
        if(goalWorkBusy(threadId)){onFailed?.invoke("目标操作正在处理中，请稍后重试");return}
        val body=JSONObject();if(objective!=null)body.put("objective",objective);if(status!=null)body.put("status",status)
        val api=client?:run{val message="尚未连接电脑，请先连接后保存";onFailed?.invoke(message);error(message);return};val epoch=generation;val chosen=selection;val draftKey=attachmentScope()
        fun current()=epoch==generation&&client===api&&chosen==selection&&state.threadId==threadId
        val requestId=if(draftToClear!=null)UUID.randomUUID().toString() else null
        if(requestId!=null){activeComposerSubmission=requestId;state=state.copy(sending=true,error="")}
        goalWork(threadId,{epoch==generation&&client===api&&chosen==selection}){
            try{
                val result=api.nativeJson("PATCH","/api/threads/$threadId/goal",body);val goal=result.optJSONObject("goal")
                if(draftToClear!=null||objective!=null)check(goal!=null){"电脑未返回目标状态，输入已保留"}
                withContext(Dispatchers.Main){if(epoch==generation&&client===api)state=state.copy(threads=state.threads.map{if(it.id==threadId)it.copy(goal=if(status=="complete"||goal==null)null else goal.toNativeGoal().let{updated->updated.copy(id=updated.id.ifBlank{it.goal?.id.orEmpty()},timeUsedSeconds=updated.timeUsedSeconds?:it.goal?.timeUsedSeconds)})else it})}
                withContext(Dispatchers.Main){if(draftToClear!=null){
                    if(store.chatDraft(draftKey)==draftToClear)store.saveChatDraft(draftKey,"")
                    if(attachmentScope()==draftKey&&state.draft==draftToClear)state=state.copy(draft="")
                }}
                withContext(Dispatchers.Main){if(current())onSaved?.invoke() else onFailed?.invoke("连接或会话已改变，请重新检查目标后保存")}
            }catch(e:CancellationException){throw e}
            catch(e:Exception){withContext(Dispatchers.Main){onFailed?.invoke(if(current())nativeError(e) else "连接或会话已改变，请重新检查目标后保存")};throw e
            }finally{
                if(requestId!=null)withContext(Dispatchers.Main){if(activeComposerSubmission==requestId){activeComposerSubmission=null;if(pending==null)state=state.copy(sending=false)}}
                // Refresh persisted state even when the update reply was lost.
                if(epoch==generation&&client===api)viewModelScope.launch{refreshLists(true)}
            }
        }
    }
    fun continueGoal(threadId:String){
        if(goalWorkBusy(threadId))return
        if(state.sending){goalFailures[generation to threadId]="消息正在发送，请等待确认后继续目标";return}
        val api=client?.takeIf{state.connected}?:run{goalFailures[generation to threadId]="尚未连接电脑，请连接后继续";return};val epoch=generation;val chosen=selection
        val body=JSONObject().put("requestId",UUID.randomUUID().toString()).put("model",state.model).put("effort",state.effort).put("permission",state.permission).put("mode",state.nextMode)
        state.fastMode?.let{body.put("fast",it)}
        goalWork(threadId,{epoch==generation&&client===api&&chosen==selection&&state.threadId==threadId}){
            try{
                val result=api.nativeJson("POST","/api/threads/$threadId/goal/continue",body)
                withContext(Dispatchers.Main){if(epoch==generation&&client===api){
                    result.optJSONObject("goal")?.let{goal->state=state.copy(threads=state.threads.map{if(it.id==threadId)it.copy(goal=goal.toNativeGoal().let{updated->updated.copy(id=updated.id.ifBlank{it.goal?.id.orEmpty()},timeUsedSeconds=updated.timeUsedSeconds?:it.goal?.timeUsedSeconds)})else it})}
                    if(chosen==selection&&state.threadId==threadId)state=state.copy(running=true)
                }}
            }finally{if(epoch==generation&&client===api)viewModelScope.launch{refreshLists(true);if(epoch==generation&&client===api&&chosen==selection&&state.threadId==threadId)refreshHistory()}}
        }
    }
    private var automationListTicket=0
    suspend fun automationTargets(query:String,limit:Int):Pair<List<ThreadRecord>,Boolean>{
        val api=client?:throw IllegalStateException("请先连接电脑")
        val epoch=generation
        val result=api.nativeJsonAsync("GET","/api/automations/targets?q=${java.net.URLEncoder.encode(query,"UTF-8")}&limit=$limit")
        if(epoch!=generation||client!==api)throw CancellationException("连接已改变")
        val rows=result.getJSONArray("threads")
        return (0 until rows.length()).map{rows.getJSONObject(it).toThreadRecord()} to result.optBoolean("hasMore")
    }
    fun closeAutomations(){state=state.copy(automationsVisible=false,automationFocus="")}
    fun loadAutomations(focus:String="",open:Boolean=true){
        val api=client?:return;val epoch=generation;val ticket=++automationListTicket
        fun current()=epoch==generation&&client===api&&ticket==automationListTicket
        state=state.copy(automationsVisible=open||state.automationsVisible,automationsLoading=true,automationError="",automationFocus=if(open)focus else state.automationFocus)
        viewModelScope.launch{
            try{
                val result=withContext(Dispatchers.IO){api.nativeJson("GET","/api/automations")}
                val rows=result.optJSONArray("automations")
                if(current())state=state.copy(automations=(0 until (rows?.length()?:0)).map{rows!!.getJSONObject(it).toNativeAutomation()})
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current())state=state.copy(automationError=nativeError(e))}
            finally{if(current())state=state.copy(automationsLoading=false)}
        }
    }
    fun saveAutomation(id:String?,body:JSONObject,done:()->Unit={}){
        val api=client?:return;val epoch=generation
        if(!state.connected||state.automationSaving)return
        fun current()=epoch==generation&&client===api
        state=state.copy(automationSaving=true,automationError="")
        viewModelScope.launch{
            try{
                withContext(Dispatchers.IO){api.nativeJson(if(id==null)"POST" else "PATCH","/api/automations"+(id?.let{"/$it"}?:""),body)}
                if(current()){done();loadAutomations(open=false)}
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current())state=state.copy(automationError=nativeError(e))}
            finally{if(current())state=state.copy(automationSaving=false)}
        }
    }
    fun searchRemote(query:String,agent:String){
        searchJob?.cancel()
        val trimmed=query.trim()
        val ticket=++searchTicket
        if(trimmed.length<2||client==null||!state.connected){
            state=state.copy(remoteSearch=NativeThreadSearch())
            return
        }
        val api=client!!;val epoch=generation
        fun current()=ticket==searchTicket&&epoch==generation&&client===api&&state.harness==agent&&state.connected
        state=state.copy(remoteSearch=NativeThreadSearch(trimmed,agent,loading=true))
        searchJob=viewModelScope.launch{
            try{
                delay(250)
                val matches=api.searchThreads(trimmed,agent)
                if(current())state=state.copy(remoteSearch=NativeThreadSearch(trimmed,agent,matches))
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(remoteSearch=NativeThreadSearch(trimmed,agent,error=nativeError(e)))}
            finally{if(current()&&state.remoteSearch.loading)state=state.copy(remoteSearch=state.remoteSearch.copy(loading=false))}
        }
    }
    private var notificationThreadId=""
    fun openNotificationThread(id:String){
        if(id.isBlank())return
        notificationThreadId=id
        if(state.connected){
            val thread=state.threads.find{it.id==id}
            if(thread!=null){notificationThreadId="";openThread(thread)}
            else viewModelScope.launch{refreshLists(true)}
        }
    }
    fun openThread(thread:ThreadRecord){cancelActivityLoads();if(state.taskNotice?.threadId==thread.id)state=state.copy(taskNotice=null);clearFileContext();rememberConversation();val cached=conversations.get(conversationKey(thread.id,nativeThreadAgent(thread.id)));recoverPending();clearStop();resetUsageRefresh();if(nativeThreadAgent(thread.id)!=state.harness)dismissModelServiceNotice() else clearConversationModelServiceNotice();state=state.copy(threads=(state.threads+thread).distinctBy{it.id});desktopModels.remove(thread.id);store.saveChatDraft(attachmentScope(),state.draft);state=state.copy(harness=nativeThreadAgent(thread.id));prefs.edit().putString("harness",state.harness).apply();selection++;historyTicket++;historyInFlightFor=null;historyJob?.cancel();historyTurns=(cached?.turns?:readingPositions.get(readingPositionKey(thread.id))?.historyTurns?:10).coerceIn(10,2000);val chosenModel=prefs.getString("thread:${thread.id}:model",state.model).orEmpty();val candidates=state.models.filter{it.harness==nativeThreadAgent(thread.id)};val model=if(state.harness=="opencode")nativeOpenCodeSelection(state.models,chosenModel) else candidates.find{it.id==chosenModel}?:candidates.find{it.id=="gpt-6-sol"}?:candidates.find{it.id=="gpt-6.1-sol"}?:candidates.firstOrNull();val chosenEffort=prefs.getString("thread:${thread.id}:effort",model?.let{nativeTaskDefaultEffort(it.id,it.defaultEffort)}).orEmpty();state=state.copy(models=nativeModelsWithSelection(state.models,model),threadId=thread.id,submissionNotice="",submissionNoticeRequestId="",actualModel=cached?.actualModel.orEmpty(),nextMode="default",fastMode=null,sessionFast=null,projectId=state.projects.find{nativePath(it.path)==nativePath(thread.projectPath)}?.id.orEmpty(),model=model?.id.orEmpty(),effort=if(chosenEffort in model?.efforts.orEmpty())chosenEffort else model?.defaultEffort.orEmpty(),permission=prefs.getString("thread:${thread.id}:permission",prefs.getString("permission:${state.harness}","full"))?:"full",events=cached?.events.orEmpty(),queue=emptyList(),queueDrafts=emptyList(),canSteer=false,running=thread.status=="running",sending=false,loadingHistory=cached==null,loadingOlderHistory=false,historySyncing=false,historyErrors=emptyMap(),hasMoreHistory=cached?.hasMore?:false,activityLoading=emptySet(),activityErrors=emptyMap(),usage=null,usageError="");state=state.copy(draft=store.chatDraft(attachmentScope()));restoreAttachmentDraft();viewModelScope.launch{refreshLists(true)};viewModelScope.launch{refreshHistory(force=true)}}
    fun loadOlderHistory(){if(state.threadId.isBlank()||!state.hasMoreHistory||state.loadingOlderHistory||historyInFlightFor!=null)return;historyTurns=(historyTurns+10).coerceAtMost(2000);state=state.copy(loadingOlderHistory=true);viewModelScope.launch{refreshHistory(force=true)}}
    suspend fun refresh(){refreshLists();refreshHistory()}
    private var lastListRefresh=0L
    private var nextListRetryAt=0L
    private var listTicket=0
    fun loadMoreThreads(){if(state.loadingSidebar||!state.moreThreads)return;threadLimit+=10;viewModelScope.launch{refreshLists(true)}}
    private val closingSubagents=mutableSetOf<Pair<GatewayClient,String>>()
    var archivedThreads by mutableStateOf<List<ThreadRecord>>(emptyList());private set
    var archivedThreadsLoading by mutableStateOf(false);private set
    var archivedThreadsError by mutableStateOf("");private set
    private var archivedThreadsJob:Job?=null
    private fun resetArchivedThreads(){archivedThreadsJob?.cancel();archivedThreads=emptyList();archivedThreadsLoading=false;archivedThreadsError="";threadSectionsJob?.cancel();threadSections=emptyList()}
    fun loadArchivedThreads(){
        val api=client?:return;if(!state.connected||archivedThreadsLoading)return
        val epoch=generation;val harness=state.harness
        fun current()=epoch==generation&&api===client&&harness==state.harness
        archivedThreadsLoading=true;archivedThreadsError=""
        archivedThreadsJob=viewModelScope.launch{
            try{val rows=withContext(Dispatchers.IO){api.archivedThreads(harness)};if(current())archivedThreads=rows}
            catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())archivedThreadsError=nativeError(e)}
            finally{if(epoch==generation&&api===client)archivedThreadsLoading=false}
        }
    }
    fun restoreArchivedThread(thread:ThreadRecord){
        val api=client?:return;if(!state.connected)return
        val epoch=generation;val key=api to thread.id;if(!closingSubagents.add(key))return
        fun current()=epoch==generation&&api===client
        scopedWork(::current){try{
            api.restoreArchivedThread(thread.id)
            withContext(Dispatchers.Main){if(current()){
                archivedThreads=archivedThreads.filter{it.id!=thread.id}
                refreshSidebar()
            }}
        }finally{withContext(NonCancellable+Dispatchers.Main){closingSubagents.remove(key)}}}
    }
    fun closeSubagent(thread:ThreadRecord){
        val api=client?:return;if(!state.connected||thread.subagent==null||thread.readOnly||subagentClose.busy)return
        val epoch=generation;subagentClose=NativeSubagentCloseState(thread=thread,busy=true,message="正在确认子代理状态…")
        viewModelScope.launch{try{
            val preview=withContext(Dispatchers.IO){api.subagentClosePreview(thread.id)}
            if(epoch!=generation||client!==api)return@launch
            if(preview.optBoolean("running"))subagentClose=subagentClose.copy(busy=false,confirmStop=true,message="")
            else if(preview.optBoolean("canArchive"))completeSubagentClose(false)
            else subagentClose=subagentClose.copy(busy=false,error=preview.optString("error").ifBlank{"暂时无法确认子代理状态，请重试"},message="")
        }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation&&client===api)subagentClose=subagentClose.copy(busy=false,error=nativeError(e),message="")}}
    }
    fun completeSubagentClose(stopRunning:Boolean){
        val thread=subagentClose.thread?:return;val api=client?:return;val parent=thread.subagent?.parentThreadId?:return
        if(!state.connected)return
        val epoch=generation;subagentClose=subagentClose.copy(busy=true,confirmStop=false,error="",message=if(stopRunning)"正在停止该子代理并关闭…" else "正在关闭子代理…")
        viewModelScope.launch{try{
            val result=withContext(Dispatchers.IO){api.closeSubagent(thread.id,parent,stopRunning)}
            if(epoch!=generation||client!==api)return@launch
            val closedRows=result.optJSONArray("closedThreadIds")
            val closedIds=(0 until (closedRows?.length()?:0)).mapNotNull{index->closedRows?.optString(index)?.takeIf{it.isNotBlank()}}.toSet()+thread.id
            listJob?.cancel();listTicket++
            state=state.copy(threads=state.threads.filter{it.id !in closedIds},projectThreads=state.projectThreads.mapValues{(_,page)->page.copy(rows=page.rows.filter{it.id !in closedIds})})
            archivedThreads=(listOf(thread.copy(closureKind=result.optString("closureKind").takeIf{it.isNotBlank()}))+archivedThreads).distinctBy{it.id}
            if(state.threadId in closedIds)openThread(state.threads.firstOrNull{it.id==parent}?:ThreadRecord(parent,projectPath=thread.projectPath))
            subagentClose=NativeSubagentCloseState();rememberSidebar();refreshSidebar();loadArchivedThreads()
        }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation&&client===api)subagentClose=subagentClose.copy(busy=false,error=nativeError(e),message="")}}
    }
    fun archiveThread(thread:ThreadRecord){
        val api=client?:return;val parent=thread.subagent?.parentThreadId.orEmpty()
        if(!state.connected||thread.readOnly||nativeReadOnlyThreadId(thread.id))return
        if(thread.status in setOf("running","starting")||thread.goal?.status=="active"){error("会话仍在运行，请先停止再归档");return}
        val key=api to thread.id;if(!closingSubagents.add(key))return
        val epoch=generation
        fun current()=epoch==generation&&api===client
        scopedWork(::current){try{
            api.archiveThread(thread.id)
            withContext(Dispatchers.Main){if(current()){
                listJob?.cancel();listTicket++
                state=state.copy(threads=state.threads.filter{it.id!=thread.id},projectThreads=state.projectThreads.mapValues{(_,page)->page.copy(rows=page.rows.filter{it.id!=thread.id})})
                if(state.threadId==thread.id){
                    if(parent.isNotBlank())openThread(state.threads.firstOrNull{it.id==parent}?:ThreadRecord(parent,projectPath=thread.projectPath)) else newThread()
                }
                archivedThreads=(listOf(thread)+archivedThreads).distinctBy{it.id}
                rememberSidebar();refreshSidebar()
            }}
        }finally{withContext(NonCancellable+Dispatchers.Main){closingSubagents.remove(key)}}}
    }
    fun loadMoreProjects(){if(state.loadingSidebar||!state.moreProjects)return;projectLimit+=5;viewModelScope.launch{refreshLists(true)}}
    fun loadProjectThreads(project:Project,more:Boolean=false,force:Boolean=false){
        val api=client?:return;val epoch=generation;val harness=state.harness;val filter=state.threadFilter;val filterRevision=sidebarFilterRevision
        val key=harness+":"+nativePath(project.path)
        val previous=state.projectThreads[key]?:NativeProjectThreads()
        if(previous.loading||(more&&!previous.hasMore))return
        if(!force&&!more&&previous.loaded&&android.os.SystemClock.elapsedRealtime()-previous.loadedAtMs<30_000L)return
        val limit=if(more)previous.limit+10 else previous.limit
        state=state.copy(projectThreads=state.projectThreads+(key to previous.copy(loading=true)))
        viewModelScope.launch{
            try{
                val page=withContext(Dispatchers.IO){api.sidebarThreads(limit,harness,"",project.path,filter)}
                if(epoch==generation&&filterRevision==sidebarFilterRevision&&filter==state.threadFilter&&harness==state.harness)state=state.copy(projectThreads=state.projectThreads+(key to NativeProjectThreads(page.first,limit,page.second,false,true,android.os.SystemClock.elapsedRealtime())))
            }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation&&filterRevision==sidebarFilterRevision&&filter==state.threadFilter&&harness==state.harness){state=state.copy(projectThreads=state.projectThreads+(key to previous));error(nativeError(e))}}
        }
    }
    private suspend fun refreshPinOrder(){
        val api=client?:return;val epoch=generation
        if(state.harness!="codex"||"sidebar-pin-sync" !in state.capabilities)return
        try{
            val pins=withContext(Dispatchers.IO){api.sidebarPins()}
            if(epoch!=generation||api!==client)return
            if(lastPinOrder==pins)return
            lastPinOrder=pins
            val order=pins.withIndex().associate{it.value to it.index+1}
            fun updated(row:ThreadRecord)=if(nativeThreadAgent(row.id)=="codex")row.copy(pinnedIndex=order[row.id]?:-1)else row
            state=state.copy(threads=state.threads.map(::updated),projectThreads=state.projectThreads.mapValues{(_,page)->page.copy(rows=page.rows.map(::updated))})
            refreshLists(true)
        }catch(e:CancellationException){throw e}catch(_:Exception){/* Keep the last known order until the next successful poll. */}
    }
    private suspend fun refreshLists(force:Boolean=false,reportErrors:Boolean=force){
        if(listJob?.isActive==true){if(force)sidebarRefreshPending=true;return}
        if(!force&&(System.currentTimeMillis()-lastListRefresh<15000||android.os.SystemClock.elapsedRealtime()<nextListRetryAt))return
        // All entry points share the same load, including navigation and socket events.
        // Joining a cancelled read must not cancel the long-lived polling loop.
        val job=viewModelScope.launch(start=CoroutineStart.LAZY){
            var forced=force
            do{
                if(forced)delay(150)
                sidebarRefreshPending=false
                performListRefresh(forced,reportErrors)
                forced=true
            }while(sidebarRefreshPending&&state.connected)
        }
        listJob=job;job.start()
        try{job.join()}finally{if(!currentCoroutineContext().isActive)job.cancel()}
    }
    private suspend fun performListRefresh(force:Boolean,reportErrors:Boolean){
        val api=client?:return;val epoch=generation
        if(!force&&(System.currentTimeMillis()-lastListRefresh<15000||android.os.SystemClock.elapsedRealtime()<nextListRetryAt))return
        val ticket=++listTicket;val harness=state.harness;val filter=state.threadFilter
        val keep=listOf(state.threadId,notificationThreadId).filter{it.isNotBlank()}.joinToString(",")
        val selectedProject=state.projectId;val selectedThread=state.threadId
        val expanded=expandedSidebarProjects()
        fun current()=generation==epoch&&ticket==listTicket&&harness==state.harness&&filter==state.threadFilter&&client===api
        fun updateSelectedProject(){state=state.copy(projectId=state.projects.find{nativePath(it.path)==nativePath(state.threads.find{t->t.id==state.threadId}?.projectPath.orEmpty())}?.id?:state.projectId)}
        state=state.copy(loadingSidebar=true)
        var complete=true;var changed=false
        try {
            supervisorScope {
                launch{
                    try{
                        val page=withContext(Dispatchers.IO){api.sidebarThreads(threadLimit,harness,keep,filter=filter)}
                        if(!current())return@launch
                        val threads=(page.first+conversationLineage(state.threads+state.projectThreads.values.flatMap{it.rows},state.threadId)).distinctBy{it.id}
                        val listed=threads.associateBy{it.id}
                        state=state.copy(threads=threads,moreThreads=page.second,cloudListError=api.cloudListError,
                            projectThreads=state.projectThreads.mapValues{(_,p)->p.copy(rows=p.rows.map{row->listed[row.id]?.let{row.copy(title=it.title.ifBlank{row.title},updatedAt=it.updatedAt,status=it.status,goal=it.goal,pinnedIndex=it.pinnedIndex,unread=it.unread,completedAt=it.completedAt)}?:row})})
                        updateSelectedProject();changed=true
                        state.threads.find{it.id==notificationThreadId}?.let{notificationThreadId="";openThread(it)}
                    }catch(e:CancellationException){throw e}catch(e:Exception){complete=false;if(reportErrors&&current())error(nativeError(e))}
                }
                launch{
                    try{
                        val page=withContext(Dispatchers.IO){api.sidebarProjectPage(projectLimit,selectedProject,selectedThread,expanded)}
                        if(!current())return@launch
                        // Retain only selections/expansions made after this request. The next
                        // request includes them; an already-included missing project is removed.
                        val newlyExpanded=expandedSidebarProjects()-expanded
                        val retained=state.sidebarProjects.filter{it.id in newlyExpanded||it.id==state.projectId&&state.projectId!=selectedProject}
                        val allowed=state.projects.filter{it.id in newlyExpanded||it.id==state.projectId&&state.projectId!=selectedProject}
                        state=state.copy(projects=(page.second+allowed).distinctBy{it.id to it.path},
                            sidebarProjects=(page.first+retained).distinctBy{it.id to it.path},moreProjects=page.third)
                        updateSelectedProject();changed=true
                    }catch(e:CancellationException){throw e}catch(e:Exception){complete=false;if(reportErrors&&current())error(nativeError(e))}
                }
            }
            if(current()&&complete){
                lastListRefresh=System.currentTimeMillis()
                state.sidebarProjects.filter{it.id in expandedSidebarProjects()}.forEach{loadProjectThreads(it,force=true)}
            }
        }finally{
            if(current()){
                if(changed&&filter==NativeThreadFilter.ALL)rememberSidebar()
                nextListRetryAt=if(complete)0L else android.os.SystemClock.elapsedRealtime()+30000
            }
            if(ticket==listTicket)state=state.copy(loadingSidebar=false)
        }
    }
    private fun refreshChangedHistory(threadId:String=state.threadId){
        val api=client?:return;val epoch=generation;val chosen=selection
        if(threadId.isBlank()||threadId!=state.threadId)return
        viewModelScope.launch{
            if(epoch==generation&&chosen==selection&&api===client&&threadId==state.threadId)refreshHistory(changed=true)
        }
    }
    private suspend fun refreshHistory(force:Boolean=false,changed:Boolean=false){
        val api=client?:return;val epoch=generation;val id=state.threadId;val chosen=selection
        if(id.isBlank())return
        val active=historyRead
        if(historyInFlightFor==id&&active!=null&&active.api===api&&active.generation==epoch&&active.selection==chosen){
            if(force||changed){active.pending=true;active.forced=active.forced||force}
            return
        }
        if(historyInFlightFor!=null){historyTicket++;historyInFlightFor=null;historyRead=null;historyJob?.cancel()}
        if(!force&&android.os.SystemClock.elapsedRealtime()<(historyRetryAfter[id]?:0L))return
        // The actual HTTP work, not only the navigation caller, belongs to historyJob.
        // Switching conversations now also cancels reads started by polling or events.
        val ticket=++historyTicket;val owner=HistoryRead(api,epoch,chosen)
        historyRead=owner;historyInFlightFor=id
        val job=viewModelScope.launch(start=CoroutineStart.LAZY){
        val modelVersion=modelRevision;val queueVersion=queueRevision(api,id)
        val turns=historyTurns;val approvedBefore=state.approvals
        val buffer=mutableListOf<ChatEvent>();hydration=buffer
        fun current()=chosen==selection&&generation==epoch&&historyTicket==ticket&&api===client&&state.threadId==id
        state=state.copy(historySyncing=true)
        suspend fun <T> read(part:String,fetch:suspend ()->T,valid:()->Boolean={true},apply:(T)->Unit){
            try{
                val result=withContext(Dispatchers.IO){fetch()}
                if(current()&&valid()){
                    apply(result)
                    state=state.copy(historyErrors=state.historyErrors-part)
                    if(part=="history")historyRetryAfter.remove(id)
                }
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current()&&valid()){
                val message=if(e is java.net.SocketTimeoutException)"读取超时，稍后自动重试。" else nativeError(e)
                state=state.copy(historyErrors=state.historyErrors+(part to message))
                if(part=="history")historyRetryAfter[id]=android.os.SystemClock.elapsedRealtime()+30000
            }}
            finally{if(part=="history"&&current())state=state.copy(loadingHistory=false,loadingOlderHistory=false)}
        }
        try{coroutineScope{
            launch{read("history",{api.nativeConversationHistoryAsync(id,turns)}){result->
                val events=hydratedActivities(result.first)
                    val answered=events.mapNotNull(::nativeAnsweredApproval).toSet()
                    val resolved=events.filter{it.type=="approval.resolved"}.map{it.approvalId}.toSet()+answered
                    resolved.forEach{questionDrafts.remove(questionDraftKey(id,it))}
                    val approvalResults=events.filter{it.type=="approval.resolved"&&nativeApprovalResult(it.decision).isNotEmpty()}.associate{nativeApprovalKey(it.threadId,it.approvalId) to nativeApprovalResult(it.decision)}+answered.associate{nativeApprovalKey(id,it) to "answered"}
                    state=state.copy(actualModel=result.actualModel)
                    syncDesktopModel(id,result.model,result.effort,modelVersion)
                    val status=result.second.ifBlank{state.threads.find{it.id==id}?.status.orEmpty()}
                    state.events.forEach{rememberOutputEvent(it)}
                    events.forEach{rememberOutputEvent(it)}
                    val merged=reconcileNativeHistory(state.events,events,result.third,retainLive=state.threads.find{it.id==id}?.readOnly!=true&&!id.startsWith("cloud-snapshot:")&&!id.startsWith("cloud:"))
                    state=state.copy(approvalResults=approvalResults+state.approvalResults+approvalResults.filterValues{it=="resolved"},approvals=state.approvals+resolved,pendingApprovals=state.pendingApprovals.filter{it.approvalId !in resolved},events=preserveNativeEventKeys(state.events,merged),hasMoreHistory=result.third&&turns<2000,
                        running=buffer.lastOrNull{it.type=="turn.completed"||it.type=="turn.started"}?.let{it.type=="turn.started"}?: (status=="running"))
                    val p=pending
                    events.firstOrNull{event->event.type=="user.message"&&p!=null&&(event.requestId==p.id||event.requestId.isBlank()&&event.createdAt>=p.submittedAt&&event.text==p.text&&event.images==p.images&&event.uploads==p.uploads)}?.let{event->outgoingKeys[event.threadId to event.eventId]="outgoing:${p!!.id}";confirmSend(p.id,event.threadId,status)}
                    events.filter{it.type=="user.message"&&it.requestId in failedSends}.forEach{confirmSend(it.requestId,it.threadId,status)}
                    if(!state.running&&(state.stopping||state.stopError.isNotBlank()))clearStop()
            }}
            launch{read("approvals",{api.nativeJsonAsync("GET","/api/approvals?threadId=${java.net.URLEncoder.encode(id,"UTF-8")}").getJSONArray("approvals")}){rows->
                // Events and local decisions received during the request are newer than its snapshot.
                val live=buffer.filter{it.type=="approval.requested"||it.type=="approval.resolved"}.associateBy{it.approvalId}
                // Keep prior decisions for this thread when a delayed snapshot still says pending.
                val decided=(state.approvals-approvedBefore)+state.approvalResults.keys.filter{it.startsWith(id+"\u0000")}.map{it.substringAfter('\u0000')}
                val approvalRows=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.optString("threadId")==id&&it.optString("id") !in live&&it.optString("id") !in decided}
                val resolved=approvalRows.filter{it.optString("status")!="pending"}.map{it.getString("id")}.toSet()+live.values.filter{it.type=="approval.resolved"}.map{it.approvalId}+decided
                val results=approvalRows.mapNotNull{row->nativeApprovalResult(row.optString("status")).takeIf{it.isNotEmpty()}?.let{nativeApprovalKey(id,row.optString("id")) to it}}.toMap()
                val pendingForThread=approvalRows.filter{it.optString("status")=="pending"}.map{row->
                    ChatEvent(type="approval.requested",threadId=id,approvalId=row.optString("id"),approvalType=row.optString("approvalType"),title=row.optString("title"),detail=row.optString("detail"),eventId="pending-approval:"+row.optString("id"))
                }+live.values.filter{it.type=="approval.requested"&&it.approvalId !in decided}
                resolved.forEach{questionDrafts.remove(questionDraftKey(id,it))}
                state=state.copy(approvalResults=results+state.approvalResults,approvals=(state.approvals+resolved)-pendingForThread.map{it.approvalId}.toSet(),pendingApprovals=pendingForThread)
            }}
            launch{read("queue",{api.nativeJsonAsync("GET","/api/threads/$id/queue")},{queueVersion==queueRevision(api,id)}){queued->
                    val rows=queued.getJSONArray("messages")
                    val drafts=queued.optJSONArray("drafts")?:org.json.JSONArray()
                    state=state.copy(canSteer=queued.optBoolean("canSteer"),queue=(0 until rows.length()).map{rows.getJSONObject(it).toNativeQueued()},queueDrafts=(0 until drafts.length()).map{drafts.getJSONObject(it).toNativeQueued()})
                    if(queued.has("drafts"))store.pruneQueueDraftMarkers(attachmentScope(),(state.queue+state.queueDrafts).map{it.id}.toSet())
            }}
        }}finally{
            val followUp=current()&&owner.pending&&state.connected&&currentCoroutineContext().isActive
            if(hydration===buffer)hydration=null
            if(historyRead===owner)historyRead=null
            if(historyTicket==ticket)historyInFlightFor=null
            if(current())state=state.copy(historySyncing=false,loadingHistory=false,loadingOlderHistory=false)
            if(followUp)viewModelScope.launch{
                if(current())refreshHistory(force=owner.forced)
            }
        }
        }
        historyJob=job;job.start()
        try{job.join()}finally{if(!currentCoroutineContext().isActive)job.cancel()}
    }
    fun retryHistory(){
        if(!state.connected||state.threadId.isBlank()||historyInFlightFor!=null)return
        viewModelScope.launch{refreshHistory(force=true)}
    }
    private var foregroundTasks=TaskNotificationTracker()
    private val completedGoalNotices=linkedSetOf<String>()
    fun dismissTaskNotice(key:String){if(state.taskNotice?.key==key)state=state.copy(taskNotice=null)}
    private var codexStatusTicket=0L
    private var backendStatusTicket=0L
    fun refreshBackends(force:Boolean=false):Job?{
        if(!state.connected||state.backendStatusLoading)return null
        val api=client?:return null;val epoch=generation;val ticket=++backendStatusTicket
        fun current()=epoch==generation&&api===client&&ticket==backendStatusTicket
        state=state.copy(backendStatusLoading=true,backendStatusError="")
        return viewModelScope.launch{
            try{
                val models=api.nativeModelsAsync(refresh=force)
                if(current()){
                    val selected=if(state.harness=="opencode")nativeOpenCodeSelection(models,state.model,state.models) else null
                    state=state.copy(models=nativeModelsWithSelection(nativeModelCatalogOrDefaults(models),selected),modelsFallback=models.isEmpty(),backends=api.nativeBackendStatuses)
                    if(!applyDesktopModel()){
                    if(state.harness=="opencode")state=state.copy(model=selected?.id.orEmpty(),effort=state.effort.takeIf{it in selected?.efforts.orEmpty()}?:selected?.defaultEffort.orEmpty())
                    else{
                        models.find{it.id==state.model}?.let{current->if(state.effort !in current.efforts)state=state.copy(effort=current.defaultEffort)}
                        if(models.none{it.id==state.model&&it.available})models.firstOrNull{it.harness==state.harness&&it.available}?.let{chooseModel(it.id)}
                    }
                    }
                    store.saveModelsAsync(state.address,models,::current)
                }
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(backendStatusError="无法检查助手：${nativeError(e)}")}
            finally{if(current())state=state.copy(backendStatusLoading=false)}
        }
    }
    fun refreshCodex():Job?{
        if(state.harness!="codex"||!state.connected||state.codexStarting)return null
        val api=client?:return null;val epoch=generation;val ticket=++codexStatusTicket
        fun current()=state.harness=="codex"&&epoch==generation&&api===client&&ticket==codexStatusTicket
        state=state.copy(codexStatusLoading=true,codexStatusError="")
        return viewModelScope.launch{
            try{
                val ready=withContext(Dispatchers.IO){api.codexStatus().initialized}
                if(current())state=state.copy(codexReady=ready)
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(codexStatusError="无法检查 Codex：${nativeError(e)}")}
            finally{if(current())state=state.copy(codexStatusLoading=false)}
        }
    }
    fun startDesktopCodex():Job?{
        if(state.harness!="codex"||state.codexStarting||!state.connected)return null
        val api=client?:return null;val epoch=generation;val ticket=++codexStatusTicket
        fun current()=state.harness=="codex"&&epoch==generation&&api===client&&ticket==codexStatusTicket
        state=state.copy(codexStarting=true,codexStatusLoading=false,codexStatusError="")
        return viewModelScope.launch{
            try{
                val ready=withContext(Dispatchers.IO){api.startCodex().initialized}
                if(current()){state=state.copy(codexReady=ready);refreshLists(true);if(current())refreshHistory()}
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(codexStatusError="无法启动 Codex：${nativeError(e)}")}
            finally{if(current())state=state.copy(codexStarting=false)}
        }
    }
    fun dismissBackendRestart(){if(!state.backendRestart.busy)state=state.copy(backendRestart=NativeBackendRestart())}
    fun sharedBackendRestart(confirm:Boolean=false):Job?{
        if(!state.connected||state.backendRestart.busy)return null
        val plan=state.backendRestart.planId
        if(confirm&&(!state.backendRestart.canRestart||plan.isBlank()))return null
        val api=client?:return null;val epoch=generation
        state=state.copy(backendRestart=state.backendRestart.copy(busy=true,error="",done=false))
        return viewModelScope.launch{
            try{
                val result=withContext(Dispatchers.IO){api.sharedBackendRestart(if(confirm)plan else null)}
                if(epoch!=generation||client!==api)return@launch
                state=state.copy(backendRestart=NativeBackendRestart(planId=result.optString("planId").takeUnless{it=="null"}.orEmpty(),blockingCount=result.optInt("blockingCount"),canRestart=result.optBoolean("canRestart"),done=result.optBoolean("restarted"),desktopRunning=result.optBoolean("desktopRunning")))
                if(confirm)refreshCodex()
            }catch(e:CancellationException){throw e}
            catch(e:Exception){if(epoch==generation&&client===api)state=state.copy(backendRestart=NativeBackendRestart(error=nativeError(e)))}
        }
    }
    private fun receive(event:ChatEvent){
        if(event.type=="thread.read"){applyThreadRead(event.threadId,event.readThrough);if(state.threadFilter==NativeThreadFilter.UNREAD&&!event.replayed)refreshSidebar();return}
        if(event.replayed)return
        if(event.type=="thread.settings.updated"){
            if(state.connected&&state.harness=="codex"&&state.threadId.isNotBlank()&&event.threadId==state.threadId&&event.hasServiceTier){
                // A settings notification is newer than any status read already in flight.
                fastRevision++;fastTicket++;fastJob?.cancel();fastJob=null
                fastReadClient=client;fastReadContext=Triple(generation,selection,state.threadId)
                lastFastReadAt=android.os.SystemClock.elapsedRealtime()
                val fast=when(event.serviceTier?.trim()?.lowercase()){"fast","priority"->true;"default","flex",null->false;else->null}
                state=state.copy(sessionFast=fast,fastMode=null,fastBusy=client?.let{fastWrites[it to state.threadId]?.isActive}==true)
            }
            return
        }
        val completed=foregroundTasks.accept(event)
        if(completed&&event.threadId!=state.threadId&&event.status.lowercase() in setOf("ok","completed","complete","success","idle")&&uiForeground&&state.threads.find{it.id==event.threadId}?.subagent==null){
            state=state.copy(taskNotice=foregroundTasks.content(event,state.events,state.threads.find{it.id==event.threadId}?.title.orEmpty()))
        }
        if(event.type=="thread.read-state.changed"){refreshSidebar();return}
        if(event.type=="turn.started"||event.type=="turn.completed")refreshSidebar()
        if(event.type=="usage.updated"){
            if(event.threadId==state.threadId){lastUsageRefresh=0;loadUsage(changed=true)}
            return
        }
        if(event.type=="goal.completed"){
            goalNotification(event,state.threads.find{it.id==event.threadId}?.title.orEmpty())?.let{notice->
                if(completedGoalNotices.add(notice.key)&&event.threadId!=state.threadId&&uiForeground&&state.threads.find{it.id==event.threadId}?.subagent==null)state=state.copy(taskNotice=notice)
                if(completedGoalNotices.size>100)completedGoalNotices.remove(completedGoalNotices.first())
            }
            viewModelScope.launch{refreshLists(true)}
            return
        }
        val p=pending
        val relevant=event.threadId==state.threadId||event.threadId.isBlank()||p!=null&&event.requestId==p.id
        modelServiceNotices.accept(event)?.takeIf{relevant}?.let{state=state.copy(modelServiceNotice=it)}
        if((relevant&&event.type=="turn.started")||(event.threadId==state.threadId&&event.type=="turn.completed"&&event.status in setOf("completed","ok","success")))clearConversationModelServiceNotice()
        if(event.type=="message.confirmed"||event.type=="command.accepted"){confirmSend(event.requestId,event.threadId,event.status);if(relevant)refreshChangedHistory(event.threadId.ifBlank{state.threadId});return}
        if(event.type=="message.received"&&event.requestId==p?.id){state=state.copy(sendingStage=if(p?.goal==true)"正在创建目标…" else "电脑正在提交消息…");return}
        if(event.type=="message.queued"){
            if(p!=null&&p.id==event.requestId&&p.selection==selection){
                client?.let{queueChanged(it,state.threadId)}
                state=state.copy(queue=state.queue.filterNot{it.id==p.id}+NativeQueued(p.id,p.text,"queued",error="",canSteer=state.canSteer,images=p.images,uploads=p.uploads))
                confirmSend(p.id);refreshChangedHistory()
            }
            return
        }
        if(event.type=="thread.history.changed"){
            if(event.threadId==state.threadId&&event.turnId.isNotBlank()){
                historyTicket++;historyInFlightFor=null;historyJob?.cancel();hydration?.clear()
                val cut=state.events.indexOfFirst{it.turnId==event.turnId}.takeIf{it>=0}
                    ?:state.events.indexOfLast{it.type=="user.message"}.takeIf{it>=0}
                if(cut!=null)state=state.copy(events=state.events.take(cut))
                cancelMessageEdit();conversations.put(conversationKey(state.threadId),NativeConversationSnapshot(state.events.toList(),historyTurns,state.hasMoreHistory,state.actualModel))
            }
            viewModelScope.launch{refreshLists(true)}
            refreshChangedHistory(event.threadId)
            return
        }
        if(event.type=="thread.started"&&p!=null&&event.requestId==p.id&&p.selection==selection){
            moveCreatedConversationDraft(p,event.threadId)
            pending=p.copy(threadId=event.threadId);persistSend(pending!!)
            state=state.copy(threadId=event.threadId,fastMode=null,sessionFast=p.fast,threads=listOf(ThreadRecord(event.threadId,event.projectPath,event.title,event.status))+state.threads.filter{it.id!=event.threadId});moveGoalAttachments(p,event.threadId);rememberThreadSettings()
            refreshChangedHistory(event.threadId)
        }
        if(event.type=="terminal.output"){
            if(event.commandId.isBlank())return
            val known=workspaceTerminals.any{it.key.first==state.address&&it.key.second==state.certificateSha256&&it.value.session==event.commandId}
            val starting=terminalOperations.any{it.first==state.address&&it.second==state.certificateSha256&&workspaceTerminals[it]?.active!=true}
            if(!known&&!starting)return
            val outputKey=Triple(state.address,state.certificateSha256,event.commandId)
            terminalOutput.put(outputKey,(terminalOutput.get(outputKey).orEmpty()+event.text).takeLast(60000))
            if(event.status in listOf("completed","stopped","error")){
                workspaceTerminals.entries.filter{it.key.first==state.address&&it.key.second==state.certificateSha256&&it.value.session==event.commandId}
                    .forEach{it.setValue(it.value.copy(active=false))}
            }
            if(workspaceTerminals[terminalScope()]?.session==event.commandId)openTerminal()
            return
        }
        val detail=event.text.ifBlank{event.detail}
        if(event.type=="error"&&stopRequestId!=null&&event.requestId==stopRequestId){
            clearStop();state=state.copy(stopError=detail)
            error("停止失败：$detail")
            return
        }
        val writerConflict=event.type=="error"&&detail.contains("active writer",true)
        val visibleEvent=if(writerConflict)event.copy(text="此会话正由其他客户端占用。消息未发送，已保留在输入框。",detail=event.detail.ifBlank{event.text}) else event
        if(event.type=="error"&&!event.willRetry&&(event.requestId==p?.id||event.requestId.isBlank()&&(event.threadId==state.threadId||event.threadId.isBlank()))){recoverPending(if(writerConflict)visibleEvent.text else detail,false);state=state.copy(error=if(writerConflict)visibleEvent.text else detail,running=if(writerConflict)state.running else false)}
        // An accepted submission must clear its recovered draft even while a
        // different conversation is visible. Rendering remains selection scoped.
        if(event.type=="user.message"&&event.requestId in failedSends)confirmSend(event.requestId,event.threadId)
        if(event.threadId!=state.threadId||event.threadId.isBlank())return
        hydration?.add(visibleEvent)
        if(eventIndex.containsId(state.events,event.eventId))return
        if(rememberOutputEvent(visibleEvent))return
        if(event.type=="message.delta"&&eventIndex.messageComplete(state.events,event.itemId))return
        if(event.type=="user.message"&&p!=null&&p.selection==selection&&
            (event.requestId==p.id||(event.requestId.isBlank()&&event.text==p.text&&event.images.map{it.id}==p.images.map{it.id}&&event.uploads.map{it.id}==p.uploads.map{it.id}))){
            outgoingKeys[event.threadId to event.eventId]="outgoing:${p.id}"
            confirmSend(p.id)
        }
        val previousEvents=state.events
        val nextEvents=eventBuffer.append(previousEvents,visibleEvent)
        eventIndex.appended(previousEvents,visibleEvent,nextEvents)
        state=state.copy(events=nextEvents)
        nativeAnsweredApproval(event)?.let{id->questionDrafts.remove(questionDraftKey(event.threadId,id));finishApproval(id,event.threadId,"answered",selection)}
        if(event.type=="user.message") {
            if(event.status.isNotBlank())state=state.copy(running=event.status=="running")
            else if(p!=null&&p.threadId==event.threadId)state=state.copy(running=true)
        }
        if(event.type=="turn.started")state=state.copy(running=true)
        if(event.type=="turn.completed"){clearStop();state=state.copy(running=false,stopError="")}
        if(event.type=="approval.resolved")questionDrafts.remove(questionDraftKey(event.threadId,event.approvalId))
        if(event.type=="approval.resolved")state=state.copy(approvalResults=state.approvalResults+listOfNotNull(nativeApprovalResult(event.decision).takeIf{it.isNotEmpty()}?.let{nativeApprovalKey(event.threadId,event.approvalId) to it}).toMap(),approvals=state.approvals+event.approvalId,pendingApprovals=state.pendingApprovals.filter{it.approvalId!=event.approvalId})
    }
    fun isReadOnly()=nativeReadOnlyThreadId(state.threadId)||state.threads.find{it.id==state.threadId}?.readOnly==true
    fun importCloudSnapshot(text:String,done:()->Unit){
        if("cloud-snapshot-readonly" !in state.capabilities){error("请先更新电脑网关以支持云端快照");return}
        val api=client?:return;val epoch=generation;val chosen=selection
        fun current()=epoch==generation&&api===client&&chosen==selection
        scopedWork(::current){
            require(text.length<=900000){"快照过大，请分批导入"}
            api.nativeJson("POST","/api/cloud-snapshots/import",JSONObject(text))
            withContext(Dispatchers.Main){if(current()){refreshLists(true);if(current())done()}}
        }
    }
    private var recoveryQuery:Job?=null
    fun checkSubmission(){
        val api=client?:return
        if(!state.connected||recoveryQuery?.isActive==true)return
        val epoch=generation;val chosen=selection
        val records=failedSends.values.filter{sameComputer(it)}.toList()
        recoveryQuery=viewModelScope.launch{
            for(saved in records){
                try{
                    val response=withContext(Dispatchers.IO){api.nativeJsonAsync("GET","/api/threads/${saved.threadId.ifBlank{"_new"}}/submission?requestId=${saved.id}")}
                    if(epoch!=generation||client!==api)return@launch
                    if(saved.id !in failedSends)continue
                    val receipt=response.getJSONObject("submission")
                    val initialHome=chosen==0&&selection==0&&state.threadId.isBlank()&&state.projectId.isBlank()
                    val sameContext=chosen==selection&&(initialHome||saved.draftKey==key()||saved.threadId.isNotBlank()&&saved.threadId==state.threadId)
                    when(receipt.optString("state")){
                        "accepted"->{
                            if(sameContext&&pending==null){
                                val recovered=saved.copy(selection=selection);failedSends[saved.id]=recovered
                                if(initialHome)state=state.copy(projectId=saved.projectId)
                                confirmSend(saved.id,receipt.optString("threadId"),response.optString("status"))
                                val id=receipt.optString("threadId")
                                if(initialHome&&id.isNotBlank()){
                                    val path=runCatching{JSONObject(saved.wireCommand).optString("projectPath")}.getOrDefault("")
                                    openThread(state.threads.find{it.id==id}?:ThreadRecord(id=id,projectPath=path,title=saved.text.take(80),source="localCodex"))
                                }else refreshHistory(changed=true)
                            }else confirmSend(saved.id,receipt.optString("threadId"),response.optString("status"))
                        }
                        "processing"->if(sameContext&&pending==null){
                            val restored=saved.copy(selection=selection);pending=restored;failedSends.remove(saved.id)
                            if(initialHome)state=state.copy(projectId=saved.projectId)
                            state=state.copy(sending=true,recoveryVersion=state.recoveryVersion+1)
                            showSubmissionNotice(saved.id,"正在确认提交")
                            watchSubmission(restored)
                        }
                        "failed"->{val failed=saved.copy(uncertain=false,failure=receipt.optString("error"));failedSends[saved.id]=failed;persistSend(failed);state=state.copy(recoveryVersion=state.recoveryVersion+1)}
                        else->if(sameContext)showSubmissionNotice(saved.id,"提交结果待确认")
                    }
                }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation&&chosen==selection)showSubmissionNotice(saved.id,"暂时无法确认提交")}
            }
        }
    }
    fun send(){
        nativeModelSelectionError(state.harness,state.model,state.models).takeIf{it.isNotBlank()}?.let{error(it);return}
        state.backends.find{it.agent==state.harness&&!it.available}?.let{error(it.reason);return}
        if(isReadOnly()){error("云端快照仅供查看");return}
        val api=client?:return;if(!state.connected||state.sending||state.uploading)return
        val text=state.draft.trim();val images=state.images;val uploads=state.uploads;if(text.isBlank()&&images.isEmpty()&&uploads.isEmpty())return
        val objective=if(state.harness=="codex")nativeGoalObjective(state.draft) else null
        val newGoal=objective!=null&&state.threadId.isBlank()
        if(objective!=null){
            val failedGoal=failedSends.values.lastOrNull{it.goal&&sameComputer(it)&&it.text==text&&
                (if(it.threadId.isNotBlank())it.threadId==state.threadId else it.draftKey==key())}
            if(failedGoal!=null){retryFailedMessage(failedGoal.id);return}
        }
        if(objective!=null&&!newGoal){
            updateGoal(state.threadId,objective=objective,status="active",draftToClear=state.draft)
            return
        }
        if(newGoal&&"new-thread-goals" !in state.capabilities){error("请更新电脑网关后直接创建目标；当前可先建立会话再设置目标");return}
        if(state.running){queueMessage();return}
        val candidate=sendingRecord("",text,images,uploads).copy(goal=newGoal)
        val old=failedSends.values.lastOrNull{it.address==candidate.address&&it.certificateSha256==candidate.certificateSha256&&it.threadId==candidate.threadId&&it.projectId==candidate.projectId&&it.text==text&&it.goal==candidate.goal&&(candidate.goal||it.images==images&&it.uploads==uploads)&&it.model==candidate.model&&it.effort==candidate.effort&&it.permission==candidate.permission&&it.mode==candidate.mode&&it.fast==candidate.fast}
        if(old!=null){retryFailedMessage(old.id);return}
        val thread=state.threads.find{it.id==state.threadId};val id=UUID.randomUUID().toString()
        val record=freezeCommand(sendingRecord(id,text,images,uploads).copy(goal=newGoal),thread);persistSend(record);pending=record
        state=state.copy(draft="",images=if(newGoal)images else emptyList(),uploads=if(newGoal)uploads else emptyList(),sending=true,error="");store.saveChatDraft(attachmentScope(),"")
        if(!api.sendSocketMessage(JSONObject(record.wireCommand))) {recoverPending("连接已断开，消息尚未发送")} else watchSubmission(record)
    }
    fun retryAnswer(answer:NativeBlock){
        if(isReadOnly()){error("云端快照仅供查看");return}
        val api=client?:return
        if(!state.connected||state.sending||state.running||state.uploading||state.harness!="codex"||state.threadId.isBlank())return
        val latest=nativeTimeline(state.events,state.threadId,running=state.running).lastOrNull{it.retryPrompt!=null||it.retryFailure}
        val prompt=latest?.retryPrompt
        if(latest==null||latest.key!=answer.key){error("这条回答已不是最新回复，请刷新后重试");return}
        if(prompt==null){if(latest.retryFailure&&state.threads.find{it.id==state.threadId}?.goal?.status in setOf("active","paused","blocked"))continueGoal(state.threadId);return}
        val thread=state.threads.find{it.id==state.threadId}?:ThreadRecord(state.threadId,prompt.projectPath)
        val id=UUID.randomUUID().toString()
        val record=freezeCommand(sendingRecord(id,prompt.text,prompt.images,prompt.uploads,false).copy(mode="",plan=false),thread);persistSend(record);pending=record
        state=state.copy(sending=true,error="")
        if(!api.sendSocketMessage(JSONObject(record.wireCommand))){
            recoverPending("连接已断开，重试请求尚未确认")
        }else watchSubmission(record)
    }
    fun pendingText():String=if(pending?.selection==selection)pending?.text.orEmpty() else ""
    fun togglePlan(){if(!nativePlanAvailable(state.harness,state.backends)){error("当前 "+nativeAgentName(state.harness)+" ACP 接口未提供计划模式切换");return};state=state.copy(nextMode=if(state.nextMode=="plan")"default" else "plan")}
    private var fastJob:Job?=null
    private var fastTicket=0
    private var fastRevision=0
    private val fastWrites=mutableMapOf<Pair<GatewayClient,String>,Job>()
    private var lastFastReadAt=0L
    private var fastReadContext:Triple<Int,Int,String>?=null
    private var fastReadClient:GatewayClient?=null
    fun loadFast(force:Boolean=false){
        if(state.harness!="codex"||!state.connected)return
        val api=client?:return;val id=state.threadId;val epoch=generation;val chosen=selection
        val context=Triple(epoch,chosen,id);val now=android.os.SystemClock.elapsedRealtime()
        if(fastWrites[api to id]?.isActive==true){state=state.copy(fastBusy=true);return}
        if(fastReadClient===api&&fastReadContext==context&&(fastJob?.isActive==true||!force&&now-lastFastReadAt<30000))return
        fastReadClient=api;fastReadContext=context;lastFastReadAt=now
        val ticket=++fastTicket;fastJob?.cancel();state=state.copy(fastBusy=true)
        fun current()=ticket==fastTicket&&epoch==generation&&chosen==selection&&client===api&&id==state.threadId&&state.harness=="codex"&&state.connected
        fastJob=viewModelScope.launch{
            try{
                val route=if(id.isBlank())"/api/settings/fast" else "/api/threads/${Uri.encode(id)}/fast"
                val result=api.nativeJsonAsync("GET",route)
                if(current())state=state.copy(sessionFast=result.opt("fast") as? Boolean,fastMode=state.fastMode.takeIf{id.isBlank()})
            }catch(e:CancellationException){throw e}catch(e:Exception){
                // An optional background status read does not invalidate the live chat connection.
                if(current()&&(force||e !is java.net.SocketTimeoutException))
                    error(if(e is java.net.SocketTimeoutException)"Fast 状态读取超时，请稍后重试。" else nativeError(e))
            }
            finally{if(ticket==fastTicket)state=state.copy(fastBusy=false)}
        }
    }
    fun toggleFast(){
        if(state.harness!="codex"||!state.connected||state.fastBusy)return
        val wasFast=state.fastMode?:state.sessionFast?:false
        val value=!wasFast;val id=state.threadId
        if(id.isBlank()){state=state.copy(fastMode=value);return}
        val api=client?:return;val key=api to id
        if(fastWrites[key]?.isActive==true)return
        val epoch=generation;val chosen=selection;val revision=fastRevision
        fastTicket++;fastJob?.cancel();fastJob=null;fastReadClient=api;fastReadContext=Triple(epoch,chosen,id)
        state=state.copy(fastBusy=true)
        fun selected()=epoch==generation&&chosen==selection&&client===api&&id==state.threadId&&state.harness=="codex"&&state.connected
        fun current()=selected()&&revision==fastRevision
        val save=viewModelScope.launch(start=CoroutineStart.LAZY){
            try{
                val result=api.nativeJsonAsync("PUT","/api/threads/${Uri.encode(id)}/fast",JSONObject().put("fast",value))
                val confirmed=checkNotNull(result.opt("fast") as? Boolean){"Fast 保存结果未确认，请重新打开模型设置同步。"}
                if(current()){
                    lastFastReadAt=android.os.SystemClock.elapsedRealtime()
                    state=state.copy(sessionFast=confirmed,fastMode=null)
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){if(current())error(nativeError(e))}
            finally{
                fastWrites.remove(key)
                if(client===api&&id==state.threadId&&state.harness=="codex"&&state.connected){
                    state=state.copy(fastBusy=false)
                    if(!selected())loadFast(force=true)
                }
            }
        }
        fastWrites[key]=save;save.start()
    }
    private fun recoverPending(message:String="发送状态尚未确认，内容已保留",uncertain:Boolean=true){
        val p=pending?:return;submissionWatch?.cancel();submissionWatch=null;submissionRetry?.cancel();submissionRetry=null
        val saved=p.copy(uncertain=uncertain,failure=message);persistSend(saved);failedSends[p.id]=saved
        val composerEmpty=state.draft.isBlank()&&(p.goal||state.images.isEmpty()&&state.uploads.isEmpty())
        // A later attachment-only message remains editable; the failed message has its own retry card.
        if(p.restoreDraft&&p.selection==selection&&composerEmpty){state=state.copy(draft=p.text,images=if(p.goal)state.images else p.images,uploads=if(p.goal)state.uploads else p.uploads);store.saveChatDraft(attachmentScope(),p.text)}
        pending=null;state=state.copy(sending=false,sendingStage="",error=message,recoveryVersion=state.recoveryVersion+1)
    }
    fun stop(){
        if(isReadOnly()){error("云端快照仅供查看");return}
        if(state.stopping||!state.running||state.threadId.isBlank())return
        val id=state.threadId;val chosen=selection;val requestId=UUID.randomUUID().toString()
        stopRequestId=requestId
        state=state.copy(stopping=true,stopError="",error="")
        if(!state.connected||client?.interruptTurn(id,requestId)!=true){
            clearStop();state=state.copy(stopError="停止请求未发出，请检查连接")
            error(state.stopError);return
        }
        stopJob=viewModelScope.launch{
            delay(12000)
            if(selection==chosen&&state.threadId==id&&stopRequestId==requestId){
                clearStop();state=state.copy(stopError="停止尚未确认，请检查网络后重试",error="停止尚未确认，请检查网络后重试")
            }
        }
    }
    private val queueMutationVersions=mutableMapOf<Pair<GatewayClient,String>,Long>()
    private fun queueRevision(api:GatewayClient,id:String)=queueMutationVersions[api to id]?:0L
    private fun queueChanged(api:GatewayClient,id:String){queueMutationVersions[api to id]=queueRevision(api,id)+1L}
    private var activeComposerSubmission:String?=null
    private fun queueMessage(){val id=state.threadId;val text=state.draft;val images=state.images;val uploads=state.uploads;val api=client?:return
        val draftKey=attachmentScope();val scope=attachmentScope()
        val owner=Triple(state.address,store.token(),state.certificateSha256)
        val epoch=generation;val chosen=selection
        fun current()=epoch==generation&&chosen==selection&&state.threadId==id&&attachmentScope()==scope
        val queuedMode=state.nextMode
        val payload=JSONObject().put("mode",state.nextMode).put("fast",state.fastMode.takeIf{state.harness=="codex"}).put("id",UUID.randomUUID().toString()).put("text",text).put("model",state.model).put("effort",state.effort).put("permission",state.permission).put("images",org.json.JSONArray(images.map{JSONObject().put("id",it.id).put("name",it.name)})).put("files",org.json.JSONArray(uploads.map{JSONObject().put("id",it.id).put("name",it.name).put("mime",it.mime).put("size",it.size)}))
        val requestId=payload.getString("id");activeComposerSubmission=requestId
        state=state.copy(sending=true);scopedWork(::current){
            try {
                val result=api.nativeJson("POST","/api/threads/$id/queue",payload)
                val acknowledged=result.optJSONObject("message")?.toNativeQueued()
                    ?:NativeQueued(payload.getString("id"),text,"queued",error="",canSteer=false,images=images,uploads=uploads)
                withContext(Dispatchers.Main){
                        if(store.chatDraft(draftKey)==text)store.saveChatDraft(draftKey,"")
                        val (savedImages,savedFiles)=store.attachmentDraft(scope)
                        val remainingImages=savedImages.filter{image->images.none{it.id==image.id}}
                        val remainingFiles=savedFiles.filter{file->uploads.none{it.id==file.id}}
                        if(owner==Triple(state.address,store.token(),state.certificateSha256)&&state.threadId==id&&attachmentScope()==scope){
                            queueChanged(api,id)
                            state=state.copy(queue=state.queue.filterNot{it.id==acknowledged.id}+acknowledged.copy(canSteer=state.canSteer),
                                draft=if(state.draft==text)"" else state.draft,
                                nextMode=if(queuedMode=="plan"&&state.nextMode=="plan")"default" else state.nextMode,
                                images=remainingImages,uploads=remainingFiles)
                        }else store.saveAttachmentDraft(scope,remainingImages,remainingFiles)
                }
            } finally {withContext(Dispatchers.Main){if(activeComposerSubmission==requestId){activeComposerSubmission=null;if(pending==null)state=state.copy(sending=false)}}}
        }
    }
    fun moveQueued(item:NativeQueued,direction:String)=mutateQueued(item,"POST","/move",JSONObject().put("direction",direction))
    fun queueAction(item:NativeQueued,action:String,text:String="")=mutateQueued(item,
        if(action=="delete")"DELETE" else if(action=="edit")"PATCH" else "POST",
        if(action in listOf("steer","retry"))"/$action" else "",
        if(action=="edit")JSONObject().put("text",text) else null)
    private val queueOperations=mutableStateMapOf<Pair<GatewayClient,String>,Pair<String,Any>>()
    internal fun queuedOperationId():String=client?.let{queueOperations[it to state.threadId]?.first}.orEmpty()
    private suspend fun refreshQueued(api:GatewayClient,id:String,current:()->Boolean){
        val version=withContext(Dispatchers.Main){queueRevision(api,id)}
        try{
            val queued=withContext(Dispatchers.IO){api.nativeJson("GET","/api/threads/${Uri.encode(id)}/queue")}
            val rows=queued.getJSONArray("messages")
            val messages=(0 until rows.length()).map{rows.getJSONObject(it).toNativeQueued()}
            val draftRows=queued.optJSONArray("drafts")?:org.json.JSONArray()
            val drafts=(0 until draftRows.length()).map{draftRows.getJSONObject(it).toNativeQueued()}
            withContext(Dispatchers.Main){if(current()&&version==queueRevision(api,id)){
                state=state.copy(canSteer=queued.optBoolean("canSteer"),queue=messages,queueDrafts=drafts,historyErrors=state.historyErrors-"queue")
                if(queued.has("drafts"))store.pruneQueueDraftMarkers(attachmentScope(),(messages+drafts).map{it.id}.toSet())
            }}
        }catch(e:CancellationException){throw e}
        catch(e:Exception){withContext(Dispatchers.Main){if(current()&&version==queueRevision(api,id))
            state=state.copy(historyErrors=state.historyErrors+("queue" to nativeError(e)))}}
    }
    private fun mutateQueued(item:NativeQueued,method:String,suffix:String,body:JSONObject?){
        val api=client?:return
        val id=state.threadId;val epoch=generation;val chosen=selection
        val operation=api to id
        if(operation in queueOperations||state.queue.none{it.id==item.id&&it.status!="sending"})return
        val owner=item.id to Any();queueOperations[operation]=owner
        fun release(){if(queueOperations[operation]===owner)queueOperations.remove(operation)}
        fun sameThread()=epoch==generation&&state.threadId==id&&api===client
        fun current()=sameThread()&&chosen==selection
        scopedWork(::current){
            try{
                val result=api.nativeJson(method,"/api/threads/${Uri.encode(id)}/queue/${Uri.encode(item.id)}$suffix",body)
                withContext(Dispatchers.Main){
                    if(epoch==generation&&api===client)queueChanged(api,id)
                    if(sameThread()){
                    // Apply the acknowledged action before reading the queue again.
                    val messages=state.queue.toMutableList()
                    val index=messages.indexOfFirst{it.id==item.id}
                    if(index>=0)when{
                        method=="DELETE"||suffix=="/steer"->messages.removeAt(index)
                        method=="PATCH"->result.optJSONObject("message")?.let{messages[index]=it.toNativeQueued().copy(canSteer=messages[index].canSteer)}
                        suffix=="/retry"->messages[index]=messages[index].copy(status="queued",error="")
                        suffix=="/move"->{
                            val other=index+if(body?.optString("direction")=="up")-1 else 1
                            if(other in messages.indices&&messages[other].status!="sending"){
                                val neighbor=messages[other];messages[other]=messages[index];messages[index]=neighbor
                            }
                        }
                    }
                    state=state.copy(queue=messages)
                };release()}
                if(sameThread())refreshQueued(api,id,::sameThread)
            }finally{withContext(NonCancellable+Dispatchers.Main){release()}}
        }
    }
    private val queueRestoreNotices=mutableStateMapOf<Pair<String,String>,String>()
    internal fun queuedRestoreNotice():String=queueRestoreNotices.filterKeys{it.first==attachmentScope()}.values.distinct().joinToString("\n")
    fun restoreQueued(item:NativeQueued){
        if((state.queue+state.queueDrafts).none{it.id==item.id})return
        val id=state.threadId;val epoch=generation;val scope=attachmentScope();val noticeKey=scope to item.id
        val uploads=(item.uploads+state.uploads).distinctBy{it.id}
        if(state.uploading||!store.queueDraftApplied(scope,item.id)&&uploads.size>8){
            draft(nativeQueueRestoredText(state.draft,item.text))
            queueRestoreNotices[noticeKey]="文字已取回；原消息尚未撤回。请先${if(state.uploading)"完成附件上传" else "减少文件附件"}，再取回附件。"
            return
        }
        // Restore locally before any network operation; the applied marker makes retries idempotent.
        val local=item.copy(text=if(nativeQueueTextIncluded(state.draft,item.text))"" else item.text)
        val (text,images,files)=store.applyQueueDraft(scope,local,state.draft,state.images,state.uploads)
        state=state.copy(draft=text,images=images,uploads=files)
        val api=client
        if(api==null||!state.connected||"queue-draft-recovery" !in state.capabilities||item.status=="sending"){
            queueRestoreNotices[noticeKey]="内容已取回；原消息尚未撤回，可能仍会发送，请勿重复发送。"
            return
        }
        val operation=api to id
        if(operation in queueOperations){
            queueRestoreNotices[noticeKey]="内容已取回；另有队列操作处理中，原消息尚未确认撤回，请勿重复发送。"
            return
        }
        queueRestoreNotices[noticeKey]="内容已取回，正在撤回队列原消息；撤回确认前请勿重复发送。"
        val owner=item.id to Any();queueOperations[operation]=owner
        fun release(){if(queueOperations[operation]===owner)queueOperations.remove(operation)}
        fun current()=epoch==generation&&state.threadId==id&&attachmentScope()==scope&&api===client
        scopedWork(::current){var withdrawn=false;try{
            store.flushDrafts()
            withContext(Dispatchers.Main){if(epoch==generation&&api===client)queueChanged(api,id)}
            val base="/api/threads/${Uri.encode(id)}/queue/${Uri.encode(item.id)}/restore"
            api.nativeJson("POST",base)
            withdrawn=true
            withContext(Dispatchers.Main){
                if(epoch==generation&&api===client)queueChanged(api,id)
                queueRestoreNotices.remove(noticeKey)
                if(current())state=state.copy(queue=state.queue.filter{it.id!=item.id})
            }
            api.nativeJson("POST","$base/complete")
            store.finishQueueDraft(scope,item.id)
            withContext(Dispatchers.Main){if(current())state=state.copy(queueDrafts=state.queueDrafts.filter{it.id!=item.id})}
        }catch(e:CancellationException){throw e}
        catch(e:Exception){withContext(Dispatchers.Main){
            queueRestoreNotices[noticeKey]=if(withdrawn)"原消息已撤回，草稿已保留；电脑端草稿清理未完成，可稍后继续编辑。" else "撤回未确认，内容已保留在输入框；原消息可能仍会发送，请勿重复发送。${nativeError(e)}"
        }}finally{withContext(NonCancellable+Dispatchers.Main){
            if(epoch==generation&&api===client)queueChanged(api,id)
            release();if(current())viewModelScope.launch{refreshQueued(api,id,::current)}
        }}}
    }
    private var uploadJob:Job?=null
    private var uploadTicket=0L
    private var uploadProgressTicket=0L
    fun cancelUpload(){
        uploadTicket++;uploadJob?.cancel();uploadJob=null
        state=state.copy(uploading=false,uploadMessage="",uploadProgress=null,uploadError="")
    }
    fun dismissUploadError(){state=state.copy(uploadError="")}
    private fun uploadWork(action:suspend (GatewayClient,()->Boolean)->Unit){
        if(state.uploading)return
        val api=client?:run{state=state.copy(uploadError="请先连接电脑，再选择附件");return}
        api.uploadOwner=store.uploadOwner()
        val chosen=selection;val epoch=generation;val ticket=++uploadTicket
        fun current()=ticket==uploadTicket&&chosen==selection&&epoch==generation&&api===client
        state=state.copy(uploading=true,uploadMessage="正在准备附件",uploadProgress=null,uploadError="")
        uploadJob=viewModelScope.launch{
            try{action(api,::current)}
            catch(e:CancellationException){throw e}
            catch(e:Exception){if(current())state=state.copy(uploadError=if(e is NativeUploadResponseException)e.message.orEmpty() else nativeError(e).ifBlank{"附件上传失败，请重新选择"})}
            finally{if(ticket==uploadTicket){uploadJob=null;state=state.copy(uploading=false,uploadMessage="",uploadProgress=null)}}
        }
    }
    private fun trackUploadProgress(message:String,current:()->Boolean):(NativeUploadProgress)->Unit{
        val ticket=++uploadProgressTicket
        state=state.copy(uploadMessage=message,uploadProgress=null)
        return {progress->viewModelScope.launch{if(ticket==uploadProgressTicket&&current()&&state.uploading)state=state.copy(uploadProgress=progress)}}
    }
    private suspend fun uploadPickedImage(api:GatewayClient,uri:Uri,onProgress:(NativeUploadProgress)->Unit,mime:String?=null):NativeImage=withContext(Dispatchers.IO){
        val resolver=getApplication<Application>().contentResolver
        val bytes=resolver.openInputStream(uri)?.use{stream->
            val output=java.io.ByteArrayOutputStream();val chunk=ByteArray(8192)
            while(true){
                currentCoroutineContext().ensureActive()
                val count=stream.read(chunk);if(count<0)break
                require(output.size()+count<=NativePickedImageLimit){"原图片不能超过 20 MB"}
                output.write(chunk,0,count)
            }
            output.toByteArray()
        }?:throw IllegalStateException("无法读取图片")
        currentCoroutineContext().ensureActive()
        api.nativeUpload(bytes,mime?:resolver.getType(uri)?:"image/jpeg","图片",onProgress)
    }
    fun uploadImages(uris:List<Uri>){
        if(uris.isEmpty()||state.uploading)return
        uploadWork{api,current->
            for((index,uri) in uris.withIndex()){
                if(!current())break
                val progress=trackUploadProgress("正在上传图片 ${index+1}/${uris.size}",current)
                val image=uploadPickedImage(api,uri,progress)
                if(current())state=state.copy(images=state.images+image)
            }
        }
    }
    fun uploadMedia(uris:List<Uri>){
        if(uris.isEmpty()||state.uploading)return
        uploadWork{api,current->
            val resolver=getApplication<Application>().contentResolver
            val media=withContext(Dispatchers.IO){uris.map{it to resolver.getType(it).orEmpty()}}
            val images=media.count{it.second.startsWith("image/")}
            val videos=media.count{it.second.startsWith("video/")}
            require(images+videos==uris.size){"只支持选择图片和视频"}
            require(state.uploads.size+videos<=8){"每条消息最多 8 个文件或视频"}
            for((index,entry) in media.withIndex()){
                if(!current())break
                val(uri,mime)=entry
                val progress=trackUploadProgress("正在上传 ${index+1}/${uris.size}",current)
                if(mime.startsWith("image/")){
                    val image=uploadPickedImage(api,uri,progress,mime)
                    if(current())state=state.copy(images=state.images+image)
                }else{
                    val file=withContext(Dispatchers.IO){
                        val info=nativePickedFileInfo(resolver,uri,"视频")
                        api.nativeUploadFile({resolver.openInputStream(uri)?:throw IllegalStateException("无法读取视频")},mime,info.first,info.second,progress)
                    }
                    if(current())state=state.copy(uploads=state.uploads+file)
                }
            }
        }
    }
    fun removeImage(id:String){state=state.copy(images=state.images.filter{it.id!=id})}
    fun uploadFiles(uris:List<Uri>){
        if(uris.isEmpty()||state.uploading)return
        if(state.uploads.size+uris.size>8){state=state.copy(uploadError="每条消息最多 8 个文件");return}
        uploadWork{api,current->
            for((index,uri) in uris.withIndex()){
                if(!current())break
                val progress=trackUploadProgress("正在上传文件 ${index+1}/${uris.size}",current)
                val file=withContext(Dispatchers.IO){
                    val resolver=getApplication<Application>().contentResolver
                    val info=nativePickedFileInfo(resolver,uri,"附件")
                    api.nativeUploadFile({resolver.openInputStream(uri)?:throw IllegalStateException("无法读取文件")},resolver.getType(uri)?:"application/octet-stream",info.first,info.second,progress)
                }
                if(current())state=state.copy(uploads=state.uploads+file)
            }
        }
    }
    fun removeUpload(id:String){state=state.copy(uploads=state.uploads.filter{it.id!=id})}
    fun openUpload(file:NativeUploadedFile){
        fileWork("正在打开 ${file.name}"){api,current->
            val context=getApplication<Application>()
            val endpoint="/api/uploads/files/${file.id}"
            val mime=nativeUploadedMime(file.name,file.mime)
            val nameMime=nativeOutputMime(file.name)
            if(mime.startsWith("image/")||nameMime.startsWith("image/")){openImagePreview(endpoint,current);return@fileWork}
            if(mime=="application/pdf"||nameMime=="application/pdf"){openPdfOutput(api,endpoint,file.name,current);return@fileWork}
            val markdown=nativeIsMarkdownFile(file.name,mime)
            val preview=file.size<=5L*1024*1024&&(markdown||nativeIsTextFile(file.name,mime))
            if(!preview&&nativeNeedsStoragePermission(context))throw NativeStoragePermissionRequired()
            val target=localStorage.temporaryFile(".part")
            try{
                api.nativeDownload(endpoint,target,if(preview)5L*1024*1024 else 100L*1024*1024)
                val content=if(preview)nativeDecodeText(target.readBytes()) else null
                val saved=if(content==null&&current())nativeSavePublicFile(context,file.name,mime){output->target.inputStream().use{it.copyTo(output)}}else null
                withContext(Dispatchers.Main){if(current()){
                    when{
                        content!=null->state=state.copy(markdown=NativeReadableFile(file.name,nativeFilePathHref(file.name),content.content,mime=if(markdown)"text/markdown" else mime,encoding=content.encoding,hasBom=content.hasBom))
                        saved!=null->nativeOpenSavedFile(context,saved,mime)
                    }
                }}
            }finally{target.delete()}
        }
    }
    private suspend fun openPdfOutput(api:GatewayClient,endpoint:String,name:String,current:()->Boolean){
        val scope=cacheScope()
        var file:java.io.File?=null
        var retained=false
        try{
            if(!state.connected)file=localStorage.document(scope,endpoint,name)
            if(file==null){
                val temp=localStorage.temporaryFile(".pdf")
                try{
                    try{api.nativeDownload(endpoint,temp);file=localStorage.retainDocument(temp,name,scope,endpoint)}
                    catch(error:java.io.IOException){file=localStorage.document(scope,endpoint,name)?:throw error}
                }finally{temp.delete()}
            }
            val ready=checkNotNull(file)
            withContext(Dispatchers.Main){if(current()){showCachedPdf(ready.absolutePath,name);retained=true}}
        }finally{if(!retained)file?.let{localStorage.release(it.absolutePath);runCatching{localStorage.trim()}}}
    }
    private suspend fun outputFileEndpoint(api:GatewayClient,snapshot:NativeState,href:String,eventId:String,threadId:String,current:()->Boolean):String {
        try{return nativeFileEndpoint(snapshot,href)}catch(_:IllegalArgumentException){
            if(!state.connected&&eventId.isNotBlank()&&threadId.isNotBlank()&&"local-thread-output-files" in snapshot.capabilities)return nativeThreadOutputEndpoint(threadId,eventId,href)
            val projects=api.listProjects()
            withContext(Dispatchers.Main){if(current())state=state.copy(projects=projects)}
            check(current()){"连接已改变，请重新打开文件"}
            return try{nativeFileEndpoint(snapshot.copy(projects=projects),href)}catch(error:IllegalArgumentException){
                if(eventId.isBlank()||threadId.isBlank())throw error
                check("local-thread-output-files" in state.capabilities){"请更新电脑网关后查看会话文件"}
                nativeThreadOutputEndpoint(threadId,eventId,href)
            }
        }
    }
    fun openOutput(href:String){openOutput(href,"",state.threadId)}
    fun openOutput(href:String,eventId:String,threadId:String){
        val snapshot=state
        val downloadEndpoint=nativeGatewayDownloadEndpoint(href,listOf(snapshot.address,snapshot.publicUrl,snapshot.activeAddress))
        if(downloadEndpoint==null&&(href.startsWith("https://",true)||href.startsWith("http://",true))){nativeOpenBrowser(getApplication<Application>(),href);return}
        val outputName=if(downloadEndpoint!=null)"Codex-Control.apk" else nativeOutputLinkName(href)
        if(nativeOutputMime(outputName).startsWith("image/")){
            fileWork("正在打开图片"){api,current->openImagePreview(outputFileEndpoint(api,snapshot,href,eventId,threadId,current),current)}
            return
        }
        if(nativeIsMarkdownFile(outputName)){
            val name=outputName
            fileWork("正在打开 $name"){api,current->
                val file=localStorage.temporaryFile(".md")
                try{
                    api.nativeDownload(outputFileEndpoint(api,snapshot,href,eventId,threadId,current),file)
                    val content=if(file.length()<=5L*1024*1024)nativeDecodeText(file.readBytes())else null
                    if(content!=null){
                        withContext(Dispatchers.Main){if(current())state=state.copy(markdown=NativeReadableFile(name,href,content.content,eventId,threadId,encoding=content.encoding,hasBom=content.hasBom))}
                    }else if(current()){
                        val context=getApplication<Application>()
                        val saved=nativeSavePublicFile(context,name,"text/markdown"){output->file.inputStream().use{it.copyTo(output)}}
                        withContext(Dispatchers.Main){if(current())nativeOpenSavedFile(context,saved,"text/markdown")}
                    }
                }finally{file.delete()}
            }
            return
        }
        if(outputName.endsWith(".pdf",true)){
            val name=outputName
            fileWork("正在打开 $name"){api,current->
                openPdfOutput(api,outputFileEndpoint(api,snapshot,href,eventId,threadId,current),name,current)
            }
            return
        }
        fileWork("正在下载 $outputName"){api,current->
            val context=getApplication<Application>()
            if(nativeNeedsStoragePermission(context))throw NativeStoragePermissionRequired()
            val file=localStorage.temporaryFile(".part")
            try{
                api.nativeDownload(downloadEndpoint?:outputFileEndpoint(api,snapshot,href,eventId,threadId,current),file)
                if(current()){
                    val mime=nativeOutputMime(outputName)
                    val saved=nativeSavePublicFile(context,outputName,mime){output->file.inputStream().use{it.copyTo(output)}}
                    withContext(Dispatchers.Main){if(current())nativeOpenSavedFile(context,saved,mime)}
                }
            }finally{file.delete()}
        }
    }
    private fun showCachedPdf(path:String,name:String){
        state.pdf?.let{localStorage.release(it.path)}
        state=state.copy(pdf=NativePdf(path,name,System.nanoTime()))
        viewModelScope.launch(Dispatchers.IO){runCatching{localStorage.trim()}}
    }
    fun closePdf(){state.pdf?.let{localStorage.release(it.path)};state=state.copy(pdf=null);viewModelScope.launch(Dispatchers.IO){runCatching{localStorage.trim()}}}
    fun closeMarkdown(){state=state.copy(markdown=null)}
    private suspend fun openImagePreview(endpoint:String,current:()->Boolean){
        val image=loadImage(endpoint,2048)
        withContext(Dispatchers.Main){if(current())state=state.copy(openedImage=NativeOpenedImage(endpoint,image.first))}
    }
    fun closeImage(){state=state.copy(openedImage=null)}
    fun showImage(endpoint:String,bitmap:android.graphics.Bitmap,endpoints:List<String> = listOf(endpoint),thumbnails:Map<String,Pair<android.graphics.Bitmap,String>> = emptyMap()){
        if(endpoint !in endpoints)return
        state=state.copy(openedImage=NativeOpenedImage(endpoint,bitmap,endpoints.toList(),thumbnails.toMap()))
    }
    private val questionDrafts=mutableStateMapOf<String,Map<String,String>>()
    internal fun questionDraftKey(threadId:String,id:String)=org.json.JSONArray(listOf(state.address.trimEnd('/'),state.certificateSha256.lowercase(),threadId,id)).toString()
    internal fun questionDraft(key:String):Map<String,String> = questionDrafts[key].orEmpty()
    internal fun editQuestionDraft(key:String,id:String,value:String){questionDrafts[key]=questionDraft(key)+(id to value)}
    fun answerQuestions(id:String,answers:Map<String,String>){
        val api=client?:return;val epoch=generation;val chosen=selection;val threadId=state.threadId
        val values=JSONObject();answers.forEach{(key,value)->values.put(key,JSONObject().put("answers",org.json.JSONArray().put(value)))}
        val body=JSONObject().put("threadId",threadId).put("answers",values)
        val draftKey=questionDraftKey(threadId,id)
        fun current()=epoch==generation&&api===client
        scopedWork({current()&&chosen==selection}){
            api.nativeJson("POST","/api/approvals/$id/answer",body)
            withContext(Dispatchers.Main){questionDrafts.remove(draftKey);if(current())finishApproval(id,threadId,"answered",chosen)}
        }
    }
    fun approve(id:String,accept:Boolean):Job?{
        val api=client?:return null;val epoch=generation;val chosen=selection;val threadId=state.threadId
        fun current()=epoch==generation&&api===client
        return scopedWork({current()&&chosen==selection}){
            api.nativeApproval(id,if(accept)"accept" else "decline")
            withContext(Dispatchers.Main){if(current())finishApproval(id,threadId,if(accept)"accepted" else "declined",chosen)}
        }
    }
    private fun finishApproval(id:String,threadId:String,result:String,chosen:Int){
        state=state.copy(approvalResults=state.approvalResults+(nativeApprovalKey(threadId,id) to result))
        if(chosen==selection&&state.threadId==threadId)
            state=state.copy(approvals=state.approvals+id,pendingApprovals=state.pendingApprovals.filter{it.approvalId!=id})
    }

    fun files(path:String=""){
        val snapshot=state
        val workspace=snapshot.threads.find{it.id==snapshot.threadId}?.projectPath?.takeIf{it.isNotBlank()}
            ?:snapshot.projects.find{it.id==snapshot.projectId}?.path
        fileWork("正在加载文件列表",trackProject=false){api,current->
            require(!workspace.isNullOrBlank()){"请先选择文件所属工作区"}
            fun resolve(projects:List<Project>)=projects.filter{
                nativePath(workspace)==nativePath(it.path)||nativePath(workspace).startsWith(nativePath(it.path).trimEnd('/')+"/")
            }.maxByOrNull{it.path.length}
            val projects=api.listProjects()
            val project=resolve(projects)?:throw IllegalArgumentException("当前会话目录未获授权，请在电脑网关添加工作区目录后重试")
            val base=workspace.replace('\\','/').removePrefix("//?/").trimEnd('/').substring(project.path.replace('\\','/').removePrefix("//?/").trimEnd('/').length).trimStart('/')
            val target=path.takeIf{it.isNotBlank()&&(base.isBlank()||it==base||it.startsWith("$base/"))}?:base
            val entries=api.listFiles(project.id,target)
            withContext(Dispatchers.Main){if(current())state=state.copy(files=entries,filePath=target,file=null,fileProjectId=project.id,fileRootPath=base,projects=(projects+state.projects).distinctBy{it.id})}
        }
    }
    private val fileDrafts=mutableMapOf<String,String>()
    fun backToFiles(){
        if(state.fileBusy)return
        fileRetry=null
        state=state.copy(file=null,fileDraft="",fileError="",fileMessage="",fileFeedbackVisible=false)
    }
    private fun fileDraftKey(projectId:String,path:String)=org.json.JSONArray(listOf(state.address,state.certificateSha256,projectId,path)).toString()
    fun editFile(text:String){
        val file=state.file?.takeIf{it.editable}?:return
        val key=fileDraftKey(state.fileProjectId.ifBlank{state.projectId},file.path)
        if(text==file.content&&!state.fileBusy)fileDrafts.remove(key) else fileDrafts[key]=text
        state=state.copy(fileDraft=text)
    }
    fun readFile(file:FileEntry){
        if(file.kind=="directory"){files(file.path);return}
        val snapshot=state
        val projectId=snapshot.fileProjectId.ifBlank{snapshot.projectId};val key=fileDraftKey(projectId,file.path)
        fileWork("正在打开 ${file.name}",trackProject=false){api,current->
            val project=snapshot.projects.find{it.id==projectId}?:throw IllegalArgumentException("请刷新文件列表后重试")
            // FileEntry paths belong to the browsed project, which may differ from the conversation's project.
            val sourcePath=nativeWorkspaceFilePath(project,file.path)
            val endpoint=nativeFileEndpointForPath(snapshot,sourcePath)
            if(file.path.endsWith(".pdf",true)){openPdfOutput(api,endpoint,file.name,current);return@fileWork}
            if(nativeOutputMime(file.name).startsWith("image/")){openImagePreview(endpoint,current);return@fileWork}
            val result=api.readFile(projectId,file.path).copy(editable=true)
            withContext(Dispatchers.Main){if(current()){
                val draft=fileDrafts[key]?:result.content
                if(draft==result.content)fileDrafts.remove(key)
                state=state.copy(file=result,fileDraft=draft,markdown=if(nativeIsMarkdownFile(file.path))NativeReadableFile(file.name,nativeFilePathHref(sourcePath),draft) else null)
            }}
        }
    }
    fun saveFile(){
        val file=state.file?.takeIf{it.editable}?:return
        val text=state.fileDraft;if(text==file.content)return
        val projectId=state.fileProjectId.ifBlank{state.projectId};val key=fileDraftKey(projectId,file.path)
        fileWork("正在保存 ${file.path.substringAfterLast('/')}",trackProject=false){api,current->
            api.saveFile(projectId,file.path,text)
            withContext(Dispatchers.Main){if(current()){
                if(state.fileDraft==text)fileDrafts.remove(key) else fileDrafts[key]=state.fileDraft
                state=state.copy(file=file.copy(content=text))
            }}
        }
    }
    private var diffTicket=0
    fun diff(){
        val api=client?:return;val project=state.projectId
        if(project.isBlank()){error("请先选择改动所属项目");return}
        val epoch=generation;val chosen=selection;val ticket=++diffTicket
        fun current()=ticket==diffTicket&&epoch==generation&&chosen==selection&&project==state.projectId&&api===client
        state=state.copy(diff="")
        scopedWork(::current){
            val result=api.readDiff(project)
            withContext(Dispatchers.Main){if(current())state=state.copy(diff=result.diff.ifBlank{"没有未提交的改动"})}
        }
    }
    private data class WorkspaceTerminal(val session:String="",val active:Boolean=false,val draft:String="",val error:String="")
    private val workspaceTerminals=mutableMapOf<Triple<String,String,String>,WorkspaceTerminal>()
    private val terminalOperations=mutableSetOf<Triple<String,String,String>>()
    private val terminalOutput=android.util.LruCache<Triple<String,String,String>,String>(64)
    private fun terminalScope()=Triple(state.address,state.certificateSha256,state.projectId)
    fun openTerminal(){
        val key=terminalScope();val terminal=workspaceTerminals[key]?:WorkspaceTerminal()
        state=state.copy(terminal=terminalOutput.get(Triple(key.first,key.second,terminal.session)).orEmpty(),
            terminalSession=terminal.session.takeIf{terminal.active}.orEmpty(),terminalDraft=terminal.draft,terminalError=terminal.error,terminalBusy=key in terminalOperations)
    }
    fun editTerminal(text:String){
        val key=terminalScope();workspaceTerminals[key]=(workspaceTerminals[key]?:WorkspaceTerminal()).copy(draft=text)
        state=state.copy(terminalDraft=text)
    }
    fun terminal(){
        val api=client?:return;val key=terminalScope();val epoch=generation
        if(key.third.isBlank()){error("请先选择终端所属项目");return}
        val text=workspaceTerminals[key]?.draft.orEmpty()
        if(text.isBlank()||!terminalOperations.add(key))return
        workspaceTerminals[key]=(workspaceTerminals[key]?:WorkspaceTerminal()).copy(error="")
        state=state.copy(error="")
        fun current()=epoch==generation&&api===client&&terminalScope()==key
        openTerminal()
        scopedWork(::current){try{
            var terminal=withContext(Dispatchers.Main){workspaceTerminals[key]?:WorkspaceTerminal()}
            if(!terminal.active){
                val session=api.startTerminalSession(key.third).sessionId
                check(session.isNotBlank()){"电脑未返回终端会话"}
                terminal=withContext(Dispatchers.Main){
                    (workspaceTerminals[key]?:terminal).copy(session=session,active=true).also{workspaceTerminals[key]=it;if(current())openTerminal()}
                }
            }
            if(!withContext(Dispatchers.Main){epoch==generation&&api===client})return@scopedWork
            try{api.sendTerminalSessionInput(terminal.session,text)}
            catch(error:Exception){
                if(error.message?.contains("交互式终端会话不存在或已结束")==true)withContext(Dispatchers.Main){
                    workspaceTerminals[key]?.takeIf{it.session==terminal.session}?.let{workspaceTerminals[key]=it.copy(active=false)}
                    if(current())openTerminal()
                }
                throw error
            }
            withContext(Dispatchers.Main){
                workspaceTerminals[key]?.takeIf{it.draft==text}?.let{workspaceTerminals[key]=it.copy(draft="")}
                if(current())openTerminal()
            }
        }catch(error:CancellationException){throw error}
        catch(error:Exception){withContext(Dispatchers.Main){workspaceTerminals[key]=(workspaceTerminals[key]?:WorkspaceTerminal()).copy(error=nativeError(error));if(current())openTerminal()};throw error}
        finally{withContext(NonCancellable+Dispatchers.Main){terminalOperations.remove(key);if(current())openTerminal()}}}
    }
    fun stopTerminal(){
        val api=client?:return;val key=terminalScope();val epoch=generation
        val terminal=workspaceTerminals[key]?.takeIf{it.active}?:return
        if(!terminalOperations.add(key))return
        workspaceTerminals[key]=terminal.copy(error="")
        state=state.copy(error="")
        fun current()=epoch==generation&&api===client&&terminalScope()==key
        openTerminal()
        scopedWork(::current){try{
            try{api.stopTerminalSession(terminal.session)}catch(error:Exception){
                if(error.message?.contains("交互式终端会话不存在或已结束")!=true)throw error
            }
            withContext(Dispatchers.Main){workspaceTerminals[key]?.takeIf{it.session==terminal.session}?.let{workspaceTerminals[key]=it.copy(active=false)}}
        }catch(error:CancellationException){throw error}
        catch(error:Exception){withContext(Dispatchers.Main){workspaceTerminals[key]=(workspaceTerminals[key]?:WorkspaceTerminal()).copy(error=nativeError(error));if(current())openTerminal()};throw error}
        finally{withContext(NonCancellable+Dispatchers.Main){terminalOperations.remove(key);if(current())openTerminal()}}}
    }
    private var fileJob:Job?=null
    private var fileRetry:(()->Unit)?=null
    private var fileTicket=0
    private fun clearFileContext(preserveImage:Boolean=false){
        cancelUpload()
        state.pdf?.let{localStorage.release(it.path);viewModelScope.launch(Dispatchers.IO){runCatching{localStorage.trim()}}}
        projectTicket++;fileTicket++;diffTicket++;fileJob?.cancel();fileJob=null;fileRetry=null
        state=state.copy(diff="",terminal="",terminalSession="",terminalDraft="",terminalError="",terminalBusy=false,fileBusy=false,fileMessage="",fileError="",fileFeedbackVisible=false,files=emptyList(),filePath="",file=null,fileDraft="",fileProjectId="",fileRootPath="",pdf=null,markdown=null,openedImage=state.openedImage.takeIf{preserveImage},storagePermissionRequired=false)
    }
    internal fun storagePermissionResult(granted:Boolean){
        if(!state.storagePermissionRequired)return
        state=state.copy(storagePermissionRequired=false)
        if(granted)fileRetry?.invoke()else state=state.copy(fileError="未获得存储权限，文件未保存",fileFeedbackVisible=true)
    }
    fun hideFileFeedback(){state=state.copy(fileFeedbackVisible=false)}
    fun retryFile(){fileRetry?.invoke()}
    private fun fileWork(label:String,trackProject:Boolean=true,action:suspend (GatewayClient,()->Boolean)->Unit){
        if(fileJob?.isActive==true){state=state.copy(fileFeedbackVisible=true);return}
        val api=client;val epoch=generation;val chosen=selection;val project=state.projectId;val ticket=++fileTicket
        fun current()=ticket==fileTicket&&epoch==generation&&chosen==selection&&(!trackProject||project==state.projectId)&&api===client
        fileRetry={if(current())fileWork(label,trackProject,action)}
        state=state.copy(fileBusy=true,fileMessage=label,fileError="",fileFeedbackVisible=true)
        fileJob=viewModelScope.launch {
            val slow=launch{delay(5000);if(current())state=state.copy(fileMessage="$label… 网络较慢，正在等待电脑响应")}
            try{
                check(api!=null){"尚未连接电脑，请先连接后重试"}
                withContext(Dispatchers.IO){action(api,::current)}
                if(current()){state=state.copy(fileFeedbackVisible=false,fileMessage="");fileRetry=null}
            }catch(e:CancellationException){throw e}
            catch(e:NativeStoragePermissionRequired){if(current())state=state.copy(storagePermissionRequired=true,fileFeedbackVisible=false)}
            catch(e:Exception){
                val message=when{
                    e.message?.let{it.contains("HTTP 404")||it.contains("(404)") }==true->"文件不存在或已移动，请刷新文件列表"
                    e.message?.let{it.contains("HTTP 503")||it.contains("(503)") }==true->"电脑服务暂不可用，请稍后重试"
                    e.message?.let{it.contains("HTTP 403")||it.contains("(403)") }==true->"没有访问此文件的权限"
                    e is java.net.UnknownHostException->"无法访问电脑地址，请检查网络后重试"
                    else->nativeError(e).ifBlank{"操作失败，请重试"}
                }
                if(current())state=state.copy(fileError=message,fileFeedbackVisible=true)
            }
            finally{slow.cancel();if(ticket==fileTicket){fileJob=null;if(current())state=state.copy(fileBusy=false)else{fileRetry=null;state=state.copy(fileBusy=false,fileFeedbackVisible=false,fileMessage="",fileError="")}}}
        }
    }
    private val activeWork=mutableStateMapOf<Any,()->Boolean>()
    internal fun currentWorkBusy():Boolean=state.workBusy&&activeWork.values.any{it()}
    fun work(action:suspend ()->Unit)=scopedWork({true},action)
    private fun scopedWork(current:()->Boolean,action:suspend ()->Unit):Job{
        val token=Any();activeWork[token]=current;state=state.copy(workBusy=true)
        return viewModelScope.launch(Dispatchers.IO){
            try{action()}
            catch(e:CancellationException){throw e}
            catch(e:Exception){withContext(Dispatchers.Main){if(current())state=state.copy(error=e.message.orEmpty())}}
            finally{withContext(NonCancellable+Dispatchers.Main){activeWork.remove(token);state=state.copy(workBusy=activeWork.isNotEmpty())}}
        }
    }
    override fun onCleared(){networkMonitor.close();state.pdf?.let{localStorage.release(it.path)};localRouteProbe?.cancel();connection?.cancel();polling?.cancel();clearImageLoads();super.onCleared()}
}

private fun nativeError(error:Exception):String=when(error){
    is java.net.ConnectException -> "无法连接电脑，请确认电脑控制台已打开，并使用同一网络。"
    is java.net.SocketTimeoutException -> "连接超时，请检查电脑地址和网络。"
    else -> if(error.message?.contains("401")==true)"配对已失效，请重新输入电脑上的配对码。" else error.message.orEmpty()
}
