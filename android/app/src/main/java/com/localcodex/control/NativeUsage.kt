package com.localcodex.control

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val usageMuted:Color @Composable get()=MaterialTheme.colors.onSurface.copy(alpha=0.65f)
private fun quotaWindowLabel(mins:Double)=when{
    !mins.isFinite()||mins<=0->"额度"
    mins>=1440->"${String.format(Locale.ROOT,"%.1f",mins/1440).removeSuffix(".0")}d 额度"
    else->"${String.format(Locale.ROOT,"%.1f",mins/60).removeSuffix(".0")}h 额度"
}
private fun quotaPlanLabel(value:String):String=when(value.lowercase(Locale.ROOT).replace("-", "").replace("_", "").replace(" ", "")){
    "pro100"->"PRO100"
    "pro200"->"PRO200"
    "prolite"->"PRO Lite"
    "promax"->"PRO Max"
    else->value.uppercase(Locale.ROOT)
}

@Composable internal fun NativeUsage(vm:NativeViewModel){
    val s=vm.state
    val data=s.usage
    Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
        DashboardTabs(listOf("1" to "今天","7" to "近 7 天","30" to "近 30 天"),s.usageDays.toString(),{vm.loadUsage(it.toInt())})
            val quota=data?.optJSONObject("quota")
            val windows=quota?.optJSONArray("windows")
            val quotaWindows=remember(windows){
                val received=(0 until (windows?.length()?:0)).map{windows!!.getJSONObject(it)}
                listOf(300.0,10080.0).map{duration->duration to received.firstOrNull{it.optDouble("durationMins",Double.NaN)==duration}}
            }
            DashboardCard(Modifier.testTag("accountQuotaCard")){
                Row(Modifier.fillMaxWidth().heightIn(min=28.dp),verticalAlignment=Alignment.CenterVertically){
                    Text("账号额度",Modifier.testTag("accountQuotaHeading"),fontSize=16.sp,fontWeight=FontWeight.SemiBold)
                    Box(Modifier.padding(start=8.dp).size(24.dp),contentAlignment=Alignment.Center){
                        if(s.usageLoading)CircularProgressIndicator(Modifier.size(16.dp).testTag("quotaRefreshing").semantics{contentDescription="正在更新额度"},strokeWidth=2.dp)
                    }
                    Spacer(Modifier.weight(1f))
                    quota?.optString("plan")?.takeIf{it.isNotBlank()&&it!="null"}?.let{
                        Text(quotaPlanLabel(it),Modifier.clip(Radius.Inset).background(MaterialTheme.colors.primary.copy(alpha=0.08f)).padding(horizontal=9.dp,vertical=4.dp),fontSize=11.sp,fontWeight=FontWeight.SemiBold,color=MaterialTheme.colors.primary)
                    }
                }
                if(windows==null&&data==null&&s.usageLoading)Text("正在读取账号额度…",color=usageMuted,fontSize=13.sp)
                for(i in quotaWindows.indices){
                    if(i>0)Divider(color=usageMuted.copy(alpha=0.12f))
                    val (mins,window)=quotaWindows[i]
                    val remaining=window?.optDouble("remainingPercent",Double.NaN)?.takeIf{it.isFinite()}?.coerceIn(0.0,100.0)
                    val label=quotaWindowLabel(mins)
                    Row(verticalAlignment=Alignment.CenterVertically){
                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)){
                            Text(if(s.harness=="codex")label else window?.optString("name")?.takeIf{it.isNotBlank()&&it!="null"}?.let{"$it · $label"}?:label,fontSize=13.sp,fontWeight=FontWeight.Medium)
                            val reset=window?.optLong("resetsAt",0)?:0
                            Text(if(reset>0)SimpleDateFormat("M月d日 HH:mm",Locale.getDefault()).format(Date(reset*1000))+" 重置" else "重置时间暂无数据",fontSize=11.sp,color=usageMuted)
                        }
                        Column(horizontalAlignment=Alignment.End){
                            Text(remaining?.let{"${it.toInt()}%"}?:"—",fontSize=28.sp,fontWeight=FontWeight.SemiBold,letterSpacing=(-0.6).sp)
                            Text("剩余",fontSize=11.sp,color=usageMuted)
                        }
                    }
                    if(remaining!=null)LinearProgressIndicator((remaining/100).toFloat(),Modifier.fillMaxWidth().height(6.dp).clip(CircleShape),
                        color=if(remaining<10)MaterialTheme.colors.error else MaterialTheme.colors.primary,backgroundColor=MaterialTheme.colors.onSurface.copy(alpha=0.065f))
                }
                if((windows==null||windows.length()==0)&&!(data==null&&s.usageLoading))Text("暂无账号额度数据",color=usageMuted,fontSize=13.sp)
                if(quota?.optBoolean("stale")==true)Text("实时额度暂不可用，显示上次记录",color=usageMuted,fontSize=12.sp)
            }
        if(data!=null){
            val trend=data.optJSONArray("quotaTrend")
            val (start,now)=remember(data,s.usageDataDays){
                val end=System.currentTimeMillis()
                val begin=if(s.usageDataDays==1)java.util.Calendar.getInstance().apply{set(java.util.Calendar.HOUR_OF_DAY,0);set(java.util.Calendar.MINUTE,0);set(java.util.Calendar.SECOND,0);set(java.util.Calendar.MILLISECOND,0)}.timeInMillis else end-s.usageDataDays*86400000L
                begin to end
            }
            val samples=remember(data,start,now){mutableStateOf<List<QuotaPoint>>(emptyList())}
            LaunchedEffect(samples){
                samples.value=withContext(Dispatchers.Default){(0 until (trend?.length()?:0)).mapNotNull{index->
                val item=trend!!.optJSONObject(index)?:return@mapNotNull null
                val at=item.optLong("at");val remaining=item.optDouble("remainingPercent",Double.NaN)
                if(at !in start..now||!remaining.isFinite())null else QuotaPoint(at,item.optInt("durationMins"),remaining.toFloat())
                }}
            }
            DashboardCard{QuotaTrendChart(samples.value,start,now,s.usageDataDays)}
            if(s.harness=="codex")NativeCreditBalance(quota?.optJSONObject("credits"),data.optJSONArray("creditTrend"),quota?.optJSONObject("subscriptionEstimate"),start,now,s.usageDataDays)
        }
        if(s.usageError.isNotBlank())Text(s.usageError,color=MaterialTheme.colors.error,fontSize=13.sp)
        if(!s.connected)Text("连接电脑后查看用量",color=usageMuted,fontSize=13.sp)
        TextButton(onClick={vm.loadUsage()},enabled=s.connected&&!s.usageLoading,modifier=Modifier.fillMaxWidth()){
            Icon(androidx.compose.ui.res.painterResource(R.drawable.ic_lucide_rotate_cw),null,Modifier.size(15.dp))
            Text("刷新用量",Modifier.padding(start=6.dp),fontSize=13.sp)
        }
    }
}

internal data class QuotaPoint(val at:Long,val durationMins:Int,val remaining:Float)
private const val QUOTA_TREND_MAX_GAP=30*60000L
private fun nearestQuotaTime(timeline:List<Long>,at:Double):Long?{
    if(timeline.isEmpty())return null
    val found=timeline.binarySearch(at.toLong())
    if(found>=0)return timeline[found]
    val insertion=-found-1
    val before=timeline.getOrNull(insertion-1)?:return timeline.first()
    val after=timeline.getOrNull(insertion)?:return before
    return if(at-before<=after-at)before else after
}
private fun quotaPointAt(series:List<QuotaPoint>,at:Long):QuotaPoint?{
    val found=series.binarySearchBy(at){it.at}
    val point=series.getOrNull(if(found>=0)found else -found-2)
    // Match the step curve: use the value already recorded at this time,
    // and leave gaps blank rather than carrying a stale value across them.
    return point?.takeIf{at-it.at<=QUOTA_TREND_MAX_GAP}
}

@Composable internal fun QuotaTrendChart(points:List<QuotaPoint>,start:Long,end:Long,days:Int){
    val groups=remember(points){listOf(300,10080).map{duration->points.filter{it.durationMins==duration}.associateBy{it.at}.values.sortedBy{it.at}}}
    val timeline=remember(groups){groups.flatten().map{it.at}.distinct().sorted()}
    val colors=listOf(AppColor.ChartPurple,MaterialTheme.colors.primary)
    val guide=MaterialTheme.colors.onSurface.copy(alpha=0.07f)
    var selectedAt by remember(points,start,end){mutableStateOf<Long?>(null)}
    val selection=remember(selectedAt,groups){selectedAt?.let{at->groups.map{quotaPointAt(it,at)}}}
    val touchPosition=remember(points,start,end){mutableStateOf(Offset.Zero)}
    DashboardHeading("配额剩余趋势")
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(18.dp)){
        groups.forEachIndexed{index,series->
            Row(Modifier.weight(1f),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                Box(Modifier.size(7.dp).clip(CircleShape).background(colors[index]))
                Text(if(index==0)"5h 额度" else "7d 额度",fontSize=12.sp,color=usageMuted)
                Text(series.lastOrNull()?.let{"${it.remaining.toInt()}%"}?:"—",fontSize=13.sp,fontWeight=FontWeight.SemiBold)
            }
        }
    }
    Row(Modifier.fillMaxWidth()){
        Column(Modifier.width(36.dp).height(136.dp),verticalArrangement=Arrangement.SpaceBetween){
            listOf("100%","50%","0%").forEach{Text(it,fontSize=10.sp,color=usageMuted)}
        }
        Box(Modifier.weight(1f).height(136.dp)){
        Canvas(Modifier.fillMaxSize().testTag("quota-trend").semantics{contentDescription="配额剩余趋势，按住或横向滑动查看明细"}
            .nativeChartPress(Triple(points,start,end),{position,size->
                touchPosition.value=position
                val at=start.toDouble()+(position.x/size.width.coerceAtLeast(1)).coerceIn(0f,1f).toDouble()*(end-start)
                selectedAt=nearestQuotaTime(timeline,at)
            },{selectedAt=null})){
            val width=size.width;val height=size.height;val span=(end-start).coerceAtLeast(1L).toFloat()
            listOf(0f,0.5f,1f).forEach{drawLine(guide,Offset(0f,height*it),Offset(width,height*it),1.dp.toPx())}
            groups.forEachIndexed{index,series->
                val path=Path();var prior:QuotaPoint?=null
                series.forEach{point->
                    val x=(point.at-start)/span*width;val y=(1f-point.remaining.coerceIn(0f,100f)/100f)*height
                    val previous=prior
                    if(previous!=null&&point.at-previous.at<=QUOTA_TREND_MAX_GAP){
                        val previousY=(1f-previous.remaining.coerceIn(0f,100f)/100f)*height
                        path.lineTo(x,previousY);path.lineTo(x,y)
                    }else{
                        // Sparse observations remain visible without implying continuous measurement.
                        if(previous!=null)drawLine(colors[index].copy(alpha=.55f),
                            Offset((previous.at-start)/span*width,(1f-previous.remaining.coerceIn(0f,100f)/100f)*height),Offset(x,y),
                            strokeWidth=1.5.dp.toPx(),pathEffect=PathEffect.dashPathEffect(floatArrayOf(4.dp.toPx(),4.dp.toPx())))
                        path.moveTo(x,y)
                        drawCircle(colors[index],2.5.dp.toPx(),Offset(x,y))
                    }
                    prior=point
                }
                drawPath(path,colors[index],style=Stroke(2.dp.toPx()))
                series.lastOrNull()?.let{drawCircle(colors[index],3.dp.toPx(),Offset((it.at-start)/span*width,(1f-it.remaining.coerceIn(0f,100f)/100f)*height))}
            }
            selectedAt?.let{at->val x=(at-start)/span*width
                drawLine(guide,Offset(x,0f),Offset(x,height),1.dp.toPx())
                selection?.forEachIndexed{index,point->point?.let{
                    drawCircle(colors[index],4.dp.toPx(),Offset(x,(1f-it.remaining.coerceIn(0f,100f)/100f)*height))
                }}
            }
        }
        selectedAt?.let{at->ChartCallout(touchPosition){
            Column(Modifier.padding(horizontal=10.dp,vertical=8.dp).testTag("quotaSelection"),verticalArrangement=Arrangement.spacedBy(3.dp)){
                Text(SimpleDateFormat("M/d HH:mm",Locale.getDefault()).format(Date(at)),fontSize=10.sp,color=usageMuted)
                listOf("5h","7d").forEachIndexed{index,label->
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                        Box(Modifier.size(6.dp).clip(CircleShape).background(colors[index]))
                        Text(label+" 剩余",fontSize=12.sp,color=usageMuted,modifier=Modifier.weight(1f))
                        Text(selection?.getOrNull(index)?.let{"${it.remaining.toInt()}%"}?:"—",fontSize=12.sp,fontWeight=FontWeight.Medium)
                    }
                }
            }
        }}
        }
    }
    val tickFormat=SimpleDateFormat(if(days==1)"HH:mm" else "M/d",Locale.getDefault())
    Row(Modifier.fillMaxWidth().padding(start=36.dp),horizontalArrangement=Arrangement.SpaceBetween){
        (0..3).forEach{tick->Text(tickFormat.format(Date(start+(end-start)*tick/3)),fontSize=10.sp,color=usageMuted)}
    }
    if(points.isEmpty())Text("暂无历史记录",fontSize=11.sp,color=usageMuted)
}
