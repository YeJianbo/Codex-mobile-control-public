package com.localcodex.control
import com.localcodex.control.NativeThemeSurface as Surface

import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.roundToInt

private val detailTabs=listOf("tokens" to "Token","requests" to "请求","speed" to "速度","activity" to "活跃","sessions" to "会话","tools" to "工具","skills" to "Skills","changes" to "改动","quota" to "配额")
private val detailSources=listOf("all" to "全部来源","codex" to "Codex","agy" to "Antigravity","claude" to "Claude Code","zcode" to "ZCode","grok" to "Grok","hermes" to "Hermes","deepseek" to "DeepSeek","opencode" to "OpenCode")
private val detailRanges=listOf("today" to "今天","yesterday" to "昨天","week" to "本周","month" to "本月","year" to "今年","custom" to "时间段")
private val detailMuted:Color @Composable get()=MaterialTheme.colors.onSurface.copy(alpha=.62f)
private val detailDivider:Color @Composable get()=MaterialTheme.colors.onSurface.copy(alpha=.07f)
private const val statisticsRoot="/api/mobile-management/statistics/"
private val minuteFormat=DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm",Locale.ROOT)

private data class StatisticsSelection(
    val tab:String="tokens",val range:String="week",val source:String="all",val model:String="all",val tier:String="all",val effort:String="all",val pricing:String="codex",
    val speedSource:String="native",val speedModel:String="all",val provider:String="all",val account:String="",val days:String="7",
    val from:String=LocalDate.now().minusDays(6).atStartOfDay().format(minuteFormat),val to:String=LocalDateTime.now().format(minuteFormat),
){
    fun route():String{
        val path=when(tab){"tokens"->"tokens";"speed"->"speed";"quota"->"quota";else->"activity"}
        val effectiveRange=if(tab=="activity")"year" else range
        val query=Uri.Builder()
        if(tab!="quota"||effectiveRange!="rolling")query.appendQueryParameter("range",effectiveRange)
        if(effectiveRange=="custom")query.appendQueryParameter("from",from).appendQueryParameter("to",to)
        when(tab){
            "tokens"->{query.appendQueryParameter("source",source).appendQueryParameter("pricing",pricing);if(source=="codex")query.appendQueryParameter("model",model).appendQueryParameter("tier",tier).appendQueryParameter("effort",effort)}
            "speed"->{query.appendQueryParameter("source",speedSource).appendQueryParameter("model",speedModel);if(speedSource=="router")query.appendQueryParameter("provider",provider)}
            "quota"->{query.appendQueryParameter("days",days);if(account.isNotBlank())query.appendQueryParameter("account",account)}
            else->query.appendQueryParameter("view",tab).appendQueryParameter("source",if(tab=="activity")source else "codex")
        }
        return statisticsRoot+path+"?"+query.build().encodedQuery
    }
}
private val statisticsSelectionSaver=listSaver<StatisticsSelection,String>(
    save={listOf(it.tab,it.range,it.source,it.model,it.tier,it.effort,it.pricing,it.speedSource,it.speedModel,it.provider,it.account,it.days,it.from,it.to)},
    restore={StatisticsSelection(it[0],it[1],it[2],it[3],it[4],it[5],it[6],it[7],it[8],it[9],it[10],it[11],it[12],it[13])},
)
private data class StatisticsPageState(val data:JSONObject?=null,val dataRequest:String="",val loading:Boolean=false,val busy:String="",val error:String="",val message:String="",val accounts:List<Pair<String,String>> = emptyList(),val accountsError:String="")
// Pricing changes leave token counts, filters and chart geometry unchanged.
private fun statisticsContentKey(request:String):String{
    val uri=Uri.parse(request)
    val builder=uri.buildUpon().clearQuery()
    uri.queryParameterNames.filter{it!="pricing"}.sorted().forEach{name->uri.getQueryParameters(name).forEach{builder.appendQueryParameter(name,it)}}
    return builder.build().toString()
}
private val LocalStatisticsFeedback=staticCompositionLocalOf<StatisticsPageState?>{null}
private fun JSONObject.detailRows(key:String):List<JSONObject>{val array=optJSONArray(key)?:return emptyList();return (0 until array.length()).mapNotNull{array.optJSONObject(it)}}
private fun JSONObject.detailText(key:String)=if(isNull(key))"" else optString(key)
private fun JSONObject.detailNumber(key:String):Double?=if(isNull(key))null else optDouble(key,Double.NaN).takeIf{it.isFinite()&&it>=0}
private fun detailCount(value:Double?)=value?.let{nativeTokenCount(it.toLong())}?:"—"
private fun detailRate(value:Double?)=value?.let{String.format(Locale.ROOT,"%.1f Token/s",it)}?:"—"
private fun detailDuration(value:Double?)=value?.let{String.format(Locale.ROOT,"%.2f s",it/1000)}?:"—"
private fun detailPercent(value:Double?)=value?.let{String.format(Locale.ROOT,"%.1f%%",it)}?:"—"
private fun detailDate(value:Double?,seconds:Boolean=false):String=value?.let{runCatching{Instant.ofEpochMilli((it*(if(seconds)1000 else 1)).toLong()).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("M月d日 HH:mm",Locale.ROOT))}.getOrNull()}?:"—"
private fun detailError(error:Exception)=if(error is LocalConsoleRequestException&&error.status==404)"电脑网关需要更新后才能查看详细统计" else error.message?.take(300).orEmpty().ifBlank{"统计暂时不可用，请重试"}

/** The management destination adds Web detail views while retaining the existing dashboard statistics. */
@Composable internal fun NativeStatisticsManagement(vm:NativeViewModel,back:()->Unit,initialSource:String="all"){
    val address=vm.state.address
    val connected=vm.state.connected
    val active=LocalManagementPageActive.current
    val owner=LocalLifecycleOwner.current
    var foreground by remember(owner){mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))}
    DisposableEffect(owner){val observer=LifecycleEventObserver{_,_->foreground=owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)};owner.lifecycle.addObserver(observer);onDispose{owner.lifecycle.removeObserver(observer)}}
    var selection by rememberSaveable(initialSource,stateSaver=statisticsSelectionSaver){mutableStateOf(StatisticsSelection(source=initialSource))}
    if(selection.tab=="requests"){
        NativeRequestRecords(vm,back){StatisticsTabStrip(detailTabs,selection.tab,{selection=selection.copy(tab=it)})}
        return
    }
    val request=selection.route()
    var page by remember(vm,address){mutableStateOf(StatisticsPageState())}
    val cache=remember(vm,address){mutableMapOf<String,JSONObject>()}
    var revision by remember{mutableIntStateOf(0)}
    val scope=rememberCoroutineScope()
    var actionJob by remember{mutableStateOf<Job?>(null)}
    DisposableEffect(connected,active,address){if(!connected||!active)actionJob?.cancel();onDispose{actionJob?.cancel()}}
    LaunchedEffect(vm,connected,active,foreground,address,request,revision){
        if(!connected||!active||!foreground){page=page.copy(loading=false);return@LaunchedEffect}
        val requestTab=selection.tab
        while(true){
            page=page.copy(loading=true,error="",data=cache[request]?:page.data?.takeIf{statisticsContentKey(page.dataRequest)==statisticsContentKey(request)},dataRequest=request,message=page.message.takeIf{page.dataRequest==request}.orEmpty())
            try{
                val result=vm.managementRequest(request)
                currentCoroutineContext().ensureActive()
                cache[request]=result
                if(cache.size>24)cache.remove(cache.keys.first())
                if(page.dataRequest==request)page=page.copy(data=result,loading=false,error="")
            }catch(error:CancellationException){throw error}catch(error:Exception){currentCoroutineContext().ensureActive();if(page.dataRequest==request)page=page.copy(loading=false,error=detailError(error))}
            val indexing=page.data?.optJSONObject("progress")?.optBoolean("running")==true||page.data?.optJSONObject("index")?.optBoolean("running")==true
            delay(if(requestTab=="speed"&&indexing)2500 else 60000)
        }
    }
    LaunchedEffect(vm,connected,active,foreground,address,selection.tab){
        if(connected&&active&&foreground&&selection.tab=="quota")try{
            val result=vm.managementRequest(statisticsRoot+"accounts")
            page=page.copy(accounts=result.detailRows("items").map{it.detailText("id") to (it.detailText("label")+if(it.optBoolean("active"))" · 当前" else "")},accountsError="")
        }catch(error:CancellationException){throw error}catch(error:Exception){page=page.copy(accountsError=detailError(error))}
    }
    fun action(name:String,body:JSONObject){
        if(!connected||page.busy.isNotBlank())return
        val actionRequest=selection.route()
        page=page.copy(busy=name,error="",message="")
        actionJob=scope.launch{
            try{
                vm.managementRequest(statisticsRoot+name,body)
                currentCoroutineContext().ensureActive()
                if(selection.route()==actionRequest)page=page.copy(message=when(name){"index"->if(body.optString("action")=="pause")"正在暂停统计索引" else "已请求更新统计索引";"quota/auto"->if(body.optBoolean("enabled"))"已开启每 5 分钟自动采样" else "已关闭自动采样";else->"已刷新当前账号额度"})
                revision++
            }catch(error:CancellationException){throw error}catch(error:Exception){currentCoroutineContext().ensureActive();if(selection.route()==actionRequest)page=page.copy(error=detailError(error))}
            finally{page=page.copy(busy="")}
        }
    }
    StatisticsDetailsContent(selection,page,connected,back,{selection=it},{revision++},::action)
}

@Composable private fun StatisticsDetailsContent(
    selection:StatisticsSelection,state:StatisticsPageState,connected:Boolean,back:()->Unit,
    onSelection:(StatisticsSelection)->Unit,onRefresh:()->Unit,onAction:(String,JSONObject)->Unit,
    modifier:Modifier=Modifier,
){
    val data=state.data?.takeIf{statisticsContentKey(state.dataRequest)==statisticsContentKey(selection.route())}
    NativeManagementPage("详细统计","",back,modifier.testTag("statisticsManagement"),actions={ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",onRefresh,enabled=connected&&!state.loading&&state.busy.isBlank())}){
        val scroll=rememberScrollState()
        LaunchedEffect(selection.tab){scroll.scrollTo(0)}
        Column(Modifier.weight(1f).nativeManagementScroll(scroll).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            StatisticsTabStrip(detailTabs,selection.tab,{onSelection(selection.copy(tab=it,range=if(selection.range=="rolling"&&it!="quota")"week" else selection.range))})
            if(selection.tab!="activity")StatisticsTabStrip(detailRanges,selection.range,{onSelection(selection.copy(range=it))})
            if(selection.tab=="quota")StatisticsTabStrip(listOf("1" to "近 24 小时","7" to "近 7 天","30" to "近 30 天","90" to "近 90 天"),if(selection.range=="rolling")selection.days else "",{onSelection(selection.copy(range="rolling",days=it))})
            if(selection.range=="custom"&&selection.tab!="activity")StatisticsDateRange(selection.from,selection.to,connected){from,to->onSelection(selection.copy(from=from,to=to))}
            when(selection.tab){
                "tokens","activity"->StatisticsPicker("来源",selection.source,detailSources,{onSelection(selection.copy(source=it,model="all",tier="all",effort="all"))},enabled=connected)
                "speed"->{
                    StatisticsPicker("速度来源",selection.speedSource,listOf("native" to "Codex 会话（含直连）","router" to "工作台请求"),{onSelection(selection.copy(speedSource=it,speedModel="all",provider="all"))},enabled=connected)
                    val options=data?.optJSONObject("options")
                    StatisticsPicker("模型",selection.speedModel,statisticsOptions(options,"model"),{onSelection(selection.copy(speedModel=it))},enabled=connected)
                    if(selection.speedSource=="router")StatisticsPicker("提供商",selection.provider,statisticsOptions(options,"provider"),{onSelection(selection.copy(provider=it))},enabled=connected)
                }
                "quota"->{StatisticsPicker("额度账号",selection.account,listOf("" to "当前账号")+state.accounts,{onSelection(selection.copy(account=it))},enabled=connected);if(state.accountsError.isNotBlank())Text(state.accountsError,color=MaterialTheme.colors.error,fontSize=12.sp)}
            }
            if(selection.tab=="tokens"&&selection.source=="codex"){
                val options=data?.optJSONObject("options")
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    StatisticsPicker("模型",selection.model,statisticsOptions(options,"model"),{onSelection(selection.copy(model=it))},Modifier.weight(1f),connected)
                    StatisticsPicker("服务等级",selection.tier,statisticsOptions(options,"tier",listOf("v:fast" to "Fast","v:standard" to "标准")),{onSelection(selection.copy(tier=it))},Modifier.weight(1f),connected)
                }
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    StatisticsPicker("推理强度",selection.effort,statisticsOptions(options,"effort"),{onSelection(selection.copy(effort=it))},Modifier.weight(1f),connected)
                    TextButton(onClick={onSelection(selection.copy(model="all",tier="all",effort="all"))},enabled=connected,modifier=Modifier.align(Alignment.CenterVertically)){Text("重置筛选")}
                }
                DashboardTabs(listOf("codex" to "Codex 计价","api" to "API 参考价"),selection.pricing,{onSelection(selection.copy(pricing=it))},enabled=connected)
            }
            val loading=state.loading||state.busy.isNotBlank()
            CompositionLocalProvider(LocalStatisticsFeedback provides state.copy(data=data)){
            if(data!=null){
                when(selection.tab){
                    "tokens"->StatisticsTokenDetails(data,selection)
                    "speed"->StatisticsSpeedDetails(data)
                    "quota"->StatisticsQuotaDetails(data,connected&&state.busy.isBlank(),{onAction("quota/auto",JSONObject().put("enabled",it))},{onAction("quota/refresh",JSONObject())})
                    else->StatisticsActivityDetails(data,selection.tab)
                }
                if(selection.tab!="speed"&&selection.tab!="quota"){
                    val progress=data.optJSONObject("progress")?:data.optJSONObject("index")?:JSONObject()
                    StatisticsIndexDetails(progress,connected&&state.busy.isBlank(),{onAction("index",JSONObject().put("action",it))})
                }
            }else StatisticsResultCard(detailTabs.find{it.first==selection.tab}?.second?:"统计"){
                Box(Modifier.fillMaxWidth().height(120.dp),contentAlignment=Alignment.CenterStart){Text(when{!connected->"连接电脑后查看详细统计";loading->"正在读取所选范围";state.error.isNotBlank()->"本次读取未完成，可刷新重试";else->"当前范围暂无统计记录"},color=detailMuted,fontSize=13.sp)}
            }
            }
            Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable internal fun StatisticsTabStrip(options:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit,modifier:Modifier=Modifier){
    val scroll=rememberLazyListState()
    LaunchedEffect(selected,options){
        val index=options.indexOfFirst{it.first==selected}
        if(index<0)return@LaunchedEffect
        val layout=scroll.layoutInfo
        val item=layout.visibleItemsInfo.find{it.index==index}
        // Selection only moves this horizontal list; ancestor relocation also moves the page.
        if(item==null||item.offset<layout.viewportStartOffset||item.offset+item.size>layout.viewportEndOffset)scroll.animateScrollToItem(index)
    }
    LazyRow(modifier.fillMaxWidth(),state=scroll,horizontalArrangement=Arrangement.spacedBy(6.dp)){
        items(options,key={it.first}){(id,label)->
            val chosen=id==selected
            Surface(shape=Radius.Control,color=if(chosen)MaterialTheme.colors.primary.copy(alpha=.1f) else MaterialTheme.colors.onSurface.copy(alpha=.035f)){
                Text(label,Modifier.clickable(onClick={if(!chosen)onSelect(id)}).padding(horizontal=13.dp,vertical=12.dp),fontSize=13.sp,fontWeight=if(chosen)FontWeight.SemiBold else FontWeight.Normal,color=if(chosen)MaterialTheme.colors.primary else detailMuted)
            }
        }
    }
}

@Composable private fun StatisticsResultCard(title:String,backgroundStatus:String?=null,content:@Composable ColumnScope.()->Unit){
    val feedback=LocalStatisticsFeedback.current
    val busy=feedback?.busy.orEmpty()
    val status=when{busy.isNotBlank()->"正在更新…";feedback?.loading==true->"正在读取…";else->backgroundStatus}
    DashboardCard{
        Row(Modifier.fillMaxWidth().heightIn(min=20.dp),verticalAlignment=Alignment.CenterVertically){
            Text(title,Modifier.weight(1f),fontSize=14.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
            if(status!=null)NativeRunningTitle(status,rememberNativeRunningPulse(true),Modifier.padding(start=8.dp).widthIn(max=140.dp),fontSize=11.sp)
            else feedback?.data?.detailText("updatedAt")?.takeIf{it.isNotBlank()}?.let{Text(runCatching{Instant.parse(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("HH:mm",Locale.ROOT))}.getOrDefault(""),Modifier.padding(start=8.dp),fontSize=10.sp,color=detailMuted)}
        }
        feedback?.error?.takeIf{it.isNotBlank()}?.let{Text(it,color=MaterialTheme.colors.error,fontSize=13.sp)}
        feedback?.message?.takeIf{it.isNotBlank()}?.let{Text(it,color=MaterialTheme.colors.primary,fontSize=12.sp)}
        val failed=feedback?.data?.optJSONArray("failedSources")
        if(failed!=null&&failed.length()>0)Text("暂时无法读取 "+(0 until failed.length()).joinToString("、"){value->detailSources.find{it.first==failed.optString(value)}?.second?:failed.optString(value)},fontSize=12.sp,color=MaterialTheme.colors.error)
        content()
    }
}

private fun statisticsOptions(data:JSONObject?,key:String,extra:List<Pair<String,String>> = emptyList()):List<Pair<String,String>> =
    (listOf("all" to "全部")+data?.detailRows(key).orEmpty().map{it.detailText("value") to when(it.detailText("label")){"fast"->"Fast";"standard"->"标准";else->it.detailText("label")}}+extra).distinctBy{it.first}

@Composable internal fun StatisticsPicker(label:String,value:String,options:List<Pair<String,String>>,onSelect:(String)->Unit,modifier:Modifier=Modifier,enabled:Boolean=true){
    var expanded by remember{mutableStateOf(false)}
    val entries=if(options.any{it.first==value})options else options+(value to when(value){"all"->"全部";"missing"->"未记录";"pending"->"待回填";else->value.removePrefix("v:")})
    Box(modifier){
        OutlinedButton(onClick={expanded=true},enabled=enabled,modifier=Modifier.fillMaxWidth(),shape=Radius.Control,contentPadding=PaddingValues(horizontal=12.dp,vertical=8.dp)){
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(3.dp)){
                Text(label,fontSize=10.sp,color=detailMuted)
                Text(entries.find{it.first==value}?.second.orEmpty(),fontSize=13.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
            }
            ModernIcon(R.drawable.ic_lucide_chevron_down,"选择$label",Modifier.padding(start=8.dp).size(14.dp),detailMuted)
        }
        NativeDropdownMenu(expanded,onDismissRequest={expanded=false},modifier=Modifier.heightIn(max=340.dp)){
            entries.forEach{(id,title)->DropdownMenuItem(onClick={expanded=false;onSelect(id)}){Text(title,fontSize=13.sp,maxLines=2,overflow=TextOverflow.Ellipsis)}}
        }
    }
}

@Composable private fun StatisticsDateRange(from:String,to:String,enabled:Boolean,onApply:(String,String)->Unit){
    var start by rememberSaveable(from){mutableStateOf(from)}
    var end by rememberSaveable(to){mutableStateOf(to)}
    var error by remember{mutableStateOf("")}
    DashboardCard{
        Text("自定义时间段 · 电脑本地时间",fontSize=12.sp,fontWeight=FontWeight.Medium)
        OutlinedTextField(start,{start=it},Modifier.fillMaxWidth(),label={Text("开始 · yyyy-MM-ddTHH:mm")},singleLine=true,enabled=enabled)
        OutlinedTextField(end,{end=it},Modifier.fillMaxWidth(),label={Text("结束 · yyyy-MM-ddTHH:mm")},singleLine=true,enabled=enabled)
        if(error.isNotBlank())Text(error,fontSize=12.sp,color=MaterialTheme.colors.error)
        TextButton(onClick={
            val startTime=runCatching{LocalDateTime.parse(start,minuteFormat)}.getOrNull();val endTime=runCatching{LocalDateTime.parse(end,minuteFormat)}.getOrNull()
            if(startTime==null||endTime==null||startTime>endTime)error="请输入有效的开始与结束时间" else{error="";onApply(start,end)}
        },enabled=enabled){Text("应用时间段")}
    }
}

@Composable private fun StatisticsMetrics(items:List<Pair<String,String>>,modifier:Modifier=Modifier){
    Column(modifier,verticalArrangement=Arrangement.spacedBy(14.dp)){
        items.chunked(2).forEach{row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)){
            row.forEach{(label,value)->Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)){Text(label,fontSize=11.sp,color=detailMuted);Text(value,fontSize=20.sp,fontWeight=FontWeight.SemiBold)}}
            if(row.size==1)Spacer(Modifier.weight(1f))
        }}
    }
}

@Composable private fun StatisticsTokenDetails(raw:JSONObject,selection:StatisticsSelection){
    val data=remember(raw){parseConsoleStatistics(raw)}
    if(!data.available){StatisticsResultCard("Token 总量"){Text("本机尚未发现此来源的用量数据库",fontSize=13.sp,color=detailMuted)};return}
    val tokens=data.tokens
    val input=tokens.input?:0;val cached=tokens.cached?:0
    StatisticsResultCard("Token 总量"){
        Text(consoleCount(tokens.total),fontSize=34.sp,lineHeight=42.sp,fontWeight=FontWeight.SemiBold,letterSpacing=(-.7).sp)
        StatisticsMetrics(listOf("非缓存输入" to if(cached<=input)nativeTokenCount(input-cached) else "—","缓存输入" to consoleCount(tokens.cached),"输出（含推理）" to consoleCount(tokens.output),"推理输出" to consoleCount(tokens.reasoning),"输入缓存命中率" to if(input>0&&cached<=input)detailPercent(cached.toDouble()/input*100) else "—","缓存写入" to consoleCount(tokens.cacheWrite)))
        Text("${consoleCount(tokens.records)} 条计量记录",fontSize=11.sp,color=detailMuted)
        if(cached>input)Text("日志缓存计数大于输入，当前无法计算命中率",fontSize=12.sp,color=MaterialTheme.colors.error)
    }
    val coverage=raw.optJSONObject("tokenCoverage")
    val pending=(coverage?.optLong("samples")?:0)-(coverage?.optLong("enriched")?:0)
    if(pending>0)Text("${nativeTokenCount(pending)} 条记录待补充模型维度",fontSize=12.sp,color=detailMuted)
    if(data.series.isNotEmpty()||data.modelSeries.isNotEmpty())DashboardCard{
        val hourly=selection.range=="today"||selection.range=="yesterday"||selection.range=="custom"&&selection.from.take(10)==selection.to.take(10)
        StatisticsZoomableTokenTrend(if(hourly)data.copy(range="today") else data,selection.source+selection.range+selection.from+selection.to)
    }
    val sources=raw.detailRows("sourceTotals")
    if(sources.isNotEmpty())DashboardCard{
        Text("来源用量",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
        sources.forEach{source->val total=source.optJSONObject("totals")?:JSONObject();val cost=source.optJSONObject("cost")?:JSONObject()
            Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                Row(Modifier.fillMaxWidth()){Text(source.detailText("label"),Modifier.weight(1f),fontSize=13.sp);Text(detailCount(total.detailNumber("total")),fontSize=13.sp,fontWeight=FontWeight.Medium)}
                Text("${detailCount(total.detailNumber("records"))} 条记录 · ${statisticsCostLabel(cost)}",fontSize=11.sp,color=detailMuted)
            }
        }
        Text("各来源独立计量；同一调用被多个来源记录时分别计入。",fontSize=11.sp,color=detailMuted)
    }else DashboardCard{
        Text(if(selection.source in listOf("hermes","deepseek","opencode"))"费用与计费状态" else if(selection.source=="codex")"参考金额 · ${if(data.cost.basis=="api")"API 计价" else "Codex 计价"}" else "参考金额",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
        Text(statisticsCostLabel(raw.optJSONObject("cost")?:JSONObject()),fontSize=26.sp,fontWeight=FontWeight.SemiBold)
        val cost=data.cost
        val notes=listOfNotNull(cost.actualUsd?.let{"原生报告 ${consoleMoney(it)}"},cost.estimatedUsd?.let{"参考估算 ${consoleMoney(it)}"},cost.unpricedRecords?.takeIf{it>0}?.let{"${consoleCount(it)} 条未计价"},cost.partialRecords?.takeIf{it>0}?.let{"${consoleCount(it)} 条费用不完整"})
        if(notes.isNotEmpty())Text(notes.joinToString(" · "),fontSize=12.sp,color=detailMuted)
        if(cost.priceDate.isNotBlank())Text("价格核验 ${cost.priceDate}",fontSize=11.sp,color=detailMuted)
        if(selection.source=="opencode")Text("OpenCode 本地记录金额",fontSize=11.sp,color=detailMuted)
        StatisticsCostDetails(raw.optJSONObject("costDetail"),selection.route())
    }
    val dimensions=raw.detailRows("dimensions")
    if(dimensions.isNotEmpty())DashboardCard{
        Text("模型 × 服务等级 × 推理强度",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
        dimensions.forEachIndexed{index,row->
            if(index>0)Divider(color=detailDivider)
            Column(verticalArrangement=Arrangement.spacedBy(5.dp)){
                Text(if(row.optBoolean("pending"))"待回填" else row.detailText("model").ifBlank{"未记录模型"},fontSize=13.sp,fontWeight=FontWeight.Medium)
                Text(if(row.optBoolean("pending"))"服务等级与推理强度待回填" else "${when(row.detailText("tier")){"fast"->"Fast";"standard"->"标准";else->row.detailText("tier").ifBlank{"等级未记录"}}} · ${row.detailText("effort").ifBlank{"推理强度未记录"}}",fontSize=11.sp,color=detailMuted)
                Text("${detailCount(row.detailNumber("total"))} Token · 输出 ${detailCount(row.detailNumber("output"))} · ${consoleMoney(row.optJSONObject("cost")?.detailNumber("usd"))}",fontSize=12.sp)
                Text("缓存命中 ${detailPercent(row.detailNumber("cacheHitRate")?.times(100))} · ${detailCount(row.detailNumber("samples"))} 条记录",fontSize=11.sp,color=detailMuted)
            }
        }
        if(raw.optBoolean("dimensionsTruncated"))Text("显示用量最高的 100 组，可继续筛选。",fontSize=11.sp,color=detailMuted)
    }
    if(data.models.isNotEmpty())DashboardCard{
        Text("模型用量占比",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
        val modelRows=raw.detailRows("models")
        data.models.forEachIndexed{index,model->
            if(index>0)Divider(color=detailDivider)
            Column(verticalArrangement=Arrangement.spacedBy(5.dp)){
                Row(Modifier.fillMaxWidth()){Text(model.id,Modifier.weight(1f).padding(end=10.dp),fontSize=13.sp,maxLines=2,overflow=TextOverflow.Ellipsis);Text(consoleCount(model.tokens.total),fontSize=13.sp,fontWeight=FontWeight.Medium)}
                val total=(data.tokens.total?:0).coerceAtLeast(1)
                LinearProgressIndicator(((model.tokens.total?:0).toDouble()/total).coerceIn(0.0,1.0).toFloat(),Modifier.fillMaxWidth().height(3.dp).clip(CircleShape),color=AppColor.ChartPurple,backgroundColor=detailDivider)
                Text("占比 ${detailPercent((model.tokens.total?:0).toDouble()/total*100)} · 输入 ${consoleCount(model.tokens.input)} · 输出 ${consoleCount(model.tokens.output)} · ${consoleCount(model.tokens.records)} 条记录",fontSize=11.sp,color=detailMuted)
                Text(listOfNotNull(model.provider.takeIf{it.isNotBlank()},if((model.includedRecords?:0)>0)"订阅已包含" else null,model.usd?.let{consoleMoney(it)},modelRows.getOrNull(index)?.detailNumber("cny")?.let{"¥${String.format(Locale.ROOT,"%.2f",it)}"},model.unpricedRecords?.takeIf{it>0}?.let{"${consoleCount(it)} 条未计价"}).joinToString(" · "),fontSize=11.sp,color=detailMuted)
            }
        }
    }
    if(selection.source=="hermes")Text("Hermes 会话累计量按最近计量日期归档，时间段不拆分会话内部调用。",fontSize=11.sp,color=detailMuted)
    if((data.activityOnlySessions?:0)>0)Text("${consoleCount(data.activityOnlySessions)} 个会话只有活动记录，未计入 Token。",fontSize=11.sp,color=detailMuted)
    if((data.skippedFiles?:0)>0)Text("${consoleCount(data.skippedFiles)} 个文件或不完整记录未完全读取。",fontSize=11.sp,color=detailMuted)
}

@Composable private fun StatisticsZoomableTokenTrend(data:ConsoleStatistics,chartKey:String){
    var zoom by rememberSaveable(chartKey){mutableFloatStateOf(1f)}
    var position by rememberSaveable(chartKey){mutableFloatStateOf(0f)}
    val scroll=rememberScrollState()
    LaunchedEffect(position,scroll.maxValue,zoom){scroll.scrollTo((scroll.maxValue*position).roundToInt())}
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(3.dp)){
        TextButton(onClick={zoom=(zoom-.5f).coerceAtLeast(1f)},enabled=zoom>1f,contentPadding=PaddingValues(8.dp)){Text("缩小",fontSize=12.sp)}
        Slider(zoom,{zoom=it},Modifier.weight(1f),valueRange=1f..3f,steps=3)
        TextButton(onClick={zoom=(zoom+.5f).coerceAtMost(3f)},enabled=zoom<3f,contentPadding=PaddingValues(8.dp)){Text("放大",fontSize=12.sp)}
        TextButton(onClick={zoom=1f;position=0f},contentPadding=PaddingValues(8.dp)){Text("全部",fontSize=12.sp)}
        TextButton(onClick={position=1f},contentPadding=PaddingValues(8.dp)){Text("最新",fontSize=12.sp)}
    }
    BoxWithConstraints(Modifier.fillMaxWidth()){
        val chartWidth=maxWidth*zoom
        Box(Modifier.fillMaxWidth().horizontalScroll(scroll,enabled=false)){
            Column(Modifier.width(chartWidth)){ConsoleModelTrend(data)}
        }
    }
    if(zoom>1f)Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
        Text("定位",fontSize=11.sp,color=detailMuted)
        Slider(position,{position=it},Modifier.weight(1f),valueRange=0f..1f)
    }
}

private fun statisticsCostLabel(cost:JSONObject):String{
    val amounts=listOfNotNull(cost.detailNumber("usd")?.let{consoleMoney(it)},cost.detailNumber("cny")?.let{"¥${String.format(Locale.ROOT,"%.2f",it)}"})
    return listOfNotNull(amounts.takeIf{it.isNotEmpty()}?.joinToString(" + "),if((cost.detailNumber("includedRecords")?:0.0)>0)"订阅已包含" else null).joinToString(" + ").ifBlank{"—"}
}

@Composable private fun StatisticsCostDetails(data:JSONObject?,selectionKey:String){
    var expanded by rememberSaveable(selectionKey){mutableStateOf(false)}
    if(data==null)return
    val parts=listOf("非缓存输入" to data.detailNumber("inputUsd"),"缓存输入" to data.detailNumber("cachedUsd"),"输出" to data.detailNumber("outputUsd"))
    if(parts.any{it.second!=null})Text(parts.joinToString(" · "){it.first+" "+consoleMoney(it.second)},fontSize=11.sp,color=detailMuted)
    TextButton(onClick={expanded=!expanded},contentPadding=PaddingValues(0.dp)){Text(if(expanded)"收起计价依据" else "计价依据与单价",fontSize=12.sp)}
    if(expanded){
        Text("${detailCount(data.detailNumber("pricedSamples"))} 条已计价 · ${detailCount(data.detailNumber("longContextSamples"))} 条长上下文费率 · ${detailCount(data.detailNumber("unpricedTokens"))} Token 未计价",fontSize=11.sp,color=detailMuted)
        Text(if(data.detailText("basis")=="codex")"按 Codex 公布费率折算；Fast、缓存及长上下文按对应规则计算。" else "按 API 参考价估算；未计入工具费和地域加价。",fontSize=11.sp,color=detailMuted)
        Text("${detailCount(data.detailNumber("assumedStandardSamples"))} 条未记录等级的记录按 Standard 估算；参考金额与订阅实际扣费口径不同。",fontSize=11.sp,color=detailMuted)
        data.detailRows("rates").forEach{rate->Text("${rate.detailText("model")}  输入 ${consoleMoney(rate.detailNumber("input"))} / 缓存 ${consoleMoney(rate.detailNumber("cached"))} / 输出 ${consoleMoney(rate.detailNumber("output"))}（每百万）",fontSize=11.sp,color=detailMuted)}
    }
}

private fun statisticsSpeedIndexStatus(progress:JSONObject):String?{
    if(!progress.optBoolean("running"))return null
    val total=progress.detailNumber("totalThreads");val completed=progress.detailNumber("completedThreads")
    if(total==null||total<=0||completed==null)return "正在检查记录…"
    return "索引 ${detailCount(completed)}/${detailCount(total)}"+(progress.detailNumber("items")?.let{" · ${detailCount(it)} 段"}?:"")
}

private fun statisticsSpeedModel(row:JSONObject):String{
    val tier=row.detailText("tier")
    val mode=when(tier){"fast"->"Fast";"standard"->"标准";""->"模式未记录";else->tier}
    val effort=row.detailText("effort").let{if(it.isBlank())"强度未记录" else effortName(it)}
    val phase=when(row.detailText("phase")){"commentary"->"进度说明";"final_answer"->"最终回复";else->""}
    return listOf(row.detailText("model").ifBlank{"未记录模型"},mode,effort,phase).filter{it.isNotBlank()}.joinToString(" · ")
}

@Composable internal fun StatisticsSpeedDetails(data:JSONObject){
    val native=data.detailText("source")=="native"
    val totals=data.optJSONObject("totals")?:JSONObject();val coverage=data.optJSONObject("coverage")?:JSONObject();val progress=data.optJSONObject("progress")?:JSONObject()
    StatisticsResultCard(if(native)"可见回复速度" else "请求输出速度",backgroundStatus=if(native)statisticsSpeedIndexStatus(progress) else null){
        StatisticsMetrics(listOf((if(native)"回复平均速度（估算）" else "请求平均速率") to detailRate(totals.detailNumber("averageTPS")),"速度 P50" to detailRate(totals.detailNumber("p50TPS")),"有效计量" to detailCount(totals.detailNumber("samples")),if(native)"会话数" to data.detailRows("groups").flatMap{it.detailRows("sessions")}.map{it.detailText("id")}.distinct().size.toString() else "首字等待 P50" to detailDuration(totals.detailNumber("p50FirstTextMs")),"耗时 P50" to detailDuration(totals.detailNumber("p50DurationMs")),"耗时 P95" to detailDuration(totals.detailNumber("p95DurationMs"))))
        Text(if(native)"按模型、思考强度和回复类型分组。可见文本 Token 估算 ÷ 整段回复耗时；Fast 来自会话记录。" else "输出 Token（含推理）÷ 请求总耗时，包含等待与思考。首字等待以正文首个增量为准；Fast 按上游返回等级记录。",fontSize=11.sp,color=detailMuted)
        Text("${detailCount(coverage.detailNumber("failed"))} 次失败 · ${detailCount(coverage.detailNumber("unmeasured"))} 条缺少有效用量或时间",fontSize=11.sp,color=detailMuted)
        if(!native)Text("${detailCount(coverage.detailNumber("excludedTests"))} 次模型测试、${detailCount(coverage.detailNumber("excludedCompact"))} 次压缩请求未计入",fontSize=11.sp,color=detailMuted)
    }
    if(progress.detailText("error").isNotBlank())Text(progress.detailText("error"),fontSize=12.sp,color=MaterialTheme.colors.error)
    val groups=data.detailRows("groups")
    if(groups.isEmpty())DashboardCard{Text(if(coverage.has("available")&&!coverage.isNull("available")&&!coverage.optBoolean("available"))"本机尚未发现完整流式回复历史" else "当前范围暂无完整速度计量",fontSize=13.sp,color=detailMuted)}
    groups.forEach{group->key(native,group.opt("model"),group.opt("provider"),group.detailText("tier").ifBlank{null},group.opt("effort"),group.opt("phase")){
        var expanded by remember{mutableStateOf(false)}
        var visible by remember{mutableIntStateOf(30)}
        DashboardCard{
            Column(Modifier.fillMaxWidth().then(if(native)Modifier.clickable{expanded=!expanded} else Modifier),verticalArrangement=Arrangement.spacedBy(6.dp)){
                Text(statisticsSpeedModel(group),fontSize=14.sp,fontWeight=FontWeight.SemiBold)
                Text(detailRate(group.detailNumber("averageTPS")),fontSize=23.sp,fontWeight=FontWeight.SemiBold)
                Text("${detailCount(group.detailNumber("samples"))} 条计量"+(if(native)" · ${detailCount(group.detailNumber("sessionCount"))} 个会话 · ${if(expanded)"收起" else "展开"}" else " · "+group.detailText("providerName").ifBlank{group.detailText("provider").ifBlank{"未记录提供商"}}),fontSize=12.sp,color=detailMuted)
            }
            if(!native)Text("速度 P50 ${detailRate(group.detailNumber("p50TPS"))} · 首字等待 P50 ${detailDuration(group.detailNumber("p50FirstTextMs"))} · 耗时 P95 ${detailDuration(group.detailNumber("p95DurationMs"))}",fontSize=11.sp,color=detailMuted)
            if(native&&expanded){
                val sessions=group.detailRows("sessions")
                sessions.take(visible).forEach{session->Divider(color=detailDivider);Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                    Text(session.detailText("title").ifBlank{"会话 "+session.detailText("id").take(8)},fontSize=13.sp,maxLines=3,overflow=TextOverflow.Ellipsis)
                    Text("平均 ${detailRate(session.detailNumber("averageTPS"))} · P50 ${detailRate(session.detailNumber("p50TPS"))}",fontSize=12.sp)
                    Text("${detailCount(session.detailNumber("samples"))} 段 · ${detailCount(session.detailNumber("outputTokens"))} 可见 Token · ${detailDate(session.detailNumber("lastAt"),true)}",fontSize=11.sp,color=detailMuted)
                }}
                if(visible<sessions.size)TextButton(onClick={visible+=30}){Text("显示更多会话（${sessions.size-visible}）")}
            }
        }
    }}
    val recent=data.detailRows("recent")
    if(!native&&recent.isNotEmpty())DashboardCard{
        Text("最近完成请求",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
        recent.forEach{row->Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
            Text(statisticsSpeedModel(row),fontSize=13.sp,fontWeight=FontWeight.Medium)
            Text("${detailDate(row.detailNumber("timestamp"),true)} · ${detailCount(row.detailNumber("outputTokens"))} 输出 Token",fontSize=11.sp,color=detailMuted)
            Text("${detailRate(row.detailNumber("endToEndTPS"))} · 耗时 ${detailDuration(row.detailNumber("durationMs"))} · 首字等待 ${detailDuration(row.detailNumber("firstTextMs"))}",fontSize=11.sp,color=detailMuted)
        }}
    }
}

@Composable private fun StatisticsActivityDetails(data:JSONObject,tab:String){
    val totals=data.optJSONObject("totals")?:JSONObject();val scope=data.optJSONObject("scope")?:JSONObject();val series=data.detailRows("series")
    when(tab){
        "activity"->{
            StatisticsResultCard("今年 Token 活动"){
                StatisticsActivityCalendar(data.detailRows("calendar"),data.detailNumber("until"))
                val sourceTotals=data.detailRows("sourceTotals")
                if(sourceTotals.isNotEmpty())Text(sourceTotals.joinToString(" · "){row->(detailSources.find{it.first==row.detailText("source")}?.second?:row.detailText("source"))+" "+detailCount(row.detailNumber("total"))},fontSize=11.sp,color=detailMuted)
            }
            DashboardCard{
                Text("Codex 日志活动",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
                StatisticsMetrics(listOf("估算活跃分钟" to detailCount(totals.detailNumber("activeMinutes")),"活跃日期" to detailCount(totals.detailNumber("activeDays")),"发生过活动的会话" to detailCount(totals.detailNumber("activeSessions"))))
                Text("含日志事件的分钟数，用于估算记录活动。",fontSize=11.sp,color=detailMuted)
                StatisticsLineChart(series.takeLast(14).map{detailDayPoint(it,listOf("activeMinutes"))},listOf("活跃分钟"))
            }
        }
        "sessions"->StatisticsResultCard("Codex 会话"){
            StatisticsMetrics(listOf("新建会话" to detailCount(totals.detailNumber("newSessions")),"发生过活动的会话" to detailCount(totals.detailNumber("activeSessions")),"本机索引会话" to detailCount(scope.detailNumber("sessions"))))
            StatisticsLineChart(series.map{detailDayPoint(it,listOf("newSessions","activeSessions"))},listOf("新建","活跃"))
        }
        "skills"->{
            val skills=data.optJSONObject("skills")?:JSONObject();val skillTotals=skills.optJSONObject("totals")?:JSONObject();val coverage=skills.optJSONObject("coverage")?:JSONObject()
            StatisticsResultCard("Skills 读取"){
                StatisticsMetrics(listOf("读取请求" to detailCount(skillTotals.detailNumber("reads")),"涉及技能" to detailCount(skillTotals.detailNumber("skills")),"涉及会话" to detailCount(skillTotals.detailNumber("sessions"))))
                Text(skills.detailText("definition").ifBlank{"统计可识别的 SKILL.md 读取请求"},fontSize=11.sp,color=detailMuted)
                if(coverage.optLong("completed")<coverage.optLong("files"))Text("历史技能记录正在补充",fontSize=11.sp,color=detailMuted)
            }
            val ranking=skills.detailRows("ranking")
            DashboardCard{
                Text("技能明细",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
                if(ranking.isEmpty())Text("当前范围暂无可识别的技能读取",fontSize=13.sp,color=detailMuted)
                ranking.forEach{row->Column(verticalArrangement=Arrangement.spacedBy(4.dp)){Text(row.detailText("name"),fontSize=13.sp,fontWeight=FontWeight.Medium);Text("${detailCount(row.detailNumber("reads"))} 次读取 · ${detailCount(row.detailNumber("sessions"))} 个会话 · ${detailDate(row.detailNumber("lastRead"))}",fontSize=11.sp,color=detailMuted)}}
            }
            val recent=skills.detailRows("recent")
            if(recent.isNotEmpty())DashboardCard{
                Text("最近读取",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
                recent.forEach{row->Column(verticalArrangement=Arrangement.spacedBy(4.dp)){Text(row.detailText("name"),fontSize=12.sp);Text("${detailDate(row.detailNumber("time"))} · 会话 ${row.detailText("session").take(8)}",fontSize=11.sp,color=detailMuted)}}
            }
        }
        else->{
            StatisticsResultCard(if(tab=="tools")"Codex 工具调用" else "Codex 读写与执行"){
                StatisticsMetrics(listOf("读取 / 检索" to detailCount(totals.detailNumber("reads")),"写入 / 编辑" to detailCount(totals.detailNumber("writes")),"执行调用" to detailCount(totals.detailNumber("commands")),"其他" to detailCount(totals.detailNumber("other"))))
                if(tab=="changes"){StatisticsLineChart(series.map{detailDayPoint(it,listOf("reads","writes","commands","other"))},listOf("读取","写入","执行","其他"));Text("可识别调用次数，与 Git 变更行数口径不同。",fontSize=11.sp,color=detailMuted)}
            }
            if(tab=="tools")DashboardCard{
                Text("调用排名 · ${detailCount(totals.detailNumber("toolCalls"))} 次",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
                val tools=data.detailRows("tools");val maximum=tools.maxOfOrNull{it.optLong("count")}?.coerceAtLeast(1)?:1
                if(tools.isEmpty())Text("当前范围没有已识别的工具调用",fontSize=13.sp,color=detailMuted)
                tools.forEach{row->Column(verticalArrangement=Arrangement.spacedBy(7.dp)){
                    Row(Modifier.fillMaxWidth()){Text(row.detailText("name"),Modifier.weight(1f).padding(end=12.dp),fontSize=12.sp,maxLines=2,overflow=TextOverflow.Ellipsis);Text(detailCount(row.detailNumber("count")),fontSize=12.sp)}
                    LinearProgressIndicator((row.optLong("count").toFloat()/maximum).coerceIn(0f,1f),Modifier.fillMaxWidth().height(3.dp).clip(CircleShape),color=AppColor.ChartPurple,backgroundColor=detailDivider)
                }}
            }
        }
    }
    if((scope.detailNumber("skippedRecords")?:0.0)>0)Text("${detailCount(scope.detailNumber("skippedRecords"))} 条过大或异常记录跳过",fontSize=11.sp,color=detailMuted)
}

@Composable private fun StatisticsIndexDetails(progress:JSONObject,enabled:Boolean,onAction:(String)->Unit){
    DashboardCard{
        val running=progress.optBoolean("running")
        StatusPulseText(if(running)"统计索引更新中…" else if(progress.optBoolean("cancelled"))"统计索引已暂停" else "统计索引",running)
        val files=progress.detailNumber("completedFiles")
        if(files!=null)Text("${detailCount(files)} 个文件 · ${detailCount(progress.detailNumber("doneBytes")?.div(1024*1024))} / ${detailCount(progress.detailNumber("totalBytes")?.div(1024*1024))} MB",fontSize=11.sp,color=detailMuted)
        if(progress.detailText("error").isNotBlank())Text(progress.detailText("error"),fontSize=12.sp,color=MaterialTheme.colors.error)
        Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){
            TextButton(onClick={onAction("refresh")},enabled=enabled&&!running){Text("更新统计索引")}
            if(running)TextButton(onClick={onAction("pause")},enabled=enabled){Text("暂停索引")}
        }
    }
}

@Composable private fun StatisticsQuotaDetails(data:JSONObject,enabled:Boolean,onAuto:(Boolean)->Unit,onRefresh:()->Unit){
    val points=data.detailRows("points");val latest=data.optJSONObject("latest")?:JSONObject();val last=points.lastOrNull();val routing=data.optJSONObject("routing")?:JSONObject()
    val primary=latest.optJSONObject("primary")?:JSONObject();val secondary=latest.optJSONObject("secondary")?:JSONObject()
    fun remaining(key:String)=last?.detailNumber(key)?.let{(100-it).coerceIn(0.0,100.0)}
    StatisticsResultCard("账号额度历史"){
        StatisticsMetrics(listOf("5 小时额度剩余" to detailPercent(remaining("primary")),"每周额度剩余" to detailPercent(remaining("secondary")),"真实采样点" to detailCount(data.detailNumber("sampleCount")),"转发请求" to detailCount(routing.detailNumber("requests"))))
        if(latest.detailText("plan").isNotBlank())Text("套餐 ${latest.detailText("plan")}",fontSize=11.sp,color=detailMuted)
        Text("最新账号记录：5 小时重置 ${detailDate(primary.detailNumber("reset_at"),true)} · 每周重置 ${detailDate(secondary.detailNumber("reset_at"),true)}",fontSize=11.sp,color=detailMuted)
        Text("图中 ${points.size} 个采样点"+(if(data.optLong("displayedCount")<data.optLong("sampleCount"))" · 按时间抽样显示" else ""),fontSize=11.sp,color=detailMuted)
        StatisticsLineChart(points.map{row->DetailChartPoint((row.optDouble("timestamp")*1000).toLong(),detailDate(row.detailNumber("timestamp"),true),listOf(row.detailNumber("primary")?.let{(100-it).coerceIn(0.0,100.0)},row.detailNumber("secondary")?.let{(100-it).coerceIn(0.0,100.0)}))},listOf("5 小时剩余","每周剩余"),percent=true)
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("每 5 分钟自动采样",fontSize=13.sp);Text("记录电脑当前登录账号的真实额度",fontSize=11.sp,color=detailMuted)};Switch(data.optBoolean("autoSample",true),onCheckedChange=onAuto,enabled=enabled)}
        TextButton(onClick=onRefresh,enabled=enabled){Text("刷新当前登录账号额度")}
        if(data.detailText("lastError").isNotBlank())Text(data.detailText("lastError"),fontSize=12.sp,color=MaterialTheme.colors.error)
    }
    DashboardCard{
        Text("工作台转发用量",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
        val measured=(routing.detailNumber("measuredRequests")?:0.0)>0
        StatisticsMetrics(listOf("输入 Token" to if(measured)detailCount(routing.detailNumber("inputTokens")) else "—","输出 Token" to if(measured)detailCount(routing.detailNumber("outputTokens")) else "—","收到用量的响应" to detailCount(routing.detailNumber("measuredRequests")),"失败请求" to detailCount(routing.detailNumber("failed"))))
        Text("仅统计经过工作台的请求，绕过工作台的调用由对应来源的 Token 统计显示。",fontSize=11.sp,color=detailMuted)
    }
    DashboardCard{
        Text("最近请求中的失败记录",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
        val failed=routing.detailRows("recent").filter{it.optBoolean("failed")}
        if(failed.isEmpty())Text("最近请求中没有失败记录",fontSize=13.sp,color=detailMuted)
        failed.forEach{row->
            var expanded by remember(row){mutableStateOf(false)}
            val error=row.optJSONObject("error")?:JSONObject()
            Column(Modifier.fillMaxWidth().clickable{expanded=!expanded},verticalArrangement=Arrangement.spacedBy(5.dp)){
                Text(row.detailText("model").ifBlank{"未记录模型"}+" · HTTP ${row.optInt("status")}",fontSize=13.sp,fontWeight=FontWeight.Medium)
                Text("${detailDate(row.detailNumber("timestamp"),true)} · ${error.detailText("label").ifBlank{row.detailText("errorCode").ifBlank{"请求失败"}}}",fontSize=11.sp,color=detailMuted)
                if(expanded){Text(error.detailText("message").ifBlank{"旧记录未保存错误详情"},fontSize=12.sp);if(error.detailText("hint").isNotBlank())Text(error.detailText("hint"),fontSize=12.sp,color=detailMuted);if(error.detailText("requestId").isNotBlank())Text("请求 ID：${error.detailText("requestId")}",fontSize=11.sp,color=detailMuted)}
            }
        }
    }
}

private data class DetailChartPoint(val at:Long,val label:String,val values:List<Double?>)
private fun detailDayPoint(row:JSONObject,fields:List<String>):DetailChartPoint{
    val day=row.detailText("date")
    val at=runCatching{LocalDate.parse(day).atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()}.getOrDefault(0)
    return DetailChartPoint(at,day,fields.map{row.detailNumber(it)})
}

@Composable private fun StatisticsLineChart(points:List<DetailChartPoint>,labels:List<String>,modifier:Modifier=Modifier,percent:Boolean=false){
    if(points.isEmpty()){Text("当前范围暂无曲线记录",fontSize=12.sp,color=detailMuted);return}
    val palette=listOf(MaterialTheme.colors.primary,AppColor.ChartPurple,Color(0xff259fb8),Color(0xffd08b36))
    val grid=detailDivider;val muted=detailMuted
    val ordered=remember(points){points.sortedBy{it.at}}
    val maximum=if(percent)100.0 else (ordered.flatMap{it.values}.filterNotNull().maxOrNull()?:0.0).coerceAtLeast(1.0)
    val start=ordered.first().at;val end=ordered.last().at
    var selected by remember(points){mutableIntStateOf(-1)}
    val touchPosition=remember(points){mutableStateOf(Offset.Zero)}
    Column(modifier,verticalArrangement=Arrangement.spacedBy(10.dp)){
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){labels.forEachIndexed{index,label->Text("● $label",fontSize=10.sp,color=palette[index%palette.size])}}
        Row(Modifier.fillMaxWidth()){
            Column(Modifier.width(42.dp).height(168.dp),verticalArrangement=Arrangement.SpaceBetween){listOf(maximum,maximum/2,0.0).forEach{Text(if(percent)"${it.toInt()}%" else detailCount(it),fontSize=9.sp,color=muted)}}
            Column(Modifier.weight(1f)){
                Box(Modifier.fillMaxWidth().height(168.dp)){
                    Canvas(Modifier.fillMaxSize().semantics{contentDescription="按住或横向滑动查看明细，松开后隐藏"}.nativeChartPress(ordered,{position,size->
                        touchPosition.value=position
                        val target=start.toDouble()+(position.x/size.width.coerceAtLeast(1)).coerceIn(0f,1f).toDouble()*(end-start)
                        selected=ordered.indices.minByOrNull{kotlin.math.abs(ordered[it].at-target)}?:-1
                    },{selected=-1})){
                        val top=8.dp.toPx();val bottom=size.height-4.dp.toPx();val chartHeight=bottom-top
                        fun x(index:Int)=if(start==end)size.width/2 else (ordered[index].at-start).toFloat()/(end-start)*size.width
                        fun y(value:Double)=bottom-(value/maximum*chartHeight).toFloat()
                        listOf(top,top+chartHeight/2,bottom).forEach{drawLine(grid,Offset(0f,it),Offset(size.width,it),1.dp.toPx())}
                        labels.forEachIndexed{line,_->
                            val path=Path();var previous:Offset?=null
                            ordered.forEachIndexed{index,point->
                                val value=point.values.getOrNull(line)
                                if(value==null)previous=null else{
                                    val next=Offset(x(index),y(value));val before=previous
                                    if(before==null)path.moveTo(next.x,next.y) else{val middle=(before.x+next.x)/2;path.cubicTo(middle,before.y,middle,next.y,next.x,next.y)}
                                    if(ordered.size==1||index==selected)drawCircle(palette[line%palette.size],3.dp.toPx(),next)
                                    previous=next
                                }
                            }
                            drawPath(path,palette[line%palette.size],style=Stroke(1.8.dp.toPx()))
                        }
                        if(selected in ordered.indices)drawLine(grid,Offset(x(selected),top),Offset(x(selected),bottom),1.dp.toPx())
                    }
                    ordered.getOrNull(selected)?.let{point->ChartCallout(touchPosition){
                        Column(Modifier.padding(horizontal=10.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                            Text(point.label,fontSize=10.sp,color=muted)
                            labels.forEachIndexed{index,label->Text(label+" "+(if(percent)detailPercent(point.values.getOrNull(index)) else detailCount(point.values.getOrNull(index))),fontSize=11.sp)}
                        }
                    }}
                }
                Row(Modifier.fillMaxWidth().padding(top=8.dp),horizontalArrangement=Arrangement.SpaceBetween){listOf(0,ordered.lastIndex/2,ordered.lastIndex).distinct().forEach{index->Text(ordered[index].label.let{if(it.contains("月"))it else it.takeLast(5).replace('-','/')},fontSize=9.sp,color=muted,maxLines=1)}}
            }
        }
    }
}

@Composable private fun StatisticsActivityCalendar(rows:List<JSONObject>,until:Double?){
    val end=remember(until){until?.let{Instant.ofEpochMilli(it.toLong()).atZone(ZoneId.systemDefault()).toLocalDate()}?:LocalDate.now()}
    val first=remember(end){end.withDayOfYear(1).let{it.minusDays((it.dayOfWeek.value-1).toLong())}}
    val days=remember(first,end){generateSequence(first){it.plusDays(1)}.takeWhile{it<=end}.toList()}
    val values=remember(rows){rows.associate{it.detailText("date") to it.optLong("total")}}
    val maximum=(values.values.maxOrNull()?:0).coerceAtLeast(1)
    val weeks=ceil(days.size/7.0).toInt().coerceAtLeast(1)
    val cellWidth=with(LocalDensity.current){14.dp.toPx()};val cellHeight=with(LocalDensity.current){16.dp.toPx()}
    val scroll=rememberScrollState()
    val ink=MaterialTheme.colors.primary;val empty=detailDivider;val muted=detailMuted
    var selected by remember(rows){mutableIntStateOf(-1)}
    val touchPosition=remember(rows){mutableStateOf(Offset.Zero)}
    LaunchedEffect(end,weeks){scroll.scrollTo(scroll.maxValue)}
    Row(Modifier.fillMaxWidth()){
        Column(Modifier.width(22.dp).height(112.dp),verticalArrangement=Arrangement.SpaceAround){listOf("一","三","五","日").forEach{Text(it,fontSize=9.sp,color=muted)}}
        Box(Modifier.weight(1f).horizontalScroll(scroll)){
            Box(Modifier.width((weeks*14).dp).height(112.dp)){
                Canvas(Modifier.fillMaxSize().semantics{contentDescription="今年每日 Token 活动，按住查看日期与用量"}.nativeChartPress(days,{position,_->
                    touchPosition.value=position
                    val column=(position.x/cellWidth).toInt();val row=(position.y/cellHeight).toInt()
                    selected=(column*7+row).takeIf{row in 0..6&&it in days.indices}?:-1
                },{selected=-1})){
                    days.forEachIndexed{index,day->
                        val total=values[day.toString()]?:0
                        val level=if(total==0L)0f else (.2f+ceil(total.toDouble()/maximum*4).toFloat()*.2f).coerceAtMost(1f)
                        drawRoundRect(if(total==0L)empty else ink.copy(alpha=level),topLeft=Offset(index/7*14.dp.toPx(),index%7*16.dp.toPx()),size=androidx.compose.ui.geometry.Size(11.dp.toPx(),12.dp.toPx()),cornerRadius=androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()))
                    }
                }
                days.getOrNull(selected)?.let{day->ChartCallout(touchPosition){Column(Modifier.padding(horizontal=9.dp,vertical=7.dp),verticalArrangement=Arrangement.spacedBy(3.dp)){Text(day.toString(),fontSize=10.sp,color=muted);Text(nativeTokenCount(values[day.toString()]?:0)+" Token",fontSize=12.sp,fontWeight=FontWeight.Medium)}}}
            }
        }
    }
    Text("每列一周 · 按住查看每日用量",fontSize=10.sp,color=muted)
}
