package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject

@Composable internal fun NativeSessionOverview(state:NativeState,canCompact:Boolean,onCompact:()->Unit){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.65f)
    val tokens=state.usage?.optJSONObject("tokens")
    val used=tokens?.takeUnless{it.isNull("context")}?.optLong("context")?:tokens?.takeUnless{it.isNull("last")}?.optLong("last")
    val capacity=tokens?.takeUnless{it.isNull("contextWindow")}?.optLong("contextWindow")?.takeIf{it>0}
    val thread=state.threads.find{it.id==state.threadId}
    val compacting=remember(state.events,state.threadId){nativeCompactionRunning(state.events,state.threadId)}
    var details by rememberSaveable(state.threadId){mutableStateOf(false)}
    DashboardCard(modifier=Modifier.testTag("sessionContextSection")){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text("上下文占用",fontSize=12.sp,color=muted)
                Text(if(used!=null&&capacity!=null)"${nativeContextCount(used)} / ${nativeContextCount(capacity)}" else if(state.usageLoading)"正在读取…" else "暂无记录",fontSize=22.sp,fontWeight=FontWeight.SemiBold)
            }
            if(state.harness=="codex")IconButton(onClick=onCompact,enabled=canCompact&&!compacting){Icon(painterResource(R.drawable.ic_lucide_minimize_2),"压缩上下文",Modifier.size(19.dp),tint=muted)}
        }
        if(compacting)StatusPulseText("正在压缩上下文",true,Modifier.testTag("sessionCompactionRunning"))
        if(used!=null&&capacity!=null)LinearProgressIndicator((used.toDouble()/capacity).toFloat().coerceIn(0f,1f),Modifier.fillMaxWidth().height(5.dp),color=MaterialTheme.colors.primary,backgroundColor=muted.copy(alpha=.1f))
        if(tokens?.optString("contextState")=="awaiting_usage")Text("压缩后统计待更新",fontSize=12.sp,color=muted)
        if(state.usageError.isNotBlank())Text(state.usageError,fontSize=12.sp,color=MaterialTheme.colors.error)
        Divider(color=muted.copy(alpha=.12f))
        NativeSessionUsage(tokens)
        TextButton(onClick={details=!details},modifier=Modifier.testTag("sessionDetailsToggle")){
            Text(if(details)"收起详细信息" else "详细信息",fontSize=12.sp)
            Icon(painterResource(if(details)R.drawable.ic_lucide_chevron_up else R.drawable.ic_lucide_chevron_right),null,Modifier.padding(start=4.dp).size(14.dp))
        }
        AnimatedVisibility(details){SelectionContainer{Column(Modifier.testTag("sessionDetails"),verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text(listOf(state.model,effortName(state.effort)).filter{it.isNotBlank()}.joinToString(" · "),fontSize=12.sp,color=muted)
            NativeSessionUsageDetails(tokens)
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text("ID",Modifier.padding(end=8.dp).testTag("sessionContextIdLabel"),fontSize=12.sp,color=muted)
                NativeSessionId(state.threadId,Modifier.weight(1f))
            }
            Text("目录",fontSize=12.sp,color=muted)
            Text(nativeDisplayPath(thread?.projectPath?:state.projects.find{it.id==state.projectId}?.path?:"未选择项目"),fontSize=12.sp,lineHeight=18.sp)
        }}}
    }
}

@Composable internal fun NativeSessionUsage(tokens:JSONObject?){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.65f)
    Column(Modifier.fillMaxWidth().testTag("sessionUsageSection"),verticalArrangement=Arrangement.spacedBy(16.dp)){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Text("本会话用量",Modifier.weight(1f),fontSize=14.sp,fontWeight=FontWeight.Medium)
            Column(horizontalAlignment=Alignment.End,verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text("总 Token",fontSize=11.sp,color=muted)
                Text(if(tokens==null||tokens.isNull("total"))"—" else nativeTokenCount(tokens.optLong("total")),Modifier.testTag("usageToken:total"),fontSize=24.sp,fontWeight=FontWeight.SemiBold)
            }
        }
        if(tokens==null)Text("暂无 Token 记录",fontSize=13.sp,color=muted)
        else{
            val input=tokens.optLong("input");val cached=tokens.optLong("cached")
            val hit=if(!tokens.isNull("input")&&!tokens.isNull("cached")&&input>0)
                String.format(java.util.Locale.ROOT,"%.1f%%",cached.toDouble()/input*100) else "—"
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(24.dp),verticalAlignment=Alignment.CenterVertically){
                Column(Modifier.weight(1.2f),verticalArrangement=Arrangement.spacedBy(10.dp)){
                    listOf("input" to "输入","output" to "输出","cached" to "缓存命中").forEach{(key,label)->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        Text(label,Modifier.weight(1f),fontSize=11.sp,color=muted)
                        Text(if(tokens.isNull(key))"—" else nativeTokenCount(tokens.optLong(key)),Modifier.testTag("usageToken:$key"),fontSize=13.sp,fontWeight=FontWeight.Medium)
                    }}
                }
                Column(Modifier.weight(1f),horizontalAlignment=Alignment.End,verticalArrangement=Arrangement.spacedBy(6.dp)){
                    Text("缓存命中率",fontSize=11.sp,color=muted)
                    Text(hit,Modifier.testTag("usageToken:hit"),fontSize=26.sp,fontWeight=FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable private fun NativeSessionUsageDetails(tokens:JSONObject?){
    if(tokens==null)return
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.65f)
    listOf("last" to "最近一次请求","reasoning" to "推理输出").forEach{(key,label)->
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
            Text(label,Modifier.weight(1f),fontSize=12.sp,color=muted)
            Text(if(tokens.isNull(key))"—" else nativeTokenCount(tokens.optLong(key)),Modifier.testTag("usageToken:$key"),fontSize=13.sp)
        }
    }
    Text("缓存计入输入，推理计入输出；累计量包含压缩前的请求。",fontSize=11.sp,color=muted)
}
