package com.localcodex.control

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import org.json.JSONObject
import java.util.UUID

data class NativeQueued(val id:String,val text:String,val status:String,val error:String,val canSteer:Boolean,val images:List<NativeImage> = emptyList(),val uploads:List<NativeUploadedFile> = emptyList())
data class NativePdf(val path:String,val name:String)
data class NativeMarkdownFile(val name:String,val sourcePath:String,val content:String)
data class NativeState(
    val harness:String="codex",
    val connected:Boolean=false,val connecting:Boolean=false,val error:String="",val address:String="",val publicUrl:String="",val remotePassword:String="",val certificateSha256:String="",val activeAddress:String="",
    val projects:List<Project> = emptyList(),val sidebarProjects:List<Project> = emptyList(),val threads:List<ThreadRecord> = emptyList(),
    val models:List<NativeModel> = emptyList(),val model:String="",val effort:String="",val permission:String="full",
    val threadId:String="",val projectId:String="",val events:List<ChatEvent> = emptyList(),
    val draft:String="",val images:List<NativeImage> = emptyList(),val uploads:List<NativeUploadedFile> = emptyList(),val uploading:Boolean=false,
    val sending:Boolean=false,val running:Boolean=false,val loadingHistory:Boolean=false,val loadingOlderHistory:Boolean=false,val hasMoreHistory:Boolean=false,
    val queue:List<NativeQueued> = emptyList(),val files:List<FileEntry> = emptyList(),val filePath:String="",
    val file:FileContent?=null,val diff:String="",val terminal:String="",val terminalSession:String="",
    val approvals:Set<String> = emptySet(),val workBusy:Boolean=false,val pdf:NativePdf?=null,val markdown:NativeMarkdownFile?=null,
    val pendingApprovals:List<ChatEvent> = emptyList(),
    val desktopAutoApprove:Boolean=false,val remoteApprovalBusy:Boolean=false,val approvalBridgeConfigured:Boolean=false,val approvalBridgeConnected:Boolean=false,
    val usage:JSONObject?=null,val usageLoading:Boolean=false,val usageError:String="",val usageDays:Int=1
)
private data class NativePending(val id:String,val threadId:String,val selection:Int,val text:String,val images:List<NativeImage>,val uploads:List<NativeUploadedFile>)
class NativeViewModel(application:Application):AndroidViewModel(application) {
    private val store=ConnectionStore(application)
    private val prefs=application.getSharedPreferences("native",0)
    var state by mutableStateOf(NativeState(harness=prefs.getString("harness","codex")?:"codex",address=store.baseUrl(),publicUrl=store.publicUrl(),remotePassword=store.remotePassword(),certificateSha256=store.certificateSha256(),permission=prefs.getString("permission","full")?:"full"))
        private set
    var client:GatewayClient?=null
        private set
    private var connection:Job?=null
    private var polling:Job?=null
    private var historyJob:Job?=null
    private var historyTicket=0
    private var historyCount=60
    private var historyInFlightFor:String?=null
    private var listJob:Job?=null
    private var pending:NativePending?=null
    private var selection=0
    private var generation=0
    private var hydration:MutableList<ChatEvent>?=null
    private fun key()="native:"+(if(state.harness=="codex")"" else state.harness+":")+state.threadId.ifBlank { "new:${state.projectId}" }
    init {state=state.copy(draft=store.chatDraft(key()),permission=prefs.getString("permission:"+state.harness,"full")?:"full")}
    fun error(message:String){state=state.copy(error=message)}
    fun loadUsage(days:Int=state.usageDays){
        val api=client?:return;val id=state.threadId;val chosen=selection;val harness=state.harness
        state=state.copy(usageDays=days,usageLoading=true,usageError="")
        viewModelScope.launch {
            try{val result=withContext(Dispatchers.IO){api.nativeJson("GET","/api/usage?agent=$harness&days=$days"+if(id.isNotBlank())"&threadId=$id" else "")};if(selection==chosen&&state.usageDays==days)state=state.copy(usage=result,usageLoading=false)}
            catch(e:CancellationException){throw e}
            catch(e:Exception){if(selection==chosen)state=state.copy(usageLoading=false,usageError=if(e.message?.contains("404")==true)"电脑网关需要更新后才能查看用量，请运行“更新电脑网关”。" else nativeError(e))}
        }
    }
    fun draft(text:String){state=state.copy(draft=text);store.saveChatDraft(key(),text)}
    fun autoConnect(){if(store.baseUrl().isNotBlank()&&store.token().isNotBlank())connect(store.baseUrl(),store.token())}
    fun connect(address:String,token:String=store.token(),code:String="",publicUrl:String=store.publicUrl(),remotePassword:String=store.remotePassword(),certificateSha256:String=store.certificateSha256()) {
        connection?.cancel();polling?.cancel();lastListRefresh=0;generation++;val epoch=generation
        val url=gatewayBaseUrlCandidates(address,"38457").first()
        val parsed=Uri.parse(url)
        if(parsed.host.isNullOrBlank()||parsed.userInfo!=null){error("请输入有效的电脑地址");return}
        if(parsed.scheme!="https"&&parsed.host !in setOf("127.0.0.1","localhost","10.0.2.2")){error("内网地址必须使用 HTTPS");return}
        val remote=publicUrl.trim().trimEnd('/')
        if(remote.isNotBlank()&&(Uri.parse(remote).scheme!="https"||Uri.parse(remote).host.isNullOrBlank()||Uri.parse(remote).userInfo!=null)){error("公网地址必须是 HTTPS 地址");return}
        if(certificateSha256.isNotBlank()&&!certificateSha256.replace(":","").matches(Regex("[0-9a-fA-F]{64}"))){error("本地证书指纹应为 64 位 SHA-256 十六进制字符");return}
        store.saveRemote(remote,remotePassword,certificateSha256)
        state=state.copy(address=url,publicUrl=remote,remotePassword=remotePassword,certificateSha256=certificateSha256,connecting=true,connected=false,error="")
        connection=viewModelScope.launch {
            var savedToken=token
            var pairPending=code.isNotBlank()
            var attempts=0
            while(isActive&&generation==epoch) {
                var authenticationFailed=false
                for(candidate in listOf(url,remote.takeIf{remotePassword.isNotBlank()}.orEmpty()).filter{it.isNotBlank()}.distinct()) {
                  if(!isActive||generation!=epoch)break
                  val publicConnection=candidate==remote&&remote.isNotBlank()
                  val api=GatewayClient(candidate,savedToken,remotePassword=if(publicConnection)remotePassword else "",certificateSha256=if(publicConnection)"" else certificateSha256,useDeviceCertificate=true)
                  try {
                    if(pairPending){savedToken=withContext(Dispatchers.IO){api.claimPairing(code).token};pairPending=false}
                    val models=withContext(Dispatchers.IO){coroutineScope {
                        val health=async{api.health()};val catalog=async{api.nativeModels()}
                        check(health.await().minAndroidProtocolVersion<=1){"请更新客户端"}
                        catalog.await()
                    }}
                    store.save(url,savedToken)
                    client=GatewayClient(candidate,savedToken,remotePassword=if(publicConnection)remotePassword else "",certificateSha256=if(publicConnection)"" else certificateSha256,useDeviceCertificate=true)
                    val candidates=models.filter{nativeAgent(it.id)==state.harness};val model=candidates.firstOrNull{it.id==prefs.getString("model:${state.harness}",prefs.getString("model",""))}?:candidates.firstOrNull{it.id.endsWith("::default")}?:candidates.firstOrNull()
                    val savedEffort=model?.let{prefs.getString("effort:${it.id}",it.defaultEffort).orEmpty()}
                    state=state.copy(models=models,model=model?.id.orEmpty(),effort=if(model?.efforts?.contains(savedEffort)==true)savedEffort.orEmpty() else model?.defaultEffort.orEmpty(),activeAddress=candidate)
                    client!!.events().collect { event ->
                        if(event.type=="connection.opened") {
                            attempts=0;state=state.copy(connected=true,connecting=false,error="")
                            polling?.cancel();polling=viewModelScope.launch {while(isActive){if(listJob?.isActive!=true)listJob=launch{refreshLists()};refreshHistory();delay(2500)}}
                        } else receive(event)
                    }
                  }catch(e:CancellationException){throw e}
                  catch(e:Exception){state=state.copy(error=nativeError(e));if(e.message?.contains("401")==true){authenticationFailed=true;break}}
                  polling?.cancel();recoverPending();state=state.copy(connected=false,connecting=true)
                }
                if(authenticationFailed){state=state.copy(connected=false,connecting=false);return@launch}
                polling?.cancel();recoverPending();state=state.copy(connected=false,connecting=true)
                attempts++;delay((1000L*attempts).coerceAtMost(15000))
            }
        }
    }
    fun disconnect(){generation++;connection?.cancel();polling?.cancel();recoverPending();state=state.copy(connected=false,connecting=false)}
    fun chooseModel(id:String){if(nativeAgent(id)!=state.harness){error("请在新会话中切换助手");return};val m=state.models.find{it.id==id}?:return;val saved=prefs.getString("effort:$id",m.defaultEffort).orEmpty();state=state.copy(model=id,effort=if(saved in m.efforts)saved else m.defaultEffort);prefs.edit().putString("model:${state.harness}",id).apply();rememberThreadSettings()}
    fun effort(value:String){if(state.models.find{it.id==state.model}?.efforts?.contains(value)==true){state=state.copy(effort=value);prefs.edit().putString("effort:${state.model}",value).apply();rememberThreadSettings()}}
    fun permission(value:String){if(value in setOf("ask","auto","full")||(value=="custom"&&state.harness=="codex")){state=state.copy(permission=value);prefs.edit().putString("permission:${state.harness}",value).apply();rememberThreadSettings()}}
    fun loadRemoteApproval(){val api=client?:return;viewModelScope.launch{try{val result=withContext(Dispatchers.IO){api.nativeJson("GET","/api/settings/remote-approval")};state=state.copy(desktopAutoApprove=result.optBoolean("desktopAutoApprove"),approvalBridgeConfigured=result.optBoolean("bridgeConfigured"),approvalBridgeConnected=result.optBoolean("connected"))}catch(e:Exception){state=state.copy(error=nativeError(e))}}}
    fun setRemoteAutoApproval(enabled:Boolean){val api=client?:return;viewModelScope.launch{state=state.copy(remoteApprovalBusy=true);try{val result=withContext(Dispatchers.IO){api.nativeJson("PUT","/api/settings/remote-approval",JSONObject().put("desktopAutoApprove",enabled))};state=state.copy(desktopAutoApprove=enabled,approvalBridgeConfigured=result.optBoolean("bridgeConfigured"),approvalBridgeConnected=result.optBoolean("connected"),error=if(result.optInt("failed")>0)"部分待处理审批未能自动完成，请手动处理" else state.error)}catch(e:Exception){state=state.copy(error=nativeError(e))}finally{state=state.copy(remoteApprovalBusy=false)}}}
    private fun rememberThreadSettings(){if(state.threadId.isNotBlank())prefs.edit().putString("thread:${state.threadId}:model",state.model).putString("thread:${state.threadId}:effort",state.effort).putString("thread:${state.threadId}:permission",state.permission).apply()}
    private val harnessImages=mutableMapOf<String,List<NativeImage>>()
    private val harnessUploads=mutableMapOf<String,List<NativeUploadedFile>>()
    fun switchHarness(harness:String){
        if(harness==state.harness)return
        if(state.sending){error("消息正在提交，请稍后切换");return}
        store.saveChatDraft(key(),state.draft)
        prefs.edit().putString("workspace:"+state.harness+":thread",state.threadId).putString("workspace:"+state.harness+":project",state.projectId).apply()
        harnessImages[state.harness]=state.images
        harnessUploads[state.harness]=state.uploads
        state=state.copy(harness=harness,draft="",images=emptyList(),uploads=emptyList());prefs.edit().putString("harness",harness).apply()
        val project=state.projects.find{it.id==prefs.getString("workspace:"+harness+":project","")}
        newThread(project,false)
        val thread=state.threads.find{it.id==prefs.getString("workspace:"+harness+":thread","")&&nativeThreadAgent(it.id)==harness}
        if(thread!=null)openThread(thread)
        state=state.copy(images=harnessImages[harness].orEmpty(),uploads=harnessUploads[harness].orEmpty(),error="",usage=null,usageError="",files=emptyList(),file=null,terminal="",terminalSession="",diff="")
    }
    fun newThread(project:Project?=null,saveCurrent:Boolean=true){
        if(saveCurrent)store.saveChatDraft(key(),state.draft);selection++;historyTicket++;historyInFlightFor=null;historyJob?.cancel()
        historyCount=60
        val candidates=state.models.filter{nativeAgent(it.id)==state.harness}
        val preferred=candidates.find{it.id==prefs.getString("model:"+state.harness,prefs.getString("model",""))}?:candidates.find{it.id.endsWith("::default")}?:candidates.firstOrNull()
        val effort=prefs.getString("effort:"+preferred?.id,preferred?.defaultEffort).orEmpty()
        state=state.copy(threadId="",projectId=project?.id.orEmpty(),model=preferred?.id.orEmpty(),effort=if(effort in preferred?.efforts.orEmpty())effort else preferred?.defaultEffort.orEmpty(),permission=prefs.getString("permission:"+state.harness,"full")?:"full",events=emptyList(),pendingApprovals=emptyList(),images=emptyList(),uploads=emptyList(),queue=emptyList(),running=false,sending=false,loadingHistory=false,loadingOlderHistory=false,hasMoreHistory=false)
        state=state.copy(draft=store.chatDraft(key()))
    }
    fun startInProject(project:Project){val allowed=state.projects.find{nativePath(it.path)==nativePath(project.path)};if(allowed!=null)newThread(allowed) else work{val added=client!!.addProject(project.path);withContext(Dispatchers.Main){state=state.copy(projects=state.projects.filter{it.id!=added.id}+added);newThread(added)}}}
    fun renameThread(thread:ThreadRecord,title:String){if(title.isBlank())return;work{client!!.renameThread(thread.id,title.trim());withContext(Dispatchers.Main){state=state.copy(threads=state.threads.map{if(it.id==thread.id)it.copy(title=title.trim()) else it})};refreshLists(true)}}
    fun pinThread(thread:ThreadRecord,pinned:Boolean){work{client!!.nativeJson("POST","/api/threads/${thread.id}/pin",JSONObject().put("pinned",pinned));withContext(Dispatchers.Main){state=state.copy(threads=state.threads.map{if(it.id==thread.id)it.copy(pinnedIndex=if(pinned)0 else -1)else it})};refreshLists(true)}}
    fun updateGoal(threadId:String,objective:String?=null,status:String?=null){
        val body=JSONObject();if(objective!=null)body.put("objective",objective);if(status!=null)body.put("status",status)
        work{val goal=client!!.nativeJson("PATCH","/api/threads/$threadId/goal",body).getJSONObject("goal");withContext(Dispatchers.Main){state=state.copy(threads=state.threads.map{if(it.id==threadId)it.copy(goal=NativeGoal(goal.optString("objective"),goal.optString("status"),goal.optLong("tokensUsed"),if(goal.isNull("tokenBudget"))null else goal.optLong("tokenBudget")))else it})};refreshLists(true)}
    }
    fun openThread(thread:ThreadRecord){store.saveChatDraft(key(),state.draft);state=state.copy(harness=nativeThreadAgent(thread.id));prefs.edit().putString("harness",state.harness).apply();selection++;historyTicket++;historyInFlightFor=null;historyJob?.cancel();historyCount=60;val chosenModel=prefs.getString("thread:${thread.id}:model",state.model).orEmpty();val candidates=state.models.filter{nativeAgent(it.id)==nativeThreadAgent(thread.id)};val model=candidates.find{it.id==chosenModel}?:candidates.firstOrNull();val chosenEffort=prefs.getString("thread:${thread.id}:effort",model?.defaultEffort).orEmpty();state=state.copy(threadId=thread.id,projectId=state.projects.find{nativePath(it.path)==nativePath(thread.projectPath)}?.id.orEmpty(),model=model?.id.orEmpty(),effort=if(chosenEffort in model?.efforts.orEmpty())chosenEffort else model?.defaultEffort.orEmpty(),permission=prefs.getString("thread:${thread.id}:permission",prefs.getString("permission:${state.harness}","full"))?:"full",events=emptyList(),images=emptyList(),queue=emptyList(),running=thread.status=="running",sending=false,loadingHistory=true,loadingOlderHistory=false,hasMoreHistory=false);state=state.copy(draft=store.chatDraft(key()));historyJob=viewModelScope.launch{refreshHistory()}}
    fun loadOlderHistory(){if(state.threadId.isBlank()||!state.hasMoreHistory||state.loadingOlderHistory||historyInFlightFor!=null)return;historyCount=(historyCount+60).coerceAtMost(20000);state=state.copy(loadingOlderHistory=true);historyJob=viewModelScope.launch{refreshHistory()}}
    suspend fun refresh(){refreshLists();refreshHistory()}
    private var lastListRefresh=0L
    private suspend fun refreshLists(force:Boolean=false){
        val api=client?:return;val epoch=generation
        if(!force&&System.currentTimeMillis()-lastListRefresh<15000)return
        try {
            val (threads,projects,sidebar)=withContext(Dispatchers.IO){coroutineScope{val threads=async{api.listThreads()};val projects=async{api.listProjects()};val sidebar=async{api.nativeSidebarProjects()};Triple(threads.await(),projects.await(),sidebar.await())}}
            if(generation!=epoch)return
            state=state.copy(threads=threads,projects=projects,sidebarProjects=sidebar,projectId=projects.find{nativePath(it.path)==nativePath(threads.find{t->t.id==state.threadId}?.projectPath.orEmpty())}?.id?:state.projectId)
            if(state.threadId.isNotBlank()&&threads.none{it.id==state.threadId}&&!state.sending)newThread()
            lastListRefresh=System.currentTimeMillis()
        }catch(e:CancellationException){throw e}catch(e:Exception){/* Keep the current list; retry later. */}
    }
    private suspend fun refreshHistory(){
        val api=client?:return;val epoch=generation;val id=state.threadId;val chosen=selection
        if(id.isBlank())return
        if(historyInFlightFor==id)return
        val ticket=++historyTicket;historyInFlightFor=id
        try {
            if(id.isNotBlank()) {
                val buffer=mutableListOf<ChatEvent>();hydration=buffer
                val result=withContext(Dispatchers.IO){api.nativeHistory(id,historyCount)}
                val events=result.first
                val approvals=withContext(Dispatchers.IO){api.nativeJson("GET","/api/approvals?threadId=${java.net.URLEncoder.encode(id,"UTF-8")}").getJSONArray("approvals")}
                val approvalRows=(0 until approvals.length()).map{approvals.getJSONObject(it)}
                val resolved=approvalRows.filter{it.optString("status")!="pending"}.map{it.getString("id")}.toSet()
                val pendingForThread=approvalRows.filter{it.optString("status")=="pending"&&it.optString("threadId")==id}.map{row->
                    ChatEvent(type="approval.requested",threadId=id,approvalId=row.optString("id"),approvalType=row.optString("approvalType"),title=row.optString("title"),detail=row.optString("detail"),eventId="pending-approval:"+row.optString("id"))
                }
                val queued=withContext(Dispatchers.IO){api.nativeJson("GET","/api/threads/$id/queue").getJSONArray("messages")}
                if(chosen==selection&&generation==epoch&&historyTicket==ticket&&hydration===buffer){
                    val ids=events.map{it.eventId}.filter{it.isNotBlank()}.toSet()
                    val status=result.second.ifBlank{state.threads.find{it.id==id}?.status.orEmpty()}
                    state=state.copy(approvals=state.approvals+resolved,pendingApprovals=pendingForThread,events=events+buffer.filter{it.eventId.isBlank()||it.eventId !in ids},loadingHistory=false,loadingOlderHistory=false,hasMoreHistory=result.third&&historyCount<20000,
                        running=buffer.lastOrNull{it.type=="turn.completed"||it.type=="turn.started"}?.let{it.type=="turn.started"}?: (status=="running"),
                        queue=(0 until queued.length()).map{val q=queued.getJSONObject(it);NativeQueued(q.getString("id"),q.optString("text"),q.optString("status"),q.optString("error"),q.optBoolean("canSteer"),q.optJSONArray("images")?.let{a->(0 until a.length()).map{n->a.getJSONObject(n).let{NativeImage(it.getString("id"),it.optString("name"))}}}.orEmpty(),q.optJSONArray("files")?.let{a->(0 until a.length()).map{n->a.getJSONObject(n).let{NativeUploadedFile(it.getString("id"),it.optString("name"),it.optString("mime"),it.optLong("size"))}}}.orEmpty())})
                }
                if(hydration===buffer)hydration=null
            }
        }catch(e:CancellationException){throw e}catch(e:Exception){if(chosen==selection&&historyTicket==ticket)state=state.copy(loadingHistory=false,loadingOlderHistory=false,error=nativeError(e))}
        finally {if(historyTicket==ticket)historyInFlightFor=null}
    }
    private fun receive(event:ChatEvent){
        if(event.replayed)return
        val p=pending
        if(event.type=="message.queued"){
            if(p!=null&&p.id==event.requestId&&p.selection==selection){pending=null;state=state.copy(sending=false,error="");viewModelScope.launch{refreshHistory()}}
            return
        }
        if(event.type=="thread.started"&&p!=null&&event.requestId==p.id&&p.selection==selection){
            pending=p.copy(threadId=event.threadId)
            state=state.copy(threadId=event.threadId,threads=listOf(ThreadRecord(event.threadId,event.projectPath,event.title,event.status))+state.threads.filter{it.id!=event.threadId});rememberThreadSettings()
        }
        if(event.type=="terminal.output"){if(event.commandId==state.terminalSession)state=state.copy(terminal=(state.terminal+event.text).takeLast(60000));return}
        val detail=event.text.ifBlank{event.detail}
        val writerConflict=event.type=="error"&&detail.contains("active writer",true)
        val visibleEvent=if(writerConflict)event.copy(text="此会话正由其他客户端占用。消息未发送，已保留在输入框。",detail="") else event
        if(event.type=="error"&&(event.requestId==p?.id||event.threadId==state.threadId||event.threadId.isBlank())){recoverPending();state=state.copy(error=if(writerConflict)visibleEvent.text else detail,running=if(writerConflict)state.running else false)}
        if(event.threadId!=state.threadId||event.threadId.isBlank())return
        hydration?.add(visibleEvent)
        if(event.eventId.isNotBlank()&&state.events.any{it.eventId==event.eventId})return
        state=state.copy(events=(state.events+visibleEvent).takeLast(5000))
        if(event.type=="user.message") {
            if(pending?.text==event.text){pending=null;state=state.copy(sending=false)}
            if(p!=null&&p.threadId==event.threadId)state=state.copy(running=true)
        }
        if(event.type=="turn.started")state=state.copy(running=true)
        if(event.type=="turn.completed")state=state.copy(running=false,sending=false)
        if(event.type=="approval.resolved")state=state.copy(approvals=state.approvals+event.approvalId,pendingApprovals=state.pendingApprovals.filter{it.approvalId!=event.approvalId})
    }
    fun send(){
        val api=client?:return;if(!state.connected||state.sending||state.uploading)return
        val text=state.draft.trim();val images=state.images;val uploads=state.uploads;if(text.isBlank()&&images.isEmpty()&&uploads.isEmpty())return
        if(state.running){queueMessage();return}
        val thread=state.threads.find{it.id==state.threadId};val id=UUID.randomUUID().toString()
        pending=NativePending(id,state.threadId,selection,text,images,uploads)
        state=state.copy(draft="",images=emptyList(),uploads=emptyList(),sending=true,error="");store.saveChatDraft(key(),"")
        if(!api.nativeSend(thread,state.projects.find{it.id==state.projectId},text,state.model,state.effort,state.permission,id,images,uploads)) {recoverPending();error("连接已断开，消息尚未发送")}
    }
    fun pendingText():String=if(pending?.selection==selection)pending?.text.orEmpty() else ""
    private fun recoverPending(){val p=pending?:return;if(p.selection==selection&&state.draft.isBlank()){state=state.copy(draft=p.text,images=p.images,uploads=p.uploads);store.saveChatDraft(key(),p.text)};pending=null;state=state.copy(sending=false)}
    fun stop(){if(client?.interruptTurn(state.threadId)!=true)error("停止请求未发出，请检查连接")}
    private fun queueMessage(){val id=state.threadId;val text=state.draft;val images=state.images;val uploads=state.uploads;val api=client?:return;val chosen=selection
        val payload=JSONObject().put("id",UUID.randomUUID().toString()).put("text",text).put("model",state.model).put("effort",state.effort).put("permission",state.permission).put("images",org.json.JSONArray(images.map{JSONObject().put("id",it.id).put("name",it.name)})).put("files",org.json.JSONArray(uploads.map{JSONObject().put("id",it.id).put("name",it.name).put("mime",it.mime).put("size",it.size)}))
        state=state.copy(sending=true);work {
        api.nativeJson("POST","/api/threads/$id/queue",payload)
        withContext(Dispatchers.Main){if(selection==chosen){if(state.draft==text)draft("");state=state.copy(sending=false,images=state.images.filter{image->images.none{it.id==image.id}},uploads=state.uploads.filter{file->uploads.none{it.id==file.id}});refresh()}}
    }}
    fun queueAction(item:NativeQueued,action:String,text:String=""){val id=state.threadId;work {client!!.nativeJson(if(action=="delete")"DELETE" else if(action=="edit")"PATCH" else "POST","/api/threads/$id/queue/${item.id}"+(if(action in listOf("steer","retry"))"/$action" else ""),if(action=="edit")JSONObject().put("text",text) else null);withContext(Dispatchers.Main){refresh()}}}
    fun restoreQueued(item:NativeQueued){
        if(state.uploading){error("文件上传完成后再编辑待发消息");return}
        val id=state.threadId;val chosen=selection
        val images=(item.images+state.images).distinctBy{it.id};val uploads=(item.uploads+state.uploads).distinctBy{it.id}
        if(images.size>8||uploads.size>8){error("输入框附件已满，请先移除部分附件再编辑待发消息");return}
        work{
            client!!.nativeJson("DELETE","/api/threads/$id/queue/${item.id}")
            withContext(Dispatchers.Main){
                if(selection==chosen&&state.threadId==id){
                    draft(listOf(item.text,state.draft).filter{it.isNotBlank()}.joinToString("\n\n"))
                    state=state.copy(images=(item.images+state.images).distinctBy{it.id},uploads=(item.uploads+state.uploads).distinctBy{it.id},queue=state.queue.filter{it.id!=item.id})
                }
                refresh()
            }
        }
    }
    fun uploadImages(uris:List<Uri>){
        if(uris.isEmpty()||state.uploading)return
        if(state.images.size+uris.size>8){error("每条消息最多 8 张图片，请减少选择数量");return}
        val api=client?:return
        val chosen=selection
        state=state.copy(uploading=true)
        viewModelScope.launch {
          try { for(uri in uris) {
            if(chosen!=selection)break
            val image=withContext(Dispatchers.IO) {
        val resolver=getApplication<Application>().contentResolver
        val bytes=resolver.openInputStream(uri)?.use{stream->val buffer=java.io.ByteArrayOutputStream();val chunk=ByteArray(8192);while(true){val n=stream.read(chunk);if(n<0)break;buffer.write(chunk,0,n);require(buffer.size()<=5*1024*1024){"图片不能超过 5 MB"}};buffer.toByteArray()}?:throw IllegalStateException("无法读取图片")
        val mime=resolver.getType(uri)?:"image/jpeg"
                api.nativeUpload(bytes,mime,"图片")
            }
            if(chosen==selection)state=state.copy(images=state.images+image)
          }} catch(e:CancellationException){throw e}
          catch(e:Exception){if(chosen==selection)error(nativeError(e))}
          finally {state=state.copy(uploading=false)}
        }
    }
    fun uploadMedia(uris:List<Uri>){
        if(uris.isEmpty()||state.uploading)return
        val resolver=getApplication<Application>().contentResolver
        val images=uris.filter{resolver.getType(it)?.startsWith("image/")==true}
        val videos=uris.filter{resolver.getType(it)?.startsWith("video/")==true}
        if(images.size+videos.size!=uris.size){error("只支持选择图片和视频");return}
        if(state.images.size+images.size>8||state.uploads.size+videos.size>8){error("每条消息最多 8 张图片和 8 个视频");return}
        val api=client?:return;val chosen=selection;state=state.copy(uploading=true)
        viewModelScope.launch{
            try{
                for(uri in uris){
                    if(chosen!=selection)break
                    val mime=resolver.getType(uri).orEmpty()
                    if(mime.startsWith("image/")){
                        val image=withContext(Dispatchers.IO){
                            val bytes=resolver.openInputStream(uri)?.use{stream->val buffer=java.io.ByteArrayOutputStream();val chunk=ByteArray(8192);while(true){val count=stream.read(chunk);if(count<0)break;buffer.write(chunk,0,count);require(buffer.size()<=5*1024*1024){"图片不能超过 5 MB"}};buffer.toByteArray()}?:throw IllegalStateException("无法读取图片")
                            api.nativeUpload(bytes,mime,"图片")
                        }
                        if(chosen==selection)state=state.copy(images=state.images+image)
                    }else{
                        val file=withContext(Dispatchers.IO){
                            val info=resolver.query(uri,arrayOf(android.provider.OpenableColumns.DISPLAY_NAME,android.provider.OpenableColumns.SIZE),null,null,null)?.use{cursor->if(cursor.moveToFirst())Pair(cursor.getString(0)?:"视频",cursor.getLong(1))else null}?:throw IllegalStateException("无法读取视频信息")
                            api.nativeUploadFile({resolver.openInputStream(uri)?:throw IllegalStateException("无法读取视频")},mime,info.first,info.second)
                        }
                        if(chosen==selection)state=state.copy(uploads=state.uploads+file)
                    }
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){if(chosen==selection)error(nativeError(e))}
            finally{state=state.copy(uploading=false)}
        }
    }
    fun removeImage(id:String){state=state.copy(images=state.images.filter{it.id!=id})}
    fun uploadFiles(uris:List<Uri>){
        if(uris.isEmpty()||state.uploading)return
        if(state.uploads.size+uris.size>8){error("每条消息最多 8 个文件");return}
        val api=client?:return;val chosen=selection;state=state.copy(uploading=true)
        viewModelScope.launch{
            try{for(uri in uris){
                if(chosen!=selection)break
                val file=withContext(Dispatchers.IO){
                    val resolver=getApplication<Application>().contentResolver
                    val info=resolver.query(uri,arrayOf(android.provider.OpenableColumns.DISPLAY_NAME,android.provider.OpenableColumns.SIZE),null,null,null)?.use{cursor->
                        if(cursor.moveToFirst())Pair(cursor.getString(0)?:"附件",cursor.getLong(1))else null
                    }?:throw IllegalStateException("无法读取文件信息")
                    api.nativeUploadFile({resolver.openInputStream(uri)?:throw IllegalStateException("无法读取文件")},resolver.getType(uri)?:"application/octet-stream",info.first,info.second)
                }
                if(chosen==selection)state=state.copy(uploads=state.uploads+file)
            }}catch(e:CancellationException){throw e}catch(e:Exception){if(chosen==selection)error(nativeError(e))}
            finally{state=state.copy(uploading=false)}
        }
    }
    fun removeUpload(id:String){state=state.copy(uploads=state.uploads.filter{it.id!=id})}
    fun openUpload(file:NativeUploadedFile){
        work{
            val context=getApplication<Application>()
            val directory=java.io.File(context.cacheDir,"outputs").apply{mkdirs()}
            val safe=file.name.substringAfterLast('/').substringAfterLast('\\').replace(Regex("[^\\p{L}\\p{N}._ -]"),"_").take(120)
            val target=java.io.File(directory,"${UUID.randomUUID()}-$safe")
            val markdown=nativeIsMarkdownFile(file.name,file.mime)
            client!!.nativeDownload("/api/uploads/files/${file.id}",target,if(markdown)5L*1024*1024 else 100L*1024*1024)
            val content=if(markdown)target.readText(Charsets.UTF_8) else null
            if(markdown)target.delete()
            withContext(Dispatchers.Main){when{
                content!=null->state=state.copy(markdown=NativeMarkdownFile(file.name,file.name,content))
                file.mime=="application/pdf"->state=state.copy(pdf=NativePdf(target.absolutePath,file.name))
                else->nativeOpenDownloadedFile(context,target,file.mime)
            }}
        }
    }
    fun openOutput(href:String){
        if(href.startsWith("https://")||href.startsWith("http://")){getApplication<Application>().startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,Uri.parse(href)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK));return}
        val snapshot=state
        if(nativeIsMarkdownFile(href)){
            val name=Uri.decode(href.substringBefore('?').substringBefore('#')).substringAfterLast('/').substringAfterLast('\\').ifBlank{"文档.md"}
            work{
                val directory=java.io.File(getApplication<Application>().cacheDir,"markdown-previews").apply{mkdirs()}
                val file=java.io.File(directory,"${UUID.randomUUID()}.md")
                client!!.nativeDownload(nativeFileEndpoint(snapshot,href),file,5L*1024*1024)
                val content=file.readText(Charsets.UTF_8)
                file.delete()
                withContext(Dispatchers.Main){state=state.copy(markdown=NativeMarkdownFile(name,href,content))}
            }
            return
        }
        if(href.substringBefore('?').substringBefore('#').endsWith(".pdf",true)){
            val name=Uri.decode(href.substringBefore('?').substringBefore('#')).substringAfterLast('/').substringAfterLast('\\').ifBlank{"文档.pdf"}
            work{
                val directory=java.io.File(getApplication<Application>().cacheDir,"pdf-previews").apply{mkdirs()}
                directory.listFiles()?.filter{System.currentTimeMillis()-it.lastModified()>86400000}?.forEach{it.delete()}
                val file=java.io.File(directory,"${UUID.randomUUID()}.pdf")
                client!!.nativeDownload(nativeFileEndpoint(snapshot,href),file)
                withContext(Dispatchers.Main){state=state.copy(pdf=NativePdf(file.absolutePath,name))}
            }
            return
        }
        work{val bytes=client!!.nativeBytes(nativeFileEndpoint(snapshot,href));withContext(Dispatchers.Main){nativeShareFile(getApplication(),bytes,href)}}
    }
    fun closePdf(){state=state.copy(pdf=null)}
    fun closeMarkdown(){state=state.copy(markdown=null)}
    fun openImage(endpoint:String){work{val bytes=client!!.nativeBytes(endpoint);withContext(Dispatchers.Main){nativeShareFile(getApplication(),bytes,endpoint.substringAfterLast('/').substringBefore('?').ifBlank{"image.png"})}}}
    fun answerQuestions(id:String,answers:Map<String,String>){work{val values=JSONObject();answers.forEach{(key,value)->values.put(key,JSONObject().put("answers",org.json.JSONArray().put(value)))};client!!.nativeJson("POST","/api/approvals/$id/answer",JSONObject().put("threadId",state.threadId).put("answers",values));withContext(Dispatchers.Main){state=state.copy(approvals=state.approvals+id,pendingApprovals=state.pendingApprovals.filter{it.approvalId!=id})}}}
    fun approve(id:String,accept:Boolean){work{client!!.nativeApproval(id,if(accept)"accept" else "decline");withContext(Dispatchers.Main){state=state.copy(approvals=state.approvals+id,pendingApprovals=state.pendingApprovals.filter{it.approvalId!=id})}}}
    fun files(path:String=""){val project=state.projects.find{it.id==state.projectId}?:run{error("请先选择文件所属项目");return};work{val files=client!!.listFiles(project.id,path);withContext(Dispatchers.Main){state=state.copy(files=files,filePath=path,file=null)}}}
    fun readFile(file:FileEntry){if(file.kind=="directory"){files(file.path);return};if(file.path.endsWith(".pdf",true)){openOutput(file.path);return};work{val result=client!!.readFile(state.projectId,file.path);withContext(Dispatchers.Main){state=state.copy(file=result,markdown=if(nativeIsMarkdownFile(file.path))NativeMarkdownFile(file.name,file.path,result.content) else null)}}}
    fun saveFile(text:String){val file=state.file?:return;work{client!!.saveFile(state.projectId,file.path,text);withContext(Dispatchers.Main){state=state.copy(file=file.copy(content=text))}}}
    fun diff(){work{val result=client!!.readDiff(state.projectId);withContext(Dispatchers.Main){state=state.copy(diff=result.diff.ifBlank{"没有未提交的改动"})}}}
    fun terminal(text:String){work{val api=client!!;val session=state.terminalSession.ifBlank { api.startTerminalSession(state.projectId).sessionId };api.sendTerminalSessionInput(session,text);withContext(Dispatchers.Main){state=state.copy(terminalSession=session)}}}
    fun stopTerminal(){work{client!!.stopTerminalSession(state.terminalSession);withContext(Dispatchers.Main){state=state.copy(terminalSession="")}}}
    fun work(action:suspend ()->Unit){state=state.copy(workBusy=true);viewModelScope.launch(Dispatchers.IO){try{action()}catch(e:CancellationException){throw e}catch(e:Exception){withContext(Dispatchers.Main){state=state.copy(error=e.message.orEmpty(),sending=false)}}finally{withContext(Dispatchers.Main){state=state.copy(workBusy=false)}}}}
    override fun onCleared(){connection?.cancel();polling?.cancel()}
}

private fun nativeError(error:Exception):String=when(error){
    is java.net.ConnectException -> "无法连接电脑，请确认电脑控制台已打开，并使用同一网络。"
    is java.net.SocketTimeoutException -> "连接超时，请检查电脑地址和网络。"
    else -> if(error.message?.contains("401")==true)"配对已失效，请重新输入电脑上的配对码。" else error.message.orEmpty()
}

