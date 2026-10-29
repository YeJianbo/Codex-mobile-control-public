package com.localcodex.control

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

private fun NativePerformanceStage.label()=when(this){
    NativePerformanceStage.RESUME->"回到前台"
    NativePerformanceStage.SOCKET_VERIFIED->"连接验活"
    NativePerformanceStage.SOCKET_OPEN->"实时连接建立"
    NativePerformanceStage.HISTORY_READY->"会话历史就绪"
    NativePerformanceStage.SEND_READY->"发送按钮可用"
}
private fun NativeComposerGate.label()=when(this){
    NativeComposerGate.READY->"可以发送"
    NativeComposerGate.STOP->"可以停止任务"
    NativeComposerGate.CONNECTION->"等待连接"
    NativeComposerGate.SENDING->"正在提交"
    NativeComposerGate.UPLOADING->"正在上传"
    NativeComposerGate.STOPPING->"正在停止"
    NativeComposerGate.EMPTY->"输入为空"
    NativeComposerGate.MODEL->"等待可用模型"
}

@Composable internal fun RecordNativeComposerState(gate:NativeComposerGate,foreground:Boolean){
    val state by NativePerformanceRecorder.state.collectAsState()
    LaunchedEffect(gate,foreground,state.recording){
        if(foreground&&state.recording)NativePerformanceRecorder.session.composer(gate)
    }
}

internal fun nativePerformanceJson(report:NativePerformanceReport,before:JSONObject?,after:JSONObject?):String=JSONObject()
    .put("version",1).put("appVersion",BuildConfig.VERSION_NAME).put("deviceModel",android.os.Build.MODEL).put("androidApi",android.os.Build.VERSION.SDK_INT)
    .put("elapsedMs",report.elapsedMs).put("frameMetrics",JSONObject().put("frames",report.frames).put("dialogFrames",report.dialogFrames).put("overBudgetFrames",report.overBudgetFrames)
        .put("droppedSamples",report.droppedSamples).put("retainedSamples",report.retainedFrameSamples)
        .put("p50Ms",report.p50Ms).put("p95Ms",report.p95Ms).put("p99Ms",report.p99Ms).put("maxMs",report.maxMs))
    .put("marks",JSONArray().apply{report.marks.forEach{put(JSONObject().put("cycle",it.cycle).put("stage",it.stage.name.lowercase()).put("atMs",it.atMs))}})
    .put("composer",JSONArray().apply{report.composer.forEach{put(JSONObject().put("cycle",it.cycle).put("state",it.gate.name.lowercase()).put("atMs",it.atMs))}})
    .put("network",JSONArray().apply{report.network.forEach{put(JSONObject().put("operation",it.operation.name.lowercase()).put("route",it.route.name.lowercase())
        .put("atMs",it.atMs).put("durationMs",it.durationMs).put("dnsMs",it.dnsMs).put("connectMs",it.connectMs).put("tlsMs",it.tlsMs)
        .put("firstByteMs",it.firstByteMs?:JSONObject.NULL).put("status",it.status?:JSONObject.NULL).put("error",it.error?:JSONObject.NULL))}})
    .put("gatewayBefore",before?:JSONObject.NULL).put("gatewayAfter",after?:JSONObject.NULL).toString(2)

@Composable internal fun NativePerformancePanel(vm:NativeViewModel){
    val state by NativePerformanceRecorder.state.collectAsState()
    val context=LocalContext.current
    val scope=rememberCoroutineScope()
    var error by remember{mutableStateOf("")}
    var export by remember{mutableStateOf<String?>(null)}
    val currentExport by rememberUpdatedState(export)
    val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")){uri->
        val content=currentExport
        if(uri!=null&&content!=null)scope.launch{
            try{withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.use{it.write(content.toByteArray(Charsets.UTF_8))}?:throw IllegalStateException("无法打开保存位置")}}
            catch(e:CancellationException){throw e}catch(_:Exception){error="无法保存性能记录"}
        }
    }
    LaunchedEffect(state.report?.session){
        val report=state.report
        if(report!=null&&state.gatewayAfter==null){
            try{NativePerformanceRecorder.gatewaySnapshot(report.session,vm.gatewayPerformanceSnapshot()?.toString(),before=false)}
            catch(e:CancellationException){throw e}catch(_:Exception){error="网关摘要暂不可用，本机记录仍可使用"}
        }
    }
    NativePerformanceContent(state,error,onToggle={
        error="";if(state.recording)NativePerformanceRecorder.stop() else vm.startPerformanceRecording()
    },onSave={
        state.report?.let{report->
            export=nativePerformanceJson(report,state.gatewayBefore?.let(::JSONObject),state.gatewayAfter?.let(::JSONObject));save.launch("mobile-performance.json")
        }
    })
}

@Composable private fun NativePerformanceContent(state:NativePerformanceState,error:String,onToggle:()->Unit,onSave:()->Unit){
    val gateway=remember(state.gatewayAfter){state.gatewayAfter?.let(::JSONObject)}
    DashboardCard{
        Text("性能记录",fontWeight=FontWeight.SemiBold)
        Text(if(state.recording)"正在记录，60 秒后自动结束。返回聊天可复现滚动、弹层或后台切回。" else "记录界面帧耗时和连接恢复阶段，可在本机查看或保存 JSON。",fontSize=12.sp)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            OutlinedButton(onClick=onToggle,enabled=!state.finishing,modifier=Modifier.testTag("performanceRecord")){
                Text(if(state.finishing)"整理中…" else if(state.recording)"结束并查看" else "记录 60 秒")
            }
            if(state.report!=null)TextButton(onClick=onSave){Text("保存记录")}
        }
        state.report?.let{report->
            Text(String.format(Locale.ROOT,"%d 帧 · P95 %.1f ms · 超预算 %d 帧",report.frames,report.p95Ms,report.overBudgetFrames),fontSize=13.sp)
            if(report.dialogFrames>0)Text("含弹窗 ${report.dialogFrames} 帧",fontSize=12.sp)
            if(report.droppedSamples>0)Text("采样回调丢失 ${report.droppedSamples} 次",fontSize=12.sp)
            val cycle=report.marks.lastOrNull()?.cycle
            val marks=report.marks.filter{it.cycle==cycle}
            val origin=marks.firstOrNull{it.stage==NativePerformanceStage.RESUME}?.atMs?:0L
            marks.forEach{Text("${it.stage.label()} · ${it.atMs-origin} ms",fontSize=12.sp)}
            report.composer.lastOrNull()?.let{Text("发送状态：${it.gate.label()}",fontSize=12.sp)}
            gateway?.optJSONObject("history")?.let{history->
                Text("历史读取：合并 ${history.optLong("deduplicated")} 次 · 最长排队 ${history.optLong("maxQueueMs")} ms",fontSize=12.sp)
            }
        }
        if(error.isNotBlank())Text(error,fontSize=12.sp,color=MaterialTheme.colors.error)
    }
}
