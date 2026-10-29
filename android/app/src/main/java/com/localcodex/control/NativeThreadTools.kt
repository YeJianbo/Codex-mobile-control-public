package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder

@Composable internal fun NativeBackgroundTerminals(vm:NativeViewModel){
    val scope=rememberCoroutineScope()
    val thread=vm.state.threadId
    var rows by remember(thread){mutableStateOf(emptyList<JSONObject>())}
    var cursor by remember(thread){mutableStateOf("")}
    var loading by remember(thread){mutableStateOf(false)}
    var stopping by remember(thread){mutableStateOf("")}
    var error by remember(thread){mutableStateOf("")}
    suspend fun load(append:Boolean=false){
        loading=true;error=""
        try{
            val result=vm.threadToolRequest("GET","/api/threads/$thread/background-terminals"+if(append&&cursor.isNotBlank())"?cursor="+URLEncoder.encode(cursor,"UTF-8") else "")
            val data=result.getJSONArray("data");val next=(0 until data.length()).map{data.getJSONObject(it)}
            rows=if(append)(rows+next).distinctBy{it.getString("processId")} else next
            cursor=result.optString("nextCursor").takeUnless{it=="null"}.orEmpty()
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty()}finally{loading=false}
    }
    LaunchedEffect(thread){load()}
    Column(Modifier.fillMaxWidth().testTag("codexBackgroundTerminals"),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("当前会话",Modifier.weight(1f),fontSize=13.sp,color=NativeMuted);ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新后台终端",{scope.launch{load()}},enabled=!loading&&stopping.isBlank())}
        if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
        if(!loading&&rows.isEmpty()&&error.isBlank())Text("没有运行中的后台终端",color=NativeMuted)
        rows.forEach{row->
            val id=row.getString("processId")
            NativeLiquidSurface(Modifier.fillMaxWidth(),shape=Radius.Card,kind=NativeGlassKind.INSET){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
                SelectionContainer{Text(row.optString("command"),fontSize=14.sp)}
                SelectionContainer{Text(nativeDisplayPath(row.optString("cwd")),fontSize=12.sp,color=NativeMuted)}
                val usage=buildList{
                    if(!row.isNull("osPid"))add("PID ${row.optInt("osPid")}")
                    if(!row.isNull("cpuPercent"))add("CPU ${"%.1f".format(row.optDouble("cpuPercent"))}%")
                    if(!row.isNull("rssKb"))add("${"%.1f".format(row.optDouble("rssKb")/1024)} MB")
                }
                if(usage.isNotEmpty())Text(usage.joinToString(" · "),fontSize=12.sp,color=NativeMuted)
                TextButton(onClick={scope.launch{
                    stopping=id;error=""
                    try{vm.threadToolRequest("POST","/api/threads/$thread/background-terminals/terminate",JSONObject().put("processId",id));load()}
                    catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty()}finally{stopping=""}
                }},enabled=stopping.isBlank()&&!loading,modifier=Modifier.testTag("stopBackground:$id")){Text(if(stopping==id)"正在停止…" else "停止")}
            }}
        }
        if(cursor.isNotBlank())TextButton(onClick={scope.launch{load(true)}},enabled=!loading){Text("加载更多")}
        if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error,fontSize=12.sp)
    }
}

@Composable internal fun NativeReviewStart(vm:NativeViewModel){
    val scope=rememberCoroutineScope()
    var type by remember{mutableStateOf("uncommittedChanges")}
    var value by remember(type){mutableStateOf("")}
    var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf("")}
    var started by remember{mutableStateOf(false)}
    Column(Modifier.fillMaxWidth().testTag("nativeReview"),verticalArrangement=Arrangement.spacedBy(12.dp)){
        DashboardTabs(listOf("uncommittedChanges" to "工作区","baseBranch" to "分支","commit" to "提交","custom" to "自定义"),type,{type=it;started=false;error=""},enabled=!busy)
        if(type!="uncommittedChanges")NativeTextEntry(value,{value=it},when(type){"baseBranch"->"基准分支";"commit"->"提交 SHA";else->"审阅要求"})
        NativePrimaryButton(onClick={scope.launch{
            busy=true;error=""
            val target=JSONObject().put("type",type)
            if(type!="uncommittedChanges")target.put(when(type){"baseBranch"->"branch";"commit"->"sha";else->"instructions"},value.trim())
            try{vm.threadToolRequest("POST","/api/threads/${vm.state.threadId}/review",target);started=true}
            catch(e:CancellationException){throw e}catch(e:Exception){error=e.message.orEmpty()}finally{busy=false}
        }},enabled=vm.state.connected&&!vm.state.running&&!busy&&!started&&(type=="uncommittedChanges"||value.isNotBlank())){Text(if(busy)"正在启动…" else if(started)"审阅已开始" else "开始审阅")}
        if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error,fontSize=12.sp)
    }
}
