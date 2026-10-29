package com.localcodex.control

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

private val requestSources=listOf("all" to "全部来源","codex" to "Codex","router" to "网关请求","agy" to "Antigravity","claude" to "Claude Code","zcode" to "ZCode","grok" to "Grok","hermes" to "Hermes","deepseek" to "DeepSeek","opencode" to "OpenCode")
private fun JSONObject.requestNumber(key:String):Double?=if(isNull(key))null else optDouble(key,Double.NaN).takeIf{it.isFinite()&&it>=0}
private fun requestNumber(value:Double?)=value?.let{nativeTokenCount(it.toLong())}?:"—"
private fun requestSeconds(value:Double?)=value?.let{String.format(Locale.ROOT,"%.2f 秒",it/1000)}?:"—"
private fun requestTier(value:String)=when(value){"fast","priority"->"Fast";"standard","default"->"标准";"ultrafast"->"Ultrafast";"","null"->"未记录";else->value}
private fun requestTiming(row:JSONObject)=when(row.optString("timingBasis")){
    "visible-text-estimate"->"可见文字流计时估算"
    "model-output-estimate"->"模型输出流计时估算，含推理"
    "native-recorded"->"原生记录耗时"
    "not-recorded"->"未记录"
    else->"输出 Token / 整个请求耗时"
}
private fun requestMoney(cost:JSONObject?):String{
    if(cost?.optString("basis")=="subscription_included")return "套餐内"
    val value=cost?.requestNumber("usd")?:return "—"
    return "$"+String.format(Locale.ROOT,if(value<.01)"%.6f" else "%.4f",value)
}

@Composable internal fun NativeRequestRecords(vm:NativeViewModel,back:()->Unit,tabs:@Composable ()->Unit){
    var range by rememberSaveable{mutableStateOf("week")}
    var source by rememberSaveable{mutableStateOf("all")}
    var purpose by rememberSaveable{mutableStateOf("all")}
    var pricing by rememberSaveable{mutableStateOf("codex")}
    var modelDraft by rememberSaveable{mutableStateOf("")}
    var model by rememberSaveable{mutableStateOf("")}
    var cursors by rememberSaveable{mutableStateOf(listOf(""))}
    var data by remember(vm,vm.state.address){mutableStateOf<JSONObject?>(null)}
    var error by remember{mutableStateOf("")}
    var loading by remember{mutableStateOf(false)}
    var revision by remember{mutableIntStateOf(0)}
    val owner=LocalLifecycleOwner.current
    var foreground by remember(owner){mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))}
    DisposableEffect(owner){val observer=LifecycleEventObserver{_,_->foreground=owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)};owner.lifecycle.addObserver(observer);onDispose{owner.lifecycle.removeObserver(observer)}}
    val connected=vm.state.connected
    val active=LocalManagementPageActive.current
    val route="/api/mobile-management/statistics/requests?"+android.net.Uri.Builder().appendQueryParameter("range",range).appendQueryParameter("source",source).appendQueryParameter("purpose",purpose).appendQueryParameter("pricing",pricing).appendQueryParameter("model",model.ifBlank{"all"}).appendQueryParameter("cursor",cursors.last()).build().encodedQuery
    LaunchedEffect(vm,vm.state.address,connected,active,foreground,route,revision){
        if(!connected||!active||!foreground){loading=false;return@LaunchedEffect}
        loading=true;error=""
        try{
            do{
                val response=vm.managementRequest(route);data=response
                if(!response.optBoolean("refreshing"))break
                delay(5000)
            }while(true)
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"请求记录读取失败"}finally{loading=false}
    }
    fun reset(){cursors=listOf("");data=null}
    fun search(){model=modelDraft.trim();reset();revision++}
    val rows=data?.optJSONArray("rows")?.let{array->(0 until array.length()).mapNotNull{array.optJSONObject(it)}}.orEmpty()
    val scroll=rememberNativeManagementListState()
    LaunchedEffect(cursors.last()){scroll.scrollToItem(0)}
    NativeManagementPage("详细统计","",back,actions={ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",{revision++},enabled=connected&&!loading)}){
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("requestRecords"),state=scroll,contentPadding=nativeManagementPadding(PaddingValues(16.dp)),verticalArrangement=Arrangement.spacedBy(10.dp)){
            item{tabs()}
            item{StatisticsTabStrip(listOf("today" to "今天","yesterday" to "昨天","week" to "本周","month" to "本月","year" to "今年"),range,{range=it;reset()})}
            item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                StatisticsPicker("来源",source,requestSources,{source=it;reset()},Modifier.weight(1f),connected)
                StatisticsPicker("请求类型",purpose,listOf("all" to "全部请求","normal" to "日常","warmup" to "预热","test" to "测试"),{purpose=it;reset()},Modifier.weight(1f),connected)
            }}
            item{OutlinedTextField(modelDraft,{modelDraft=it.take(300)},Modifier.fillMaxWidth(),label={Text("模型 ID")},placeholder={Text("留空查看全部模型")},singleLine=true,
                keyboardOptions=KeyboardOptions(imeAction=ImeAction.Search),keyboardActions=KeyboardActions(onSearch={search()}),
                trailingIcon={IconButton(onClick={search()},enabled=connected&&!loading){ModernIcon(R.drawable.ic_lucide_search,"查询模型",Modifier.size(18.dp))}})}
            item{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Row(Modifier.weight(1f),verticalAlignment=Alignment.CenterVertically){
                    Text("请求记录",fontWeight=FontWeight.SemiBold)
                    Box(Modifier.padding(start=8.dp).width(76.dp).height(20.dp),contentAlignment=Alignment.CenterStart){if(loading)NativeRunningTitle("正在读取",rememberNativeRunningPulse(true),fontSize=11.sp)}
                }
                if(source in listOf("all","codex","router"))StatisticsPicker("计价",pricing,listOf("codex" to "Codex","api" to "API 参考价"),{pricing=it;cursors=listOf("")},Modifier.width(128.dp),connected)
            }}
            if(error.isNotBlank())item{Text(error,color=MaterialTheme.colors.error,fontSize=13.sp)}
            if(!connected)item{Text("连接电脑后查看请求记录",fontSize=13.sp)}
            if(rows.isEmpty()&&!loading&&connected&&error.isBlank())item{Text("当前范围暂无请求记录",fontSize=13.sp)}
            items(rows,key={it.optString("id")}){RequestRecordCard(it)}
            item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
                TextButton(onClick={cursors=cursors.dropLast(1);data=null},enabled=!loading&&cursors.size>1){Text("上一页")}
                Text("第 ${cursors.size} 页",fontSize=12.sp)
                TextButton(onClick={data?.optString("nextCursor")?.takeIf{it.isNotBlank()&&it!="null"}?.let{cursors=cursors+it;data=null}},enabled=!loading&&data?.optBoolean("hasMore")==true){Text("下一页")}
            }}
        }
    }
}

@Composable internal fun RequestRecordCard(row:JSONObject){
    var expanded by remember(row.optString("id")){mutableStateOf(false)}
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.62f)
    val time=row.requestNumber("time")?.let{Instant.ofEpochMilli(it.toLong()).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM-dd HH:mm:ss",Locale.ROOT))}?:"—"
    val source=requestSources.find{it.first==row.optString("source")}?.second?:row.optString("source")
    val cost=row.optJSONObject("cost")
    DashboardCard(Modifier.fillMaxWidth().clickable{expanded=!expanded}){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Text(nativeCompactModelName(row.optString("model").takeUnless{it=="null"}.orEmpty().ifBlank{"模型未记录"},when(row.optString("source")){"router"->"codex";"agy"->"antigravity";else->row.optString("source")}),Modifier.weight(1f),fontWeight=FontWeight.SemiBold,fontSize=14.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
            Text(requestMoney(cost),Modifier.padding(start=8.dp),fontSize=14.sp)
            ModernIcon(if(expanded)R.drawable.ic_lucide_chevron_up else R.drawable.ic_lucide_chevron_down,if(expanded)"收起详情" else "展开详情",Modifier.padding(start=8.dp).size(16.dp),muted)
        }
        val nativeTier=row.optString("tierBasis")=="native-setting"
        val tier=row.optString("tier").takeUnless{it=="null"||it.isBlank()}
        Text("$time · $source"+when(row.optString("purpose")){"warmup"->" · 预热";"test"->" · 测试";else->""}+(tier?.let{" · "+requestTier(it)+(if(nativeTier)" · 会话设置" else "")}?:""),fontSize=11.sp,color=muted)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
            RequestMetric("Token",requestNumber(row.requestNumber("totalTokens")),Modifier.weight(1f))
            RequestMetric(if(row.optString("timingBasis").endsWith("estimate"))"Token/s · 估算" else if(row.optString("timingBasis")=="native-recorded")"平均 Token/s" else "全程 Token/s",row.requestNumber("averageTPS")?.let{String.format(Locale.ROOT,"%.1f",it)}?:"—",Modifier.weight(1f))
            RequestMetric("命中率",nativeCacheHitRate(row.requestNumber("inputTokens"),row.requestNumber("cachedTokens")),Modifier.weight(1f))
        }
        if(row.optBoolean("failed"))Text("请求失败"+row.optString("errorCode").takeUnless{it=="null"||it.isBlank()}.orEmpty().let{if(it.isBlank())"" else " · $it"},color=MaterialTheme.colors.error,fontSize=12.sp)
        if(row.optString("kind")=="aggregate")Text("汇总 ${row.optInt("requestCount")} 次",fontSize=11.sp,color=muted)
        if(expanded){
            Text((if(row.optString("timingBasis").endsWith("estimate"))"输出流时长 " else "耗时 ")+requestSeconds(row.requestNumber("durationMs")),fontSize=12.sp,color=muted)
            Text("输入 ${requestNumber(row.requestNumber("inputTokens"))} · 输出 ${requestNumber(row.requestNumber("outputTokens"))}\n缓存读取 ${requestNumber(row.requestNumber("cachedTokens"))} · 写入 ${requestNumber(row.requestNumber("cacheWriteTokens"))}\n推理 ${requestNumber(row.requestNumber("reasoningTokens"))}\n首字 ${requestSeconds(row.requestNumber("firstTextMs"))} · 首输出 ${requestSeconds(row.requestNumber("firstOutputMs"))}",fontSize=12.sp,color=muted)
            row.requestNumber("firstByteMs")?.let{Text("首字节 ${requestSeconds(it)}",fontSize=11.sp,color=muted)}
            row.requestNumber("afterFirstOutputMs")?.let{Text("首输出后耗时 ${requestSeconds(it)}",fontSize=11.sp,color=muted)}
            Text((if(nativeTier)"会话档位 " else "响应档位 ")+requestTier(tier.orEmpty())+" · 请求档位 "+requestTier(row.optString("requestedTier")),fontSize=11.sp,color=muted)
            Text(when(cost?.optString("basis")){"subscription_included"->"套餐内";"provider_reported","reported"->"供应商实报";"native"->"原生金额";"native_estimate"->"原生估算";else->if(cost?.requestNumber("usd")!=null)"参考估算" else "未计价"}+" · "+requestTiming(row),fontSize=11.sp,color=muted)
            if(row.optString("sessionId").let{it.isNotBlank()&&it!="null"})Text(row.optString("sessionId"),fontSize=10.sp,color=muted,maxLines=2,overflow=TextOverflow.Ellipsis)
        }
    }
}

@Composable private fun RequestMetric(label:String,value:String,modifier:Modifier=Modifier){
    Column(modifier,verticalArrangement=Arrangement.spacedBy(3.dp)){
        Text(value,fontSize=17.sp,fontWeight=FontWeight.Medium,maxLines=1,overflow=TextOverflow.Ellipsis)
        Text(label,fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.62f))
    }
}
