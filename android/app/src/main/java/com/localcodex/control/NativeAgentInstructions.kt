package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.net.URLEncoder

@Composable internal fun NativeAgentInstructions(vm:NativeViewModel,initialAgent:String,threadId:String,onBack:()->Unit){
    val scope=rememberCoroutineScope()
    var agent by remember(threadId){mutableStateOf(initialAgent)}
    var menu by remember{mutableStateOf(false)}
    var content by remember{mutableStateOf("")}
    var saved by remember{mutableStateOf("")}
    var revision by remember{mutableStateOf("")}
    var path by remember{mutableStateOf("")}
    var loading by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf("")}
    var notice by remember{mutableStateOf("")}
    var confirm by remember{mutableStateOf(false)}
    var nextAgent by remember{mutableStateOf("")}
    val dirty=content!=saved
    fun route():String{
        val kind=if(threadId.isBlank())"global" else "project"
        return "/api/agent-instructions?scope=$kind&agent=$agent"+if(threadId.isBlank())"" else "&threadId="+URLEncoder.encode(threadId,"UTF-8")
    }
    suspend fun load(){
        loading=true;error="";notice="";revision=""
        try{
            val result=vm.threadToolRequest("GET",route())
            content=result.getString("content");saved=content;revision=result.getString("revision");path=result.getString("file")
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"读取失败"}
        finally{loading=false}
    }
    fun leaveOrSelect(value:String){
        if(dirty){nextAgent=value;confirm=true}else if(value.isEmpty())onBack() else agent=value
    }
    LaunchedEffect(agent,threadId){load()}
    NativeManagementPage(if(threadId.isBlank())"助手全局指令" else "工作区指令","",{leaveOrSelect("")},modifier=Modifier.testTag("agentInstructionsPage"),actions={
        TextButton(onClick={scope.launch{
            loading=true;error="";notice=""
            try{
                val result=vm.threadToolRequest("PUT",route(),JSONObject().put("content",content).put("revision",revision))
                saved=content;revision=result.getString("revision");notice="已保存"
            }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"保存失败"}
            finally{loading=false}
        }},enabled=!loading&&revision.isNotBlank()&&dirty){Text("保存")}
    }){
        Column(Modifier.weight(1f).fillMaxWidth().padding(top=LocalNativeManagementTopInset.current).padding(horizontal=16.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            if(threadId.isBlank())Box{
                TextButton(onClick={menu=true},enabled=!loading){Text(nativeAgentName(agent)+" ▾")}
                DropdownMenu(expanded=menu,onDismissRequest={menu=false}){
                    Column(Modifier.heightIn(max=400.dp).verticalScroll(rememberScrollState())){
                        nativeHarnesses.forEach{item->DropdownMenuItem(onClick={menu=false;if(item!=agent)leaveOrSelect(item)}){Text(nativeAgentName(item))}}
                    }
                }
            }
            if(path.isNotBlank()){
                val normalized=path.replace('\\','/')
                Text(normalized.substringAfterLast('/'),fontSize=15.sp,color=NativeInk,maxLines=1,overflow=TextOverflow.Ellipsis)
                Text(if(threadId.isBlank())normalized.substringBeforeLast('/',"") else "工作区 · "+normalized.substringBeforeLast('/',"")+" · 同项目会话共享",fontSize=12.sp,color=NativeMuted,maxLines=1,overflow=TextOverflow.Ellipsis)
            }
            if(error.isNotBlank()){
                Text(error,color=MaterialTheme.colors.error,fontSize=13.sp)
                TextButton(onClick={if(dirty){nextAgent="reload";confirm=true}else scope.launch{load()}},enabled=!loading){Text("重新载入")}
            }
            if(notice.isNotBlank())Text(notice,color=NativeMuted,fontSize=13.sp)
            Box(Modifier.fillMaxWidth().weight(1f).clip(Radius.Field).background(NativeWash).padding(14.dp)){
                if(content.isEmpty())Text("输入 Markdown 指令",color=NativeMuted,fontSize=15.sp)
                BasicTextField(value=content,onValueChange={content=it;notice=""},modifier=Modifier.fillMaxSize().verticalScroll(rememberScrollState()).testTag("agentInstructionsEditor"),enabled=!loading&&revision.isNotBlank(),textStyle=LocalTextStyle.current.copy(color=NativeInk,fontSize=15.sp),cursorBrush=SolidColor(MaterialTheme.colors.primary))
            }
        }
    }
    if(confirm)NativeAlertDialog(onDismissRequest={confirm=false},title={Text("放弃未保存的修改？")},
        confirmButton={TextButton(onClick={confirm=false;if(nextAgent.isEmpty())onBack() else if(nextAgent=="reload")scope.launch{load()} else agent=nextAgent}){Text("放弃")}},
        dismissButton={TextButton(onClick={confirm=false}){Text("继续编辑")}})
}
