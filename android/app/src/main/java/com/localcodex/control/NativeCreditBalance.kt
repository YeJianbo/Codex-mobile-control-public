package com.localcodex.control

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

internal fun creditLabel(value:JSONObject?):String=when{
    value?.optBoolean("unlimited")==true->"不限额"
    else->value?.optDouble("balance",Double.NaN)?.takeIf{it.isFinite()&&it>=0}?.let(::creditAmount)?:"—"
}
private fun creditAmount(value:Double)=NumberFormat.getNumberInstance(Locale.CHINA).apply{maximumFractionDigits=2}.format(value)
private data class CreditPoint(val at:Long,val balance:Double)

@Composable internal fun NativeCreditBalance(credits:JSONObject?,trend:JSONArray?,estimate:JSONObject?,start:Long,end:Long,days:Int){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.62f)
    var points by remember(trend,start,end){mutableStateOf(emptyList<CreditPoint>())}
    LaunchedEffect(trend,start,end){points=withContext(Dispatchers.Default){
        (0 until (trend?.length()?:0)).mapNotNull{index->
            val row=trend?.optJSONObject(index)?:return@mapNotNull null
            val balance=row.optDouble("balance",Double.NaN);val at=row.optLong("at")
            if(at !in start..end||!balance.isFinite()||balance<0)null else CreditPoint(at,balance)
        }.distinctBy{it.at}.sortedBy{it.at}.let{rows->if(rows.size<=800)rows else (0 until 800).map{rows[it*(rows.size-1)/799]}}
    }}
    DashboardCard{
        DashboardHeading("Credits")
        Text(creditLabel(credits),fontSize=28.sp,fontWeight=FontWeight.SemiBold)
        Text("官方余额",fontSize=12.sp,color=muted)
        if(points.isNotEmpty()){
            val color=MaterialTheme.colors.primary;val guide=MaterialTheme.colors.onSurface.copy(alpha=.08f)
            val span=(end-start).coerceAtLeast(1).toDouble()
            val low=points.minOf{it.balance};val high=points.maxOf{it.balance};val padding=((high-low)*.12).coerceAtLeast(1.0)
            val bottom=(low-padding).coerceAtLeast(0.0);val top=high+padding
            var selected by remember(points,start,end){mutableStateOf<CreditPoint?>(null)}
            val touch=remember(points,start,end){mutableStateOf(Offset.Zero)}
            Box(Modifier.fillMaxWidth().padding(start=36.dp).height(136.dp)){
                Canvas(Modifier.fillMaxSize().nativeChartPress(points,{position,size->
                    touch.value=position
                    val at=start+(position.x/size.width.coerceAtLeast(1)).coerceIn(0f,1f)*span
                    val index=points.binarySearchBy(at.toLong()){it.at}.let{if(it>=0)it else (-it-1).coerceAtMost(points.lastIndex)}
                    selected=if(index>0&&at-points[index-1].at<points[index].at-at)points[index-1] else points[index]
                },{selected=null})){
                    fun offset(point:CreditPoint)=Offset(((point.at-start)/span*size.width).toFloat(),((top-point.balance)/(top-bottom)*size.height).toFloat())
                    listOf(0f,.5f,1f).forEach{drawLine(guide,Offset(0f,size.height*it),Offset(size.width,size.height*it))}
                    val path=Path();points.forEachIndexed{index,point->val p=offset(point);if(index==0)path.moveTo(p.x,p.y)else path.lineTo(p.x,p.y)}
                    drawPath(path,color,style=Stroke(2.dp.toPx()))
                    points.lastOrNull()?.let{drawCircle(color,3.dp.toPx(),offset(it))}
                    selected?.let{val p=offset(it);drawLine(guide,Offset(p.x,0f),Offset(p.x,size.height));drawCircle(color,4.dp.toPx(),p)}
                }
                selected?.let{point->ChartCallout(touch){Column(Modifier.padding(10.dp)){
                    Text(SimpleDateFormat("M/d HH:mm",Locale.getDefault()).format(Date(point.at)),fontSize=10.sp,color=muted)
                    Text(creditAmount(point.balance)+" Credits",fontSize=12.sp,fontWeight=FontWeight.Medium)
                }}}
            }
            val tickFormat=SimpleDateFormat(if(days==1)"HH:mm" else "M/d",Locale.getDefault())
            Row(Modifier.fillMaxWidth().padding(start=36.dp),horizontalArrangement=Arrangement.SpaceBetween){
                (0..3).forEach{tick->Text(tickFormat.format(Date(start+(end-start)*tick/3)),fontSize=10.sp,color=muted)}
            }
        }else Text("刷新额度后开始记录余额曲线",fontSize=12.sp,color=muted)
        var expanded by remember{mutableStateOf(false)}
        TextButton(onClick={expanded=!expanded},contentPadding=PaddingValues(0.dp)){Text("订阅折合 Credits · 估算"+if(expanded)" −" else " ＋",fontSize=12.sp)}
        if(expanded){
            val windows=estimate?.optJSONArray("windows")
            for(i in 0..1){val row=windows?.optJSONObject(i)
                val amount=row?.optDouble("minimumCredits",Double.NaN)?.takeIf{it.isFinite()}
                Text((row?.optString("name")?:if(i==0)"5h" else "7d")+" 折合下限："+(amount?.let{"≥ "+creditAmount(it)+" Credits"}?:"采集中"),fontSize=13.sp)
            }
            Text("按可归属的官方请求与同一周期的额度变化估算；未记录的设备用量不计入下限。",fontSize=11.sp,color=muted)
        }
    }
}
