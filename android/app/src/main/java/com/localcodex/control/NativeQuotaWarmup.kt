package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

@Composable internal fun NativeQuotaWarmup(vm:NativeViewModel){
    val connected=vm.state.connected
    val active=LocalManagementPageActive.current
    var data by remember(vm,connected){mutableStateOf<JSONObject?>(null)}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf("")}
    var revision by remember{mutableStateOf(0)}
    val scope=rememberCoroutineScope()
    LaunchedEffect(vm,connected,active){
        if(connected&&active)while(true){
            val readRevision=revision
            if(!busy)try{val value=vm.managementRequest("/api/mobile-management/statistics/quota/warmup");if(readRevision==revision&&!busy){data=value;error=""}}
                catch(cancelled:CancellationException){throw cancelled}
                catch(reason:Exception){error=reason.message.orEmpty()}
            delay(15000)
        }
    }
    fun save(on:Boolean,selected:List<String>,plan:JSONObject?=data?.optJSONObject("fiveHourSchedule"),model:String=data?.optString("model").orEmpty()){
        if(busy||!connected||data==null)return
        revision++;busy=true;error=""
        scope.launch{
            try{data=vm.managementRequest("/api/mobile-management/statistics/quota/warmup",JSONObject().put("enabled",on).put("windows",JSONArray(selected)).put("model",model).apply{if(plan!=null)put("fiveHourSchedule",plan)})}
            catch(cancelled:CancellationException){throw cancelled}
            catch(reason:Exception){error=reason.message.orEmpty()}
            finally{busy=false}
        }
    }
    NativeQuotaWarmupContent(data,connected,busy,error,save={on,selected->save(on,selected)},saveSchedule={hours->
        val windows=data?.optJSONArray("windows")?.let{array->(0 until array.length()).map{array.getString(it)}}?:listOf("weekly")
        save(data?.optBoolean("enabled")==true,windows,hours)
    },saveModel={model->
        val windows=data?.optJSONArray("windows")?.let{array->(0 until array.length()).map{array.getString(it)}}?:listOf("weekly")
        save(data?.optBoolean("enabled")==true,windows,model=model)
    })
}

@Composable internal fun NativeQuotaWarmupPage(vm:NativeViewModel,back:()->Unit){
    NativeManagementPage("自动预热","",back){
        Column(Modifier.weight(1f).nativeManagementScroll(androidx.compose.foundation.rememberScrollState()).padding(16.dp)){
            DashboardCard{NativeQuotaWarmup(vm)}
        }
    }
}

@Composable internal fun NativeQuotaWarmupContent(data:JSONObject?,connected:Boolean,busy:Boolean,error:String,
    saveSchedule:(JSONObject)->Unit={},
    saveModel:(String)->Unit={},
    save:(Boolean,List<String>)->Unit,
){
    val enabled=data?.optBoolean("enabled")==true
    val windows=data?.optJSONArray("windows")?.let{array->(0 until array.length()).map{array.getString(it)}}?:listOf("weekly")
    Column(Modifier.fillMaxWidth().testTag("quotaWarmup"),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Column(Modifier.weight(1f)){
                Text("自动预热",fontSize=14.sp,fontWeight=FontWeight.Medium)
                Text("额度重置后，空闲时发送一次最小请求",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
            }
            DashboardSwitch(checked=enabled,onCheckedChange={save(it,windows)},enabled=connected&&data!=null&&!busy,modifier=Modifier.testTag("quotaWarmupToggle"))
        }
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            listOf("fiveHour" to "5 小时","weekly" to "7 天").forEach{(name,label)->
                val selected=name in windows
                OutlinedButton(onClick={if(!selected||windows.size>1)save(enabled,if(selected)windows-name else windows+name)},
                    enabled=connected&&data!=null&&!busy,
                    colors=ButtonDefaults.outlinedButtonColors(backgroundColor=if(selected)MaterialTheme.colors.primary.copy(alpha=.1f) else MaterialTheme.colors.surface),
                    contentPadding=PaddingValues(horizontal=14.dp,vertical=4.dp),modifier=Modifier.testTag("warmupWindow:$name")){
                    Text(label,fontSize=12.sp,color=if(selected)MaterialTheme.colors.primary else MaterialTheme.colors.onSurface)
                }
            }
        }
        var modelMenu by remember{mutableStateOf(false)}
        val model=data?.optString("model").orEmpty()
        val models=data?.optJSONArray("models")
        Box{
            OutlinedButton(onClick={modelMenu=true},enabled=connected&&data!=null&&!busy){
                Text("暖机模型："+if(model.isBlank())"默认 · 6.1 Sol" else nativeCompactModelName(model,"codex"),fontSize=12.sp)
                Icon(painterResource(R.drawable.ic_lucide_chevron_down),null,Modifier.padding(start=6.dp).size(14.dp))
            }
            NativeDropdownMenu(modelMenu,{modelMenu=false}){
                DropdownMenuItem(onClick={modelMenu=false;saveModel("")}){Text("默认 · 6.1 Sol")}
                for(i in 0 until (models?.length()?:0)){
                    val choice=models!!.getJSONObject(i)
                    DropdownMenuItem(onClick={modelMenu=false;saveModel(choice.getString("id"))}){Text(nativeCompactModelName(choice.optString("name").ifBlank{choice.getString("id")},"codex"))}
                }
                if(model.isNotBlank()&&(0 until (models?.length()?:0)).none{models!!.getJSONObject(it).optString("id")==model}){
                    DropdownMenuItem(onClick={},enabled=false){Text("所选模型已不可用")}
                }
            }
        }
        if("fiveHour" in windows){
            NativeFiveHourWarmupSchedule(data?.optJSONObject("fiveHourSchedule"),connected&&data!=null&&!busy,saveSchedule)
            val dateFormat=java.text.SimpleDateFormat("M月d日 HH:mm",java.util.Locale.getDefault())
            data?.optJSONObject("resets")?.optLong("fiveHour")?.takeIf{it>0}?.let{at->
                Text("当前 5h 重置："+dateFormat.format(java.util.Date(at*1000)),fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
            }
            data?.optLong("nextFiveHourAt")?.takeIf{it>0}?.let{at->
                Text("下个计划："+dateFormat.format(java.util.Date(at)),fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
            }
        }
        val label=when(data?.optString("status")){
            "disabled"->"已关闭";"waiting"->"等待额度重置";"waiting-idle"->"已重置，等待任务结束"
            "waiting-time"->"等待下一次暖机时间";"waiting-reset"->"等待当前 5h 窗口重置"
            "sending"->"正在预热";"complete"->"本轮已预热";"covered"->"本轮已有正常请求"
            "uncertain"->"上次预热结果未确认";"no-account"->"请先登录 Codex";"unavailable"->"暂无所选窗口数据";"error"->"读取失败"
            else->""
        }
        val shownError=error.ifBlank{data?.optString("lastError").orEmpty().takeUnless{it=="null"}.orEmpty()}
        if(shownError.isNotBlank())Text(shownError,fontSize=11.sp,color=MaterialTheme.colors.error)
        else if(label.isNotBlank())Text(label,fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
        data?.optJSONObject("lastAttempt")?.optLong("at")?.takeIf{it>0}?.let{at->
            Text("最近记录："+java.text.SimpleDateFormat("M月d日 HH:mm",java.util.Locale.getDefault()).format(java.util.Date(at)),
                fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
        }
    }
}

@Composable private fun NativeFiveHourWarmupSchedule(settings:JSONObject?,editable:Boolean,save:(JSONObject)->Unit){
    val defaults=listOf("04:00","09:00","14:00","19:00")
    val remoteTimes=settings?.optJSONArray("times")?.let{array->(0 until array.length()).map{array.getString(it)}}?:defaults
    val remoteKey=remoteTimes.joinToString(",")
    val on=settings?.optBoolean("enabled")==true
    val zone=settings?.optString("timeZone").orEmpty().ifBlank{java.util.TimeZone.getDefault().id}
    var draft by rememberSaveable(remoteKey){mutableStateOf(remoteKey)}
    val times=draft.split(',')
    val valid=times.isNotEmpty()&&times.size<=24&&times.distinct().size==times.size&&times.all{it.matches(Regex("([01]\\d|2[0-3]):[0-5]\\d"))}
    fun body(enabled:Boolean,values:List<String>)=JSONObject().put("enabled",enabled).put("times",JSONArray(values)).put("timeZone",zone)
    Divider(Modifier.padding(vertical=8.dp),color=MaterialTheme.colors.onSurface.copy(alpha=.08f))
    Row(verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.weight(1f)){
            Text("5 小时定时暖机",fontSize=14.sp,fontWeight=FontWeight.Medium)
            Text("每天按指定时刻启动周期",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
        }
        DashboardSwitch(on,{save(body(it,remoteTimes))},enabled=editable)
    }
    if(on){
        Text("例如 04:00、09:00、14:00、19:00，可覆盖到午夜。",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.7f))
        val fieldColors=TextFieldDefaults.textFieldColors(backgroundColor=MaterialTheme.colors.onSurface.copy(alpha=.04f),focusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent,unfocusedIndicatorColor=androidx.compose.ui.graphics.Color.Transparent)
        times.forEachIndexed{index,time->
            Row(verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(6.dp)){
                TextField(time,{value->draft=times.mapIndexed{i,old->if(i==index)value.filter{it.isDigit()||it==':'}.take(5) else old}.joinToString(",")},label={Text("暖机时间 "+(index+1))},placeholder={Text("04:00")},singleLine=true,enabled=editable,shape=Radius.Control,colors=fieldColors,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Ascii),modifier=Modifier.weight(1f))
                IconButton(onClick={draft=times.filterIndexed{i,_->i!=index}.joinToString(",")},enabled=editable&&times.size>1){Icon(painterResource(R.drawable.ic_lucide_x),"删除暖机时间",Modifier.size(18.dp))}
            }
        }
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            TextButton(onClick={
                val last=times.lastOrNull()?.takeIf{it.matches(Regex("([01]\\d|2[0-3]):[0-5]\\d"))}
                val next=last?.let{val minute=(it.take(2).toInt()*60+it.takeLast(2).toInt()+300)%1440;"%02d:%02d".format(java.util.Locale.US,minute/60,minute%60)}
                val available=next?.takeIf{it !in times}?: (0..23).map{"%02d:00".format(java.util.Locale.US,it)}.firstOrNull{it !in times}
                if(available!=null)draft=(times+available).joinToString(",")
            },enabled=editable&&times.size<24){Text("添加时间")}
            TextButton(onClick={draft=defaults.joinToString(",")},enabled=editable){Text("使用 04 / 09 / 14 / 19")}
        }
        if(valid){
            val preview=times.sorted().joinToString(" · "){time->val minute=time.take(2).toInt()*60+time.takeLast(2).toInt()+300;time+"–"+(if(minute>=1440)"次日 " else "")+"%02d:%02d".format(java.util.Locale.US,(minute/60)%24,minute%60)}
            Text(preview,fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
        }else Text("请输入不重复的时间，格式为 HH:mm",fontSize=11.sp,color=MaterialTheme.colors.error)
        Text("当前窗口未重置时等待实际重置；运行中先等待任务结束。",fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
        Text(zone,fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
        OutlinedButton(onClick={save(body(true,times))},enabled=editable&&valid&&times.sorted()!=remoteTimes.sorted()){Text("保存时间")}
    }
}
