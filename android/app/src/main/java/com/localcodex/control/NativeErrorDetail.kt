package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.material.TextButton
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.dp

internal fun nativeErrorDetail(event:ChatEvent)=event.detail.ifBlank{event.text}
internal fun nativeErrorSummary(detail:String):String=when {
    detail.contains("Unable to resolve host",true)||detail.contains("UnknownHost",true)||detail.contains("No address associated with hostname",true)->"电脑地址暂时无法解析"
    detail.contains("at capacity",true)||detail.contains("overloaded",true)||detail.contains("Start Plan is busy",true)||detail.contains("startPlanBusyAutoRetryExhausted",true)->"模型当前繁忙"
    detail.contains("timeout",true)||detail.contains("timed out",true)||detail.contains("超时")->"连接超时"
    // The Codex app-server reports a cancelled or restarted turn as "terminated";
    // it is not a network error and the generic fallback hid the real reason.
    detail.contains("turn failed: terminated",true)||detail.contains("terminated",true)&&detail.contains("turn",true)->"本轮在电脑端结束，未产生完整答复"
    detail.contains("stream disconnected",true)||detail.contains("Transport error",true)||detail.contains("connection reset",true)||detail.contains("broken pipe",true)->"连接已中断"
    detail.contains("401")||detail.contains("unauthorized",true)->"连接授权已失效"
    detail.contains("failed to connect",true)||detail.contains("connection refused",true)->"暂时无法连接电脑"
    else->detail.lineSequence().map{it.trim()}.firstOrNull{it.isNotBlank()&&!it.startsWith("{")&&!it.startsWith("错误类型")&&!it.startsWith("Reconnecting",true)}
        ?.takeIf{line->line.any{it in '\u4e00'..'\u9fff'}}?.take(100)
        // No Chinese line: keep the upstream reason instead of hiding it behind
        // the generic "请求未完成".
        ?:detail.lineSequence().map{it.trim()}.firstOrNull{it.isNotBlank()&&!it.startsWith("{")}?.take(120)
        ?:"请求未完成"
}
private val retryCountPattern=Regex("(?:Reconnecting|Retrying|重新连接|重试)[^\\r\\n]{0,24}?(\\d+\\s*/\\s*\\d+)",RegexOption.IGNORE_CASE)
internal fun nativeErrorRetryCount(detail:String)=retryCountPattern.findAll(detail).lastOrNull()?.groupValues?.get(1).orEmpty().replace(" ","")

@Composable internal fun NativeErrorDetail(event:ChatEvent){
    val clipboard=LocalClipboardManager.current
    val detail=nativeErrorDetail(event)
    val summary=remember(detail,event.title){nativeErrorSummary(detail.ifBlank{event.title})}
    val attempts=remember(detail){nativeErrorRetryCount(detail)}
    var expanded by remember(event.threadId,event.eventId){mutableStateOf(false)}
    Column{
        Row(verticalAlignment=Alignment.CenterVertically){
            Text(summary,Modifier.weight(1f),fontSize=14.sp,lineHeight=20.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
            if(attempts.isNotBlank())Text(attempts,Modifier.padding(start=12.dp),fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.64f))
        }
        if(detail.isNotBlank()&&detail.trim()!=summary.trim()){
            Row(horizontalArrangement=Arrangement.spacedBy(4.dp)){
                TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起详情" else "查看详情",fontSize=12.sp)}
                TextButton(onClick={clipboard.setText(AnnotatedString(detail))}){Text("复制详情",fontSize=12.sp)}
            }
            if(expanded)SelectionContainer(Modifier.fillMaxWidth().heightIn(max=240.dp).verticalScroll(rememberScrollState())){
                Text(detail,fontSize=12.sp,lineHeight=18.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.72f))
            }
        }
    }
}
