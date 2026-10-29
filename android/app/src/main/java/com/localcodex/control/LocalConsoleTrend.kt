package com.localcodex.control

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.LocalTime
import kotlin.math.roundToInt

private data class ConsoleTrendBucket(val key:String,val models:Map<String,Long>)
private data class ConsoleTrendData(val hourly:Boolean,val buckets:List<ConsoleTrendBucket>,val models:List<String>)

private fun consoleTrendData(data:ConsoleStatistics):ConsoleTrendData{
    val hourly=data.range=="today"
    val rows=data.modelSeries.filter{!hourly||it.hour.isNotBlank()}
    if(rows.isEmpty()){
        if(hourly)return ConsoleTrendData(true,emptyList(),emptyList())
        return ConsoleTrendData(false,data.series.map{ConsoleTrendBucket(it.date,mapOf("全部模型" to it.total))},listOf("全部模型"))
    }
    val models=rows.groupBy{it.model}.entries.sortedByDescending{it.value.sumOf{point->point.total}}.map{it.key}
    val measured=rows.groupBy{if(hourly)it.hour else it.date}.mapValues{(_,points)->points.groupBy{it.model}.mapValues{(_,records)->records.sumOf{it.total}}}
    val keys=if(hourly){
        val date=rows.first().date
        val lastRecorded=rows.maxOf{it.hour.takeLast(2).toIntOrNull()?:0}
        val last=if(date==LocalDate.now().toString())maxOf(lastRecorded,LocalTime.now().hour) else 23
        (0..last).map{date+"T"+it.toString().padStart(2,'0')}
    }else{
        val dates=measured.keys.sorted()
        val first=LocalDate.parse(dates.first());val last=LocalDate.parse(dates.last())
        generateSequence(first){it.plusDays(1)}.takeWhile{it<=last}.take(366).map{it.toString()}.toList()
    }
    return ConsoleTrendData(hourly,keys.map{ConsoleTrendBucket(it,measured[it].orEmpty())},models)
}

@Composable internal fun ConsoleModelTrend(data:ConsoleStatistics){
    val trend=remember(data){consoleTrendData(data)}
    val buckets=trend.buckets
    val muted=MaterialTheme.colors.onSurface.copy(alpha=0.6f)
    val grid=MaterialTheme.colors.onSurface.copy(alpha=0.07f)
    val palette=listOf(MaterialTheme.colors.primary,AppColor.ChartPurple,Color(0xff259fb8),Color(0xffd08b36),Color(0xff459777),Color(0xffc66c94))
    var focus by remember(data.source,data.range){mutableStateOf<String?>(null)}
    val selected=remember(trend){mutableIntStateOf(-1)}
    val touchPosition=remember(trend){mutableStateOf(Offset.Zero)}
    val focused=focus?.takeIf{it in trend.models}
    val maximum=buckets.maxOfOrNull{it.models.values.maxOrNull()?:0}?.coerceAtLeast(1)?:1
    Text(if(trend.hourly)"每小时 Token" else "每日 Token",fontSize=14.sp,fontWeight=FontWeight.SemiBold)
    if(buckets.isEmpty()){
        Text(if(trend.hourly)"当前服务暂无小时明细，更新电脑网关后刷新" else "暂无用量记录",Modifier.padding(top=12.dp),fontSize=12.sp,color=muted)
        return
    }
    Column(Modifier.padding(top=12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
        trend.models.chunked(2).forEach{row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)){
            row.forEach{model->
                val index=trend.models.indexOf(model)
                Row(Modifier.weight(1f).clip(Radius.Control).background(if(focused==model)palette[index%palette.size].copy(alpha=0.08f) else Color.Transparent)
                    .clickable{focus=if(focus==model)null else model}.padding(horizontal=6.dp,vertical=8.dp),verticalAlignment=Alignment.CenterVertically){
                    Box(Modifier.size(6.dp).background(palette[index%palette.size],CircleShape))
                    Text(nativeCompactModelName(model),Modifier.padding(start=6.dp),fontSize=10.sp,color=if(focused==null||focused==model)MaterialTheme.colors.onSurface else muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                }
            }
            if(row.size==1)Spacer(Modifier.weight(1f))
        }}
    }
    Row(Modifier.fillMaxWidth().padding(top=12.dp)){
        Column(Modifier.width(44.dp).height(168.dp),verticalArrangement=Arrangement.SpaceBetween){
            listOf(nativeTokenCount(maximum),nativeTokenCount(maximum/2),"0").forEach{Text(it,fontSize=9.sp,color=muted,maxLines=1)}
        }
        Column(Modifier.weight(1f)){
            Box(Modifier.fillMaxWidth().height(168.dp)){
                Spacer(Modifier.fillMaxSize().testTag("consoleDailyChart").semantics{contentDescription=if(trend.hourly)"按小时与模型显示 Token，按住或横向滑动查看明细" else "按日期与模型显示 Token，按住或横向滑动查看明细"}
                    .nativeChartPress(trend,{position,size->touchPosition.value=position;selected.intValue=(position.x/size.width.coerceAtLeast(1)*(buckets.size-1)).roundToInt().coerceIn(buckets.indices)},{selected.intValue=-1})
                    .drawWithCache{
                    val top=8.dp.toPx();val bottom=size.height-4.dp.toPx();val height=bottom-top
                    fun x(index:Int)=if(buckets.size==1)size.width/2 else index.toFloat()/(buckets.size-1)*size.width
                    fun y(value:Long)=bottom-(value.toDouble()/maximum*height).toFloat()
                    // Geometry depends on the data and drawing size, not the pressed bucket.
                    val paths=trend.models.map{model->
                        Path().apply{
                            buckets.forEachIndexed{at,bucket->
                                val px=x(at);val py=y(bucket.models[model]?:0)
                                if(at==0)moveTo(px,py) else{
                                    val priorX=x(at-1);val priorY=y(buckets[at-1].models[model]?:0)
                                    val mid=(priorX+px)/2
                                    cubicTo(mid,priorY,mid,py,px,py)
                                }
                            }
                        }
                    }
                    onDrawBehind{
                        val selectedIndex=selected.intValue
                        listOf(top,top+height/2,bottom).forEach{drawLine(grid,Offset(0f,it),Offset(size.width,it),1.dp.toPx())}
                        trend.models.forEachIndexed{index,model->
                            val color=palette[index%palette.size].copy(alpha=if(focused==null||focused==model)1f else 0.15f)
                            drawPath(paths[index],color,style=Stroke(if(focused==model)2.5.dp.toPx() else 1.8.dp.toPx()))
                            if(buckets.size==1)drawCircle(color,3.dp.toPx(),Offset(x(0),y(buckets[0].models[model]?:0)))
                            if(selectedIndex in buckets.indices)drawCircle(color,3.dp.toPx(),Offset(x(selectedIndex),y(buckets[selectedIndex].models[model]?:0)))
                        }
                        if(selectedIndex in buckets.indices)drawLine(grid,Offset(x(selectedIndex),top),Offset(x(selectedIndex),bottom),1.dp.toPx())
                    }
                })
                ConsoleTrendCallout(trend,focused,selected,touchPosition,muted)
            }
            Row(Modifier.fillMaxWidth().padding(top=8.dp),horizontalArrangement=Arrangement.SpaceBetween){
                (0..3).map{it*(buckets.size-1)/3}.distinct().forEach{index->
                    Text(if(trend.hourly)buckets[index].key.takeLast(2)+":00" else buckets[index].key.takeLast(5).replace('-','/'),fontSize=9.sp,color=muted)
                }
            }
        }
    }
}

@Composable private fun ConsoleTrendCallout(trend:ConsoleTrendData,focused:String?,selection:State<Int>,touchPosition:State<Offset>,muted:Color){
    val selected=selection.value
    val buckets=trend.buckets
    buckets.getOrNull(selected)?.let{bucket->
        val shown=(if(focused!=null)listOf(focused) else trend.models.sortedByDescending{bucket.models[it]?:0}.take(3))
        ChartCallout(touchPosition){
            Column(Modifier.padding(horizontal=10.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text(if(trend.hourly)bucket.key.takeLast(2)+":00–"+(bucket.key.takeLast(2).toInt()+1).toString().padStart(2,'0')+":00" else bucket.key,fontSize=10.sp,color=muted)
                shown.forEach{model->Row(verticalAlignment=Alignment.CenterVertically){
                    Text(nativeCompactModelName(model),Modifier.weight(1f).padding(end=8.dp),fontSize=10.sp,maxLines=1,overflow=TextOverflow.Ellipsis)
                    Text(nativeTokenCount(bucket.models[model]?:0),fontSize=11.sp,fontWeight=FontWeight.Medium)
                }}
                if(focused==null&&trend.models.size>3)Text("合计 ${nativeTokenCount(bucket.models.values.sum())}",fontSize=10.sp,color=muted)
            }
        }
    }
}
