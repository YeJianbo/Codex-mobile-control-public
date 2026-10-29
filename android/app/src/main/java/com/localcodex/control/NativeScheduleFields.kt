package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

internal val nativeWeekdays=listOf("MO" to "一","TU" to "二","WE" to "三","TH" to "四","FR" to "五","SA" to "六","SU" to "日")
internal fun nativeRulePart(rule:String,key:String)=Regex("(?:^|;)$key=([^;]+)").find(rule.removePrefix("RRULE:"))?.groupValues?.get(1).orEmpty()
internal fun nativeAutomationRuleLabel(rule:String):String{
    val frequency=nativeRulePart(rule,"FREQ")
    val interval=nativeRulePart(rule,"INTERVAL").ifBlank{"1"}
    val hour=nativeRulePart(rule,"BYHOUR").toIntOrNull()
    val minute=nativeRulePart(rule,"BYMINUTE").toIntOrNull()
    if(frequency in listOf("MINUTELY","HOURLY")&&!rule.contains("BY"))return "每 $interval "+if(frequency=="MINUTELY")"分钟" else "小时"
    if(hour==null||minute==null)return if(!rule.contains("BY")&&frequency in listOf("DAILY","WEEKLY"))"每 $interval "+if(frequency=="DAILY")"天" else "周" else "自定义时间"
    val time="%02d:%02d".format(hour,minute)
    if(frequency=="DAILY")return (if(interval=="1")"每天" else "每 $interval 天")+" $time"
    if(frequency=="WEEKLY"){
        val days=nativeRulePart(rule,"BYDAY").split(',')
        val names=nativeWeekdays.filter{it.first in days}.joinToString("、"){it.second}
        if(names.isBlank())return "自定义时间"
        return (if(interval=="1"&&days.toSet()==setOf("MO","TU","WE","TH","FR"))"工作日" else (if(interval=="1")"每周" else "每 $interval 周")+names)+" $time"
    }
    return "自定义时间"
}

@Composable internal fun NativeClockFields(title:String,hour:String,minute:String,onHour:(String)->Unit,onMinute:(String)->Unit,enabled:Boolean,modifier:Modifier=Modifier){
    Column(modifier,verticalArrangement=Arrangement.spacedBy(6.dp)){
        Text(title,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
        Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
            val colors=TextFieldDefaults.textFieldColors(backgroundColor=MaterialTheme.colors.onSurface.copy(alpha=.04f),focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent)
            TextField(hour,{onHour(it.filter(Char::isDigit).take(2))},label={Text("时")},singleLine=true,enabled=enabled,shape=Radius.Control,colors=colors,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),modifier=Modifier.weight(1f))
            Text(":")
            TextField(minute,{onMinute(it.filter(Char::isDigit).take(2))},label={Text("分")},singleLine=true,enabled=enabled,shape=Radius.Control,colors=colors,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),modifier=Modifier.weight(1f))
        }
    }
}

internal fun nativeScheduleBody(mode:String,frequency:String,interval:String,hour:String,minute:String,days:String):JSONObject?{
    val calendar=mode!="interval"
    val count=if(mode=="interval"||mode=="custom")interval.toIntOrNull() else 1
    if(count==null||count !in 1..10080)return null
    val actual=when(mode){"daily"->"DAILY";"weekdays","weekly"->"WEEKLY";else->frequency}
    if(actual !in (if(calendar)listOf("DAILY","WEEKLY") else listOf("MINUTELY","HOURLY")))return null
    val body=JSONObject().put("frequency",actual).put("interval",count)
    if(calendar){
        val h=hour.toIntOrNull();val m=minute.toIntOrNull()
        if(h==null||h !in 0..23||m==null||m !in 0..59)return null
        body.put("hour",h).put("minute",m)
        if(actual=="WEEKLY"){
            val selected=if(mode=="weekdays")nativeWeekdays.take(5).map{it.first} else nativeWeekdays.map{it.first}.filter{it in days.split(',')}
            if(selected.isEmpty())return null
            body.put("days",JSONArray(selected))
        }
    }
    return body
}
