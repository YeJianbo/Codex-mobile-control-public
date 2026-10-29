package com.localcodex.control

import androidx.compose.runtime.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import android.content.ContentResolver
import android.net.Uri

internal data class NativeSideChatState(
    val parentId:String="",val threadId:String="",val visible:Boolean=false,val busy:Boolean=false,
    val connected:Boolean=false,val running:Boolean=false,val draft:String="",val error:String="",val pending:Boolean=false,
    val events:List<ChatEvent> = emptyList(),val answers:Map<String,Map<String,String>> = emptyMap(),
    val model:String="",val effort:String="",val permission:String="full",
    val images:List<NativeImage> = emptyList(),val uploads:List<NativeUploadedFile> = emptyList(),
    val uploading:Boolean=false,val uploadMessage:String="",val uploadProgress:NativeUploadProgress?=null,
    val loadingHistory:Boolean=false,val stopping:Boolean=false,
)

/** Each parent owns its draft, submission receipt and focused reader. */
internal class NativeSideChats(private val scope:CoroutineScope,private val gateway:()->GatewayClient){
    private val sessions=mutableMapOf<String,NativeSideChatController>()
    var current by mutableStateOf<NativeSideChatController?>(null);private set
    val state:NativeSideChatState get()=current?.state?:NativeSideChatState()
    fun open(parentId:String,model:String="",effort:String="",permission:String="full"){
        if(parentId.isBlank())return
        val next=sessions.getOrPut(parentId){NativeSideChatController(scope,gateway).also{it.configure(model,effort,permission)}}
        if(current!==next)current?.minimize()
        current=next
        if(next.state.threadId.isBlank()&&!next.state.busy)next.configure(model,effort,permission)
        next.open(parentId)
    }
    fun minimize(){current?.minimize()}
    fun uploadDraftRefs():List<JSONObject> = sessions.values.flatMap{session->
        session.state.images.map{JSONObject().put("kind","image").put("id",it.id)}+
            session.state.uploads.map{JSONObject().put("kind","file").put("id",it.id)}
    }
    fun setForeground(value:Boolean){sessions.values.forEach{it.setForeground(value)}}
    fun clear(){sessions.values.forEach{it.clear()};sessions.clear();current=null}
}

/** One focused event stream; no sidebar scans, model polling or duplicate notification service. */
internal class NativeSideChatController(private val scope:CoroutineScope,private val gateway:()->GatewayClient){
    var state by mutableStateOf(NativeSideChatState());private set
    private var reader:Job?=null
    private var api:GatewayClient?=null
    private var generation=0
    private var readerOwner:Any?=null
    private var foreground=true
    private var pendingId=""
    private var pendingText=""
    private var pendingImages:List<NativeImage> = emptyList()
    private var pendingFiles:List<NativeUploadedFile> = emptyList()
    private var upload:Job?=null
    private var uploadTicket=0
    private var lifecycleRevision=0L
    private var activeTurnId=""
    private var stopRequestId=""
    private var stopCheck:Job?=null
    fun configure(model:String,effort:String,permission:String){state=state.copy(model=model,effort=effort,permission=permission)}
    fun chooseModel(model:NativeModel){state=state.copy(model=model.id,effort=state.effort.takeIf{it in model.efforts}?:model.defaultEffort)}
    fun effort(value:String){state=state.copy(effort=value)}
    fun open(parentId:String){
        if(state.busy){if(state.parentId==parentId)state=state.copy(visible=true);return}
        if(state.threadId.isNotBlank()){
            check(state.parentId==parentId){"侧聊与主会话不匹配"}
            state=state.copy(visible=true,error="")
            if(reader?.isActive!=true)watch()
            return
        }
        state=state.copy(parentId=parentId,visible=true,busy=true,error="")
        val epoch=++generation
        scope.launch{
            try{
                val source=gateway()
                val result=source.nativeJsonAsync("POST","/api/threads/$parentId/fork",JSONObject().put("ephemeral",true))
                if(epoch!=generation){source.nativeJsonAsync("POST","/api/threads/${result.getJSONObject("thread").getString("id")}/side/close",JSONObject());return@launch}
                state=state.copy(threadId=result.getJSONObject("thread").getString("id"),busy=false)
                watch()
            }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation)state=state.copy(busy=false,error=e.message.orEmpty())}
        }
    }
    fun minimize(){finishStop();state=state.copy(visible=false,connected=false);reader?.cancel();api=null}
    fun setForeground(value:Boolean){foreground=value;if(value&&state.visible&&state.threadId.isNotBlank()&&reader?.isActive!=true)watch() else if(!value){finishStop();reader?.cancel()}}
    fun draft(value:String){state=state.copy(draft=value)}
    fun pickerFailed(message:String="无法打开文件选择器"){state=state.copy(error=message)}
    fun answer(id:String,key:String,value:String){state=state.copy(answers=state.answers+(id to (state.answers[id].orEmpty()+(key to value))))}
    fun clear(){generation++;readerOwner=null;reader?.cancel();reader=null;upload?.cancel();upload=null;stopCheck?.cancel();stopCheck=null;stopRequestId="";activeTurnId="";lifecycleRevision++;api=null;pendingId="";pendingText="";pendingImages=emptyList();pendingFiles=emptyList();state=NativeSideChatState()}
    fun retry(){if(state.threadId.isBlank())open(state.parentId) else {val stream=api;if(stream==null)watch() else scope.launch{snapshot(stream,state.threadId)}}}
    fun close(){
        if(state.busy||state.threadId.isBlank())return
        val id=state.threadId;val epoch=generation;state=state.copy(busy=true,error="")
        scope.launch{
            try{gateway().nativeJsonAsync("POST","/api/threads/$id/side/close",JSONObject());if(epoch==generation)clear()}
            catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation)state=state.copy(busy=false,error=e.message.orEmpty())}
        }
    }
    private fun watch(){
        if(!foreground||!state.visible)return
        reader?.cancel()
        val id=state.threadId
        val owner=Any();readerOwner=owner
        reader=scope.launch{
            var attempts=0
            while(isActive&&state.threadId==id&&readerOwner===owner){
                try{
                    val stream=gateway().forkEventClient();api=stream
                    stream.events(streamThreadId=id,discardPendingOnClose=true,traceLabel="side").collect{event->
                        if(readerOwner!==owner)return@collect
                        if(event.type=="connection.opened"){
                            state=state.copy(connected=true,error="");attempts=0
                            launch{snapshot(stream,id)}
                        }else if(event.threadId==id||(pendingId.isNotBlank()&&event.requestId==pendingId))accept(event)
                    }
                }catch(e:CancellationException){throw e}catch(e:Exception){if(readerOwner===owner)state=state.copy(error=e.message.orEmpty())}
                finally{if(readerOwner===owner){finishStop();state=state.copy(connected=false);api=null}}
                delay((++attempts*500L).coerceAtMost(10000L))
            }
        }
    }
    private suspend fun snapshot(stream:GatewayClient,id:String){
        if(state.threadId!=id||api!==stream)return
        val revision=lifecycleRevision
        state=state.copy(loadingHistory=true)
        try{
            val history=stream.nativeHistoryAsync(id,1000)
            if(state.threadId!=id||api!==stream)return
            val events=reconcileNativeHistory(state.events,history.first,false).filterNot(::idleStopError)
            // The server snapshot owns recovered status; newer live lifecycle events win a race.
            val running=if(revision==lifecycleRevision)history.second=="running" else state.running
            if(revision==lifecycleRevision)activeTurnId=if(running)events.lastOrNull{it.type=="turn.started"}?.turnId.orEmpty() else ""
            if(!running)finishStop()
            state=state.copy(events=events,running=running,error=state.error.takeUnless(::idleStopMessage).orEmpty())
            if(pendingId.isNotBlank()){
                val submission=stream.nativeJsonAsync("GET","/api/threads/$id/submission?requestId=$pendingId").optJSONObject("submission")
                if(state.threadId!=id||api!==stream)return
                when(submission?.optString("state")){
                    "accepted"->accepted()
                    "failed"->{state=state.copy(busy=false,pending=false);resetPending()}
                    else->state=state.copy(busy=false,error="消息提交状态尚未确认，文字已保留，可点击核对状态")
                }
            }
        }catch(e:CancellationException){throw e}catch(e:Exception){if(state.threadId==id&&api===stream)state=state.copy(error=e.message.orEmpty())}
        finally{if(state.threadId==id&&api===stream)state=state.copy(loadingHistory=false)}
    }
    private fun accepted(){
        if(state.draft==pendingText)state=state.copy(draft="")
        state=state.copy(images=state.images.filterNot{image->pendingImages.any{it.id==image.id}},
            uploads=state.uploads.filterNot{file->pendingFiles.any{it.id==file.id}},busy=false,pending=false,error="")
        resetPending()
    }
    private fun resetPending(){pendingId="";pendingText="";pendingImages=emptyList();pendingFiles=emptyList()}
    private fun idleStopMessage(text:String)=text.contains("当前会话没有正在运行的任务")||text.contains("当前没有运行中的任务")
    private fun idleStopError(event:ChatEvent)=event.type=="error"&&idleStopMessage(event.detail.ifBlank{event.text})
    private fun finishStop(){stopRequestId="";stopCheck?.cancel();stopCheck=null;state=state.copy(stopping=false)}
    private fun accept(event:ChatEvent){
        if(event.type=="command.accepted"&&event.requestId==pendingId){accepted();return}
        if(event.eventId.isNotBlank()&&state.events.any{it.eventId==event.eventId})return
        if(idleStopError(event)){
            if(event.requestId.isBlank()||event.requestId==stopRequestId){
                lifecycleRevision++;activeTurnId="";finishStop();state=state.copy(running=false,error="")
            }
            state=state.copy(events=state.events.filterNot(::idleStopError));return
        }
        if(!event.replayed&&event.type=="turn.started"){lifecycleRevision++;activeTurnId=event.turnId;state=state.copy(running=true,error="")}
        if(!event.replayed&&event.type=="turn.completed"&&(event.turnId.isBlank()||activeTurnId.isBlank()||event.turnId==activeTurnId)){
            lifecycleRevision++;activeTurnId="";finishStop();state=state.copy(running=false,busy=false,error="")
        }
        if(event.type=="error"&&!event.willRetry){
            if(event.requestId.isNotBlank()){
                if(event.requestId==stopRequestId)finishStop()
                if(event.requestId==pendingId){resetPending();state=state.copy(pending=false)}
                state=state.copy(error=event.detail.ifBlank{event.text},busy=false);return
            }
            // Execution errors belong to the transcript; action errors belong to one status card.
            state=state.copy(busy=false)
        }
        state=state.copy(events=retainNativeConversationEvents(state.events+event,1000))
    }
    fun send(){
        if(!state.connected||state.busy||state.pending||state.running||state.uploading||state.draft.isBlank()&&state.images.isEmpty()&&state.uploads.isEmpty())return
        pendingId=UUID.randomUUID().toString();pendingText=state.draft;pendingImages=state.images;pendingFiles=state.uploads
        state=state.copy(busy=false,pending=true,error="")
        val command=api?.nativeCommand(state.threadId,null,null,pendingText,state.model,state.effort,state.permission,pendingId,pendingImages,pendingFiles)
        if(command==null||api?.sendSocketMessage(command)!=true){
            resetPending();state=state.copy(busy=false,pending=false,error="连接已断开，消息尚未发送")
        }
    }
    fun removeImage(id:String){if(!state.pending)state=state.copy(images=state.images.filterNot{it.id==id})}
    fun removeFile(id:String){if(!state.pending)state=state.copy(uploads=state.uploads.filterNot{it.id==id})}
    fun cancelUpload(){uploadTicket++;upload?.cancel();upload=null;state=state.copy(uploading=false,uploadMessage="",uploadProgress=null)}
    fun upload(resolver:ContentResolver,uris:List<Uri>,media:Boolean,onFinished:()->Unit={}){
        if(uris.isEmpty()||state.uploading||state.pending||state.busy){onFinished();return}
        val epoch=generation;val ticket=++uploadTicket
        state=state.copy(uploading=true,error="")
        upload=scope.launch{
            try{
                val source=gateway()
                for((index,uri) in uris.withIndex()){
                    ensureActive()
                    state=state.copy(uploadMessage="正在上传 ${index+1}/${uris.size}",uploadProgress=null)
                    val fileCount=state.uploads.size
                    val progress:(NativeUploadProgress)->Unit={value->scope.launch{if(epoch==generation&&ticket==uploadTicket&&state.uploading)state=state.copy(uploadProgress=value)}}
                    val result=withContext(Dispatchers.IO){
                        val mime=resolver.getType(uri).orEmpty()
                        if(media&&mime.startsWith("image/")){
                            val bytes=resolver.openInputStream(uri)?.use{input->
                                val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
                                while(true){ensureActive();val n=input.read(buffer);if(n<0)break;require(output.size()+n<=NativePickedImageLimit){"原图片不能超过 20 MB"};output.write(buffer,0,n)}
                                output.toByteArray()
                            }?:error("无法读取图片")
                            source.nativeUpload(bytes,mime,"图片",progress)
                        }else{
                            require(fileCount<8){"每条消息最多 8 个文件或视频"}
                            val info=nativePickedFileInfo(resolver,uri,"附件")
                            source.nativeUploadFile({resolver.openInputStream(uri)?:error("无法读取文件")},mime.ifBlank{"application/octet-stream"},info.first,info.second,progress)
                        }
                    }
                    if(epoch!=generation||ticket!=uploadTicket)return@launch
                    when(result){is NativeImage->state=state.copy(images=state.images+result);is NativeUploadedFile->state=state.copy(uploads=state.uploads+result)}
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation&&ticket==uploadTicket)state=state.copy(error=e.message.orEmpty())}
            finally{if(epoch==generation&&ticket==uploadTicket)state=state.copy(uploading=false,uploadMessage="",uploadProgress=null)}
        }.also{it.invokeOnCompletion{onFinished()}}
    }
    fun stop(){
        if(!state.running||state.stopping)return
        val stream=api?:run{state=state.copy(error="连接尚未恢复");return}
        val id=state.threadId;val request=UUID.randomUUID().toString()
        stopRequestId=request;state=state.copy(stopping=true,error="")
        if(!stream.interruptTurn(id,request)){finishStop();state=state.copy(error="连接尚未恢复");return}
        stopCheck=scope.launch{
            delay(1500)
            if(stopRequestId!=request||api!==stream||state.threadId!=id)return@launch
            snapshot(stream,id)
            if(stopRequestId==request){finishStop();state=state.copy(error="停止结果尚未确认，请核对状态后重试")}
        }
    }
    fun approve(id:String,approved:Boolean){
        val event=state.events.lastOrNull{it.approvalId==id}?:return
        val epoch=generation;val source=gateway()
        scope.launch{
            try{withContext(Dispatchers.IO){source.nativeApproval(id,if(approved)"accept" else "decline")};if(epoch==generation)accept(ChatEvent(type="approval.resolved",threadId=event.threadId,approvalId=id))}
            catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation)state=state.copy(error=e.message.orEmpty())}
        }
    }
    fun submitAnswers(id:String){
        val values=JSONObject();state.answers[id].orEmpty().forEach{(key,value)->values.put(key,JSONObject().put("answers",JSONArray().put(value)))}
        val epoch=generation;val thread=state.threadId;val source=gateway()
        scope.launch{
            try{
                source.nativeJsonAsync("POST","/api/approvals/$id/answer",JSONObject().put("threadId",thread).put("answers",values))
                if(epoch==generation)accept(ChatEvent(type="approval.resolved",threadId=thread,approvalId=id))
            }catch(e:CancellationException){throw e}catch(e:Exception){if(epoch==generation)state=state.copy(error=e.message.orEmpty())}
        }
    }
}
