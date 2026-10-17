package com.localcodex.control
import com.localcodex.control.NativeThemeSurface as Surface

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.DateFormat
import java.util.Date
import java.util.Locale

private val sources=listOf("codex" to "Codex","agy" to "AGY","claude" to "Claude","zcode" to "ZCode","grok" to "Grok","hermes" to "Hermes","deepseek" to "DeepSeek","opencode" to "OpenCode")
private val ranges=listOf("today" to "今天","week" to "本周","month" to "本月","year" to "今年")
private val secondary:Color @Composable get()=MaterialTheme.colors.onSurface.copy(alpha=0.65f)
private val hairline:Color @Composable get()=MaterialTheme.colors.onSurface.copy(alpha=0.07f)
private fun periodDate(value:Long?)=value?.let{
    val day=java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneId.systemDefault()).toLocalDate()
    day.format(java.time.format.DateTimeFormatter.ofPattern(if(day.year==java.time.LocalDate.now().year)"M月d日" else "yyyy年M月d日"))
}?:"—"

@Composable private fun StatisticsCard(modifier:Modifier=Modifier,content:@Composable ColumnScope.()->Unit){
    DashboardCard(modifier){Column(content=content)}
}

@Composable private fun StatisticsFilter(options:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit,modifier:Modifier=Modifier,enabled:Boolean=true){
    val ink=MaterialTheme.colors.onSurface
    BoxWithConstraints(modifier.fillMaxWidth().clip(Radius.Control).background(ink.copy(alpha=0.045f)).padding(4.dp).selectableGroup()){
        val columns=if(maxWidth>=600.dp)8 else 4
        Column(verticalArrangement=Arrangement.spacedBy(3.dp)){options.chunked(columns).forEach{row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(3.dp)){
        row.forEach{(value,label)->
            val active=selected==value
            val interaction=remember{MutableInteractionSource()}
            val pressed by interaction.collectIsPressedAsState()
            Surface(modifier=Modifier.weight(1f),shape=Radius.Control,color=if(active)MaterialTheme.colors.surface else Color.Transparent){
                Text(label,Modifier.clip(Radius.Control).drawBehind{if(pressed)drawRect(ink.copy(alpha=.055f))}.selectable(selected=active,enabled=enabled,role=Role.Tab,interactionSource=interaction,indication=null){if(!active)onSelect(value)}.heightIn(min=48.dp).wrapContentHeight().padding(horizontal=5.dp,vertical=9.dp),fontSize=12.sp,fontWeight=FontWeight.Medium,color=if(active)ink else secondary,maxLines=1,overflow=TextOverflow.Ellipsis,textAlign=androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
        repeat(columns-row.size){Spacer(Modifier.weight(1f))}
        }}}
    }
}

@Composable private fun StatisticsMetric(label:String,value:String,modifier:Modifier=Modifier,color:Color=MaterialTheme.colors.onSurface){
    Column(modifier){
        Text(label,fontSize=11.sp,color=secondary)
        Text(value,Modifier.padding(top=3.dp),fontSize=20.sp,fontWeight=FontWeight.Medium,color=color)
    }
}

@Composable internal fun ConsoleStatisticsContent(state:LocalConsoleUiState,connected:Boolean,onFilter:(String,String,String)->Unit,onAction:(String,String?,Boolean?)->Unit){
    StatisticsFilter(sources,state.source,{onFilter(it,state.range,state.pricing)},enabled=connected,modifier=Modifier.fillMaxWidth())
    Row(Modifier.fillMaxWidth().padding(top=12.dp,bottom=16.dp),verticalAlignment=Alignment.CenterVertically){
        DashboardTabs(ranges,state.range,{onFilter(state.source,it,state.pricing)},enabled=connected)
    }
    val snapshot=state.statistics?.takeIf{it.source==state.source&&it.range==state.range}
    val pricingPending=state.source=="codex"&&snapshot!=null&&snapshot.cost.basis!=state.pricing
    val data=snapshot?.takeIf{it.available}
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        StatisticsCard(Modifier.testTag("consoleOverview")){
            Row(Modifier.fillMaxWidth().height(18.dp),verticalAlignment=Alignment.CenterVertically){
                Text(if(data==null)"Token 总量" else "Token 总量 · ${consoleCount(data.tokens.records)} 条计量记录",Modifier.weight(1f),fontSize=12.sp,color=secondary,maxLines=1,overflow=TextOverflow.Ellipsis)
                if(state.statisticsLoading)NativeRunningTitle("正在读取…",rememberNativeRunningPulse(true),Modifier.padding(start=8.dp),fontSize=11.sp)
            }
            Text(consoleCount(data?.tokens?.total),Modifier.padding(top=5.dp,bottom=3.dp),fontSize=34.sp,fontWeight=FontWeight.SemiBold,letterSpacing=(-0.7).sp)
            Text("${periodDate(snapshot?.since)} — ${periodDate(snapshot?.until)}",fontSize=11.sp,color=secondary)
            Divider(Modifier.padding(vertical=16.dp),color=hairline)
            Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)){
                StatisticsMetric("输入",consoleCount(data?.tokens?.input),Modifier.weight(1f))
                StatisticsMetric("输出",consoleCount(data?.tokens?.output),Modifier.weight(1f))
            }
            Row(Modifier.fillMaxWidth().padding(top=14.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)){
                StatisticsMetric("其中缓存",consoleCount(data?.tokens?.cached),Modifier.weight(1f),AppColor.ChartPurple)
                StatisticsMetric("其中推理",consoleCount(data?.tokens?.reasoning),Modifier.weight(1f))
            }
            if(state.statisticsError.isNotBlank())ConsoleErrorText(state.statisticsError)
            if(state.actionMessage.contains("统计索引"))Text(state.actionMessage,Modifier.padding(top=8.dp),fontSize=12.sp,color=MaterialTheme.colors.primary)
            if(snapshot?.available==false)Text("本机尚未发现此来源的用量记录",Modifier.padding(top=8.dp),fontSize=13.sp,color=secondary)
            else if(!connected&&data==null)Text("连接电脑后查看统计",Modifier.padding(top=8.dp),fontSize=13.sp,color=secondary)
        }
        if(data==null||!data.available)return@Column
        if(data.series.isNotEmpty()||data.modelSeries.isNotEmpty())StatisticsCard(Modifier.testTag("consoleTrend")){ConsoleModelTrend(data)}
        StatisticsCard{
            Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                Text(if(state.source=="opencode")"原生记录金额" else if(state.source=="hermes")"原生费用与估算" else "参考金额",Modifier.weight(1f),fontSize=13.sp,fontWeight=FontWeight.SemiBold)
                Text("USD",fontSize=11.sp,color=secondary)
            }
            Text(if(pricingPending)"—" else if(data.cost.usd==null&&(data.cost.includedRecords?:0)>0)"订阅已包含" else consoleMoney(data.cost.usd),Modifier.padding(top=8.dp),fontSize=28.sp,fontWeight=FontWeight.Medium,letterSpacing=(-0.4).sp)
            if(state.source=="codex")DashboardTabs(listOf("codex" to "Codex 计价","api" to "API 计价"),state.pricing,{onFilter(state.source,state.range,it)},Modifier.padding(top=10.dp),enabled=connected)
            if(state.source=="hermes"||state.source=="deepseek"||state.source=="opencode"){
                val parts=listOfNotNull(data.cost.actualUsd?.let{"原生报告金额 ${consoleMoney(it)}"},data.cost.estimatedUsd?.let{"参考估算 ${consoleMoney(it)}"},data.cost.includedRecords?.takeIf{it>0}?.let{"${consoleCount(it)} 次订阅已包含"})
                Text(parts.joinToString(" · ").ifBlank{"当前时段没有可计价记录"},Modifier.padding(top=10.dp),fontSize=11.sp,color=secondary)
                Text(when(state.source){"opencode"->"OpenCode 本地记录金额";"hermes"->"按原生记录计价";else->"峰谷价与缓存用量估算 · ${data.cost.priceDate}"},Modifier.padding(top=3.dp),fontSize=12.sp,color=secondary)
            }else{
                Text(if(pricingPending)if(state.statisticsLoading)"正在读取所选计价…" else "所选计价未读取，点击刷新重试" else if(data.cost.usd==null)"暂无价格数据" else "参考估算 · ${data.cost.priceDate.ifBlank{"价格日期未记录"}}",Modifier.padding(top=10.dp),fontSize=11.sp,color=secondary)
            }
            if(!pricingPending&&((data.cost.unpricedRecords?:0)>0||(data.cost.partialRecords?:0)>0)){
                val gaps=listOfNotNull(data.cost.unpricedRecords?.takeIf{it>0}?.let{"${consoleCount(it)} 条未计价"},data.cost.partialRecords?.takeIf{it>0}?.let{"${consoleCount(it)} 条费用不完整"})
                Text(gaps.joinToString(" · "),Modifier.padding(top=8.dp),fontSize=11.sp,color=MaterialTheme.colors.error)
            }
        }
        data.activity?.let{activity->StatisticsCard{
            Text("日志活动",fontSize=13.sp,fontWeight=FontWeight.SemiBold)
            Row(Modifier.fillMaxWidth().padding(top=14.dp),horizontalArrangement=Arrangement.spacedBy(16.dp)){
                StatisticsMetric("活跃分钟",consoleCount(activity.minutes),Modifier.weight(1f))
                StatisticsMetric("工具调用",consoleCount(activity.toolCalls),Modifier.weight(1f))
            }
            Text("${consoleCount(activity.sessions)} 个会话 · ${consoleCount(activity.days)} 个活跃日期",Modifier.padding(top=12.dp),fontSize=12.sp,color=secondary)
            Text("活跃分钟按日志事件估算",Modifier.padding(top=4.dp),fontSize=12.sp,color=secondary)
        }}
        StatisticsCard(Modifier.testTag("consoleModelUsage")){
            Text("模型用量",fontSize=13.sp,fontWeight=FontWeight.SemiBold)
            if(data.models.isEmpty())Text("当前时段没有计量记录",Modifier.padding(top=14.dp),fontSize=12.sp,color=secondary)
            val models=remember(data.models){data.models.sortedByDescending{it.tokens.total?:0}}
            val total=(data.tokens.total?:models.sumOf{it.tokens.total?:0}).coerceAtLeast(1)
            models.forEachIndexed{index,model->
                if(index>0)Divider(Modifier.padding(top=14.dp),color=hairline)
                Column(Modifier.padding(top=14.dp)){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top){
                        Text(nativeCompactModelName(model.id),Modifier.weight(1f).padding(end=12.dp),fontSize=13.sp,fontWeight=FontWeight.Medium,maxLines=2,overflow=TextOverflow.Ellipsis)
                        Text(consoleCount(model.tokens.total),fontSize=14.sp,fontWeight=FontWeight.SemiBold)
                    }
                    val fraction=((model.tokens.total?:0).toDouble()/total).coerceIn(0.0,1.0).toFloat()
                    LinearProgressIndicator(fraction,Modifier.fillMaxWidth().padding(top=9.dp,bottom=7.dp).height(3.dp).clip(RoundedCornerShape(2.dp)),color=AppColor.ChartPurple,backgroundColor=hairline)
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){
                        Text("输入 ${consoleCount(model.tokens.input)} · 输出 ${consoleCount(model.tokens.output)}",Modifier.weight(1f),fontSize=12.sp,color=secondary)
                        Text(String.format(Locale.US,"%.1f%%",fraction*100),fontSize=12.sp,color=secondary)
                    }
                    Text(listOfNotNull("${consoleCount(model.tokens.records)} 条记录",if(pricingPending)"金额待读取" else model.usd?.let{consoleMoney(it)},model.includedRecords?.takeIf{it>0&&!pricingPending}?.let{"订阅已包含"},model.unpricedRecords?.takeIf{it>0&&!pricingPending}?.let{"${consoleCount(it)} 条未计价"},model.provider.takeIf{it.isNotBlank()}).joinToString(" · "),Modifier.padding(top=3.dp),fontSize=12.sp,color=secondary)
                }
            }
        }
        if(data.tools.isNotEmpty())StatisticsCard{
            Text("常用工具",fontSize=13.sp,fontWeight=FontWeight.SemiBold)
            data.tools.take(10).forEach{tool->Row(Modifier.fillMaxWidth().padding(top=12.dp)){
                Text(tool.name,Modifier.weight(1f).padding(end=12.dp),fontSize=12.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text(consoleCount(tool.count),fontSize=12.sp,color=secondary)
            }}
        }
        Column(Modifier.padding(horizontal=4.dp,vertical=4.dp)){
            if((data.activityOnlySessions?:0)>0)Text("${consoleCount(data.activityOnlySessions)} 个会话只有活动记录，未计入 Token",fontSize=11.sp,color=secondary)
            if(data.historyOnly)Text("显示已保留的历史计量记录",fontSize=11.sp,color=secondary)
            if(data.periodBasis=="session_last_seen")Text("Hermes 会话累计量按最近计量日期归档；时间段筛选不拆分内部调用",fontSize=11.sp,color=secondary)
            if((data.skippedFiles?:0)>0)Text("${consoleCount(data.skippedFiles)} 个文件或不完整记录未完全读取",fontSize=11.sp,color=secondary)
            if(data.indexError.isNotBlank())ConsoleErrorText(data.indexError)
            val updated=runCatching{DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(Date.from(java.time.Instant.parse(data.updatedAt)))}.getOrDefault("—")
            Text(if(data.indexing)"统计索引正在更新…" else "更新于 $updated",fontSize=12.sp,color=secondary)
            if(state.source=="codex")TextButton(onClick={onAction("index",null,null)},enabled=connected&&!data.indexing&&state.busyAction.isBlank(),modifier=Modifier.testTag("consoleIndex"),contentPadding=PaddingValues(0.dp)){Text(if(state.busyAction=="index")"正在启动…" else "更新统计索引",fontSize=12.sp)}
        }
    }
}

