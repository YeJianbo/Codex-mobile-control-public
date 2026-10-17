package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

private data class RelayModelDraft(val id:String="",val name:String="",val context:String="272000")
private data class RelayProviderDraft(
    val id:String="",val name:String="",val baseUrl:String="",val apiKey:String="",val hasKey:Boolean=false,
    val originalUrl:String="",val enabled:Boolean=false,val models:List<RelayModelDraft> = listOf(RelayModelDraft()),
    val discovered:List<String> = emptyList(),val discoveryApproved:Boolean=false,
)
private data class RelayConfirmation(val action:String,val title:String,val detail:String,val body:JSONObject,val migration:Boolean=false)
private data class RelayModelSettingsDraft(val id:String,val displayName:String,val context:String,val enabled:Boolean,val official:Boolean,val route:String="")

/** Credentials use the connected gateway; no console token or stored API key enters the UI. */
@Composable internal fun NativeRelayConfiguration(vm:NativeViewModel,back:()->Unit){
    val active=LocalManagementPageActive.current
    val connected=vm.state.connected
    val source=vm.accountsState
    val state=if(source.service=="codex-relay")source else NativeAccountsState(service="codex-relay")
    var editor by remember(vm.state.address){mutableStateOf<RelayProviderDraft?>(null)}
    var confirmation by remember(vm.state.address){mutableStateOf<RelayConfirmation?>(null)}
    var pending by remember{mutableStateOf("")}
    var previousResult by remember{mutableStateOf<JSONObject?>(null)}
    var profile by remember{mutableStateOf<JSONObject?>(null)}
    var modelTest by remember{mutableStateOf<JSONObject?>(null)}
    var includeOfficial by remember{mutableStateOf(false)}
    var routeEnabled by remember{mutableStateOf(false)}
    var routeTransport by remember{mutableStateOf("auto")}
    fun send(action:String,body:JSONObject=JSONObject()){
        if(!connected||state.busy.isNotBlank())return
        previousResult=state.result;pending=action;vm.accountAction("codex-relay",action,body)
    }
    LaunchedEffect(vm,connected,active,vm.state.address){if(connected&&active)vm.loadAccounts("codex-relay")}
    LaunchedEffect(state.data){
        state.data?.let{data->includeOfficial=data.optJSONObject("config")?.let{if(it.optBoolean("owned"))!it.optBoolean("relayOnly") else null}?:data.optJSONObject("routingPreferences")?.optBoolean("includeOfficial")?:false}
    }
    LaunchedEffect(state.result,state.busy){
        val result=state.result
        if(state.busy.isBlank()&&result!=null&&result!==previousResult&&pending.isNotBlank()){
            when(pending){
                "save-provider"->{editor=null}
                "discover-models"->{editor=editor?.copy(discovered=relayStrings(result.optJSONArray("models")))}
                "routing-preview"->{
                    val running=result.optBoolean("running")
                    val action=if(routeTransport=="http")"routing-http" else if(routeEnabled)"takeover" else "direct"
                    val body=JSONObject().put("confirm",true).put("restart",running).put("includeOfficial",includeOfficial)
                    val title=if(routeTransport=="http")"切换官方 HTTPS" else if(routeEnabled)"连接中转路由" else "恢复官方直连"
                    val migration=result.optJSONObject("migration")
                    confirmation=RelayConfirmation(action,title,buildString{
                        append("目标模型：${result.optString("defaultModel","未指定")}（${result.optInt("modelCount")} 个可用）。")
                        if(migration!=null)append("\n将同步 ${migration.optInt("threads")} 个会话、${migration.optInt("files")} 个文件。")
                        append(if(running)"\nCodex 正在运行，继续将关闭 Codex、中断当前任务，迁移后重新启动。" else "\n请关闭 Codex 和独立 CLI，迁移完成前不要启动。")
                    },body,migration=true)
                }
                "profile"->{profile=result}
                "test-model"->{modelTest=result}
            }
            pending=""
        }
    }
    NativeRelayConfigurationContent(state,connected,editor,includeOfficial,back,
        refresh={vm.loadAccounts("codex-relay")},edit={editor=it},
        onOfficial={includeOfficial=it},
        onAction={action,body->
            when(action){
                "delete-provider"->confirmation=RelayConfirmation(action,"删除中转供应商","将删除此供应商及其专属模型、保存的密钥。默认模型或其他模型仍引用它时，需要先解除引用。",body)
                "model"->confirmation=RelayConfirmation(action,"设置默认模型","将电脑上的 Codex 默认模型改为 ${body.optString("id")}。",body)
                "test-model"->confirmation=RelayConfirmation(action,"测试模型","电脑将向 ${body.optString("id")} 当前配置的上游发送一次真实模型请求，可能产生用量。",body)
                "routing-preview"->{routeEnabled=body.optBoolean("enabled");routeTransport=body.optString("transport","auto");send(action,body)}
                else->send(action,body)
            }
        })
    confirmation?.let{request->
        var acknowledged by remember(request){mutableStateOf(false)}
        AlertDialog(onDismissRequest={if(state.busy.isBlank())confirmation=null},title={Text(request.title)},text={Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
            Text(request.detail)
            if(request.migration)Row(verticalAlignment=Alignment.CenterVertically){Checkbox(acknowledged,{acknowledged=it});Text("确认关闭相关进程并迁移会话")}
        }},confirmButton={TextButton(onClick={confirmation=null;send(request.action,request.body)},enabled=connected&&state.busy.isBlank()&&(!request.migration||acknowledged)){Text("确认")}},dismissButton={TextButton(onClick={confirmation=null}){Text("取消")}})
    }
    profile?.let{result->AlertDialog(onDismissRequest={profile=null},title={Text("独立中转配置")},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(result.optString("message").ifBlank{"配置已生成，桌面默认连接方式保持原设置。"})
        listOf("command","minimumVersion").forEach{key->result.optString(key).takeIf{it.isNotBlank()}?.let{Text(it,fontSize=12.sp)}}
    }},confirmButton={TextButton(onClick={profile=null}){Text("完成")}})}
    modelTest?.let{result->AlertDialog(onDismissRequest={modelTest=null},title={Text(if(result.optBoolean("completed"))"模型请求完成" else "模型请求未完成")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text("HTTP ${result.optInt("status")} · ${result.optLong("ms")} ms")
        result.accountText("text").takeIf{it.isNotBlank()}?.let{Text(it,fontSize=13.sp)}
    }},confirmButton={TextButton(onClick={modelTest=null}){Text("完成")}})}
}

@Composable private fun NativeRelayConfigurationContent(
    state:NativeAccountsState,connected:Boolean,editor:RelayProviderDraft?,includeOfficial:Boolean,back:()->Unit,
    refresh:()->Unit,edit:(RelayProviderDraft?)->Unit,onOfficial:(Boolean)->Unit,onAction:(String,JSONObject)->Unit,
){
    val busy=state.loading||state.busy.isNotBlank()
    val data=state.data
    val config=data?.optJSONObject("config")
    val providers=relayObjects(data?.optJSONArray("providers"))
    val models=relayObjects(data?.optJSONArray("models"))
    var search by remember{mutableStateOf("")}
    var modelEditor by remember{mutableStateOf<RelayModelSettingsDraft?>(null)}
    var modelSaving by remember{mutableStateOf(false)}
    var modelSaveResult by remember{mutableStateOf<JSONObject?>(null)}
    LaunchedEffect(state.result,state.busy,state.error){
        if(modelSaving&&state.busy.isBlank()){
            if(state.error.isNotBlank())modelSaving=false
            else if(state.result!=null&&state.result!==modelSaveResult){modelSaving=false;modelEditor=null}
        }
    }
    NativeManagementPage(if(editor==null)"Codex 中转配置" else if(editor.id.isBlank())"添加中转" else "编辑中转","",if(editor!=null)({edit(null)}) else back,
        modifier=Modifier.testTag("codexRelayConfiguration"),actions={TextButton(onClick=refresh,enabled=connected&&!busy&&editor==null){Text(if(state.loading)"加载中…" else "刷新")}}){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
            if(!connected)item{Text("连接电脑后管理中转服务")}
            if(state.error.isNotBlank())item{Text(state.error,color=MaterialTheme.colors.error,fontSize=13.sp)}
            if(state.message.isNotBlank())item{Text(state.message,color=MaterialTheme.colors.primary,fontSize=13.sp)}
            if(state.busy.isNotBlank())item{LinearProgressIndicator(Modifier.fillMaxWidth())}
            if(editor!=null){
                item{RelayProviderEditor(editor,connected&&!busy,edit,onAction)}
            }else{
                item{DashboardCard{
                    Text("模型连接方式",fontWeight=FontWeight.SemiBold)
                    Text(when{config?.optBoolean("relayOnly")==true->"仅中转";config?.optBoolean("owned")==true->"官方与中转";config?.optBoolean("officialHttp")==true->"官方 HTTPS 直连";else->"官方直连"},fontSize=13.sp)
                    Text("默认模型：${config?.optString("model").orEmpty().ifBlank{"未设置"}}",fontSize=12.sp)
                    Row(verticalAlignment=Alignment.CenterVertically){Checkbox(includeOfficial,onOfficial,enabled=connected&&!busy);Text("中转菜单同时显示官方模型",fontSize=13.sp)}
                    Button(onClick={onAction("routing-preview",JSONObject().put("enabled",true).put("includeOfficial",includeOfficial).put("transport","auto"))},enabled=connected&&!busy){Text("连接中转路由")}
                    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                        OutlinedButton(onClick={onAction("routing-preview",JSONObject().put("enabled",false).put("includeOfficial",false).put("transport","auto"))},enabled=connected&&!busy){Text("官方直连")}
                        OutlinedButton(onClick={onAction("routing-preview",JSONObject().put("enabled",false).put("includeOfficial",false).put("transport","http"))},enabled=connected&&!busy){Text("官方 HTTPS")}
                    }
                    TextButton(onClick={onAction("profile",JSONObject())},enabled=connected&&!busy){Text("生成 CLI 独立中转配置")}
                }}
                item{DashboardCard{
                    Text("中转兼容性",fontWeight=FontWeight.SemiBold)
                    val compatibility=data?.optJSONObject("compatibility")
                    val filterImages=compatibility?.optBoolean("filterImages")==true
                    val filterWeb=compatibility?.optBoolean("filterWebSearch")==true
                    Row(verticalAlignment=Alignment.CenterVertically){Text("过滤 Image 工具声明",Modifier.weight(1f),fontSize=13.sp);Switch(filterImages,{onAction("compatibility",JSONObject().put("filterImages",it).put("filterWebSearch",filterWeb))},enabled=connected&&!busy)}
                    Row(verticalAlignment=Alignment.CenterVertically){Text("过滤 WebSearch 工具声明",Modifier.weight(1f),fontSize=13.sp);Switch(filterWeb,{onAction("compatibility",JSONObject().put("filterImages",filterImages).put("filterWebSearch",it))},enabled=connected&&!busy)}
                    Text("只过滤中转请求中的工具声明，保留图片输入和普通函数工具。",fontSize=12.sp)
                }}
                item{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("中转供应商",Modifier.weight(1f),fontWeight=FontWeight.SemiBold);TextButton(onClick={onAction("import-providers",JSONObject())},enabled=connected&&!busy){Text("导入")};TextButton(onClick={edit(RelayProviderDraft())},enabled=connected&&!busy){Text("添加")}}}
                items(providers,key={it.optString("id")}){provider->DashboardCard(Modifier.testTag("relayProvider:${provider.optString("id")}")){
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(provider.optString("name"),Modifier.weight(1f),fontWeight=FontWeight.SemiBold);Text(if(provider.optBoolean("enabled"))"已启用" else "已停用",fontSize=12.sp)}
                    Text(provider.optString("baseUrl"),fontSize=12.sp)
                    Text("${if(provider.optBoolean("hasKey"))"已保存密钥" else "未填写密钥"} · ${provider.optJSONArray("models")?.length()?:0} 个模型",fontSize=12.sp)
                    Row{TextButton(onClick={edit(relayDraft(provider))},enabled=connected&&!busy){Text("编辑")};TextButton(onClick={onAction("delete-provider",JSONObject().put("id",provider.optString("id")))},enabled=connected&&!busy){Text("删除",color=MaterialTheme.colors.error)}}
                }}
                if(providers.isEmpty()&&!state.loading)item{Text("尚未添加中转供应商",fontSize=13.sp)}
                item{Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Row{TextButton(onClick={onAction("refresh-catalog",JSONObject())},enabled=connected&&!busy){Text("更新官方模型")};TextButton(onClick={onAction("rebuild-catalog",JSONObject())},enabled=connected&&!busy){Text("重建目录")}}
                    OutlinedTextField(search,{search=it},label={Text("筛选模型")},singleLine=true,modifier=Modifier.fillMaxWidth())
                }}
                items(models.filter{search.isBlank()||it.optString("id").contains(search,true)||it.optString("name").contains(search,true)},key={it.optString("id")}){model->DashboardCard{
                    val id=model.optString("id")
                    val index=models.indexOf(model)
                    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(model.optString("name",id),Modifier.weight(1f),fontSize=14.sp,fontWeight=FontWeight.Medium);Switch(model.optBoolean("enabled"),{onAction("toggle-model",JSONObject().put("id",id).put("enabled",it))},enabled=connected&&!busy)}
                    Text(id,fontSize=11.sp)
                    Text("上下文 ${model.optLong("context")} · ${if(model.optBoolean("official"))"官方模型" else "中转模型"}",fontSize=12.sp)
                    model.optJSONObject("route")?.let{route->Text("请求转发：${route.optString("providerId")} / ${route.optString("model")}",fontSize=12.sp)}
                    if(id==config?.optString("model"))Text("当前默认",color=MaterialTheme.colors.primary,fontSize=12.sp)
                    Row(horizontalArrangement=Arrangement.spacedBy(2.dp)){
                        TextButton(onClick={modelEditor=RelayModelSettingsDraft(id,model.optString("name"),model.optLong("context").toString(),model.optBoolean("enabled"),model.optBoolean("official"),model.optJSONObject("route")?.let{"${it.optString("providerId")}::${it.optString("model")}"}.orEmpty())},enabled=connected&&!busy){Text("设置")}
                        TextButton(onClick={onAction("test-model",JSONObject().put("id",id))},enabled=connected&&!busy&&model.optBoolean("enabled")&&!(config?.optBoolean("relayOnly")==true&&model.optBoolean("official"))){Text("测试")}
                        TextButton(onClick={onAction("model",JSONObject().put("id",id))},enabled=connected&&!busy&&model.optBoolean("enabled")&&id!=config?.optString("model")){Text("设为默认")}
                    }
                    Row{
                        if(index>0)TextButton(onClick={onAction("model-order",JSONObject().put("id",id).put("beforeId",models[index-1].optString("id")))},enabled=connected&&!busy){Text("上移")}
                        if(index>=0&&index<models.lastIndex)TextButton(onClick={onAction("model-order",JSONObject().put("id",id).put("afterId",models[index+1].optString("id")))},enabled=connected&&!busy){Text("下移")}
                    }
                }}
            }
        }
    }
    modelEditor?.let{draft->RelayModelSettingsDialog(draft,providers,connected&&!busy,state.error,{modelEditor=it},{modelEditor=null}){body->modelSaveResult=state.result;modelSaving=true;onAction("model-settings",body)}}
}

@Composable private fun RelayModelSettingsDialog(draft:RelayModelSettingsDraft,providers:List<JSONObject>,enabled:Boolean,apiError:String,edit:(RelayModelSettingsDraft)->Unit,dismiss:()->Unit,save:(JSONObject)->Unit){
    var error by remember(draft.id){mutableStateOf("")}
    var picker by remember{mutableStateOf(false)}
    val choices=providers.filter{it.optBoolean("enabled")&&it.optBoolean("hasKey")}.flatMap{provider->relayStrings(provider.optJSONArray("models")).filter{provider.optJSONObject("modelSettings")?.optJSONObject(it)?.optBoolean("enabled",true)!=false}.map{model->"${provider.optString("id")}::$model" to "${provider.optString("name")} / $model"}}
    AlertDialog(onDismissRequest=dismiss,title={Text("模型设置")},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Text(draft.id,fontSize=12.sp)
        OutlinedTextField(draft.displayName,{edit(draft.copy(displayName=it))},label={Text("菜单显示名")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(draft.context,{edit(draft.copy(context=it.filter(Char::isDigit)))},label={Text("上下文长度")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
        Row(verticalAlignment=Alignment.CenterVertically){Checkbox(draft.enabled,{edit(draft.copy(enabled=it))},enabled=enabled);Text("启用此模型")}
        if(draft.official){
            Text("请求来源",fontSize=12.sp)
            Box{
                OutlinedButton(onClick={picker=true},enabled=enabled){Text(if(draft.route.isBlank())"OpenAI 官方上游" else choices.firstOrNull{it.first==draft.route}?.second?:draft.route)}
                DropdownMenu(picker,{picker=false},modifier=Modifier.heightIn(max=280.dp)){
                    DropdownMenuItem(onClick={edit(draft.copy(route=""));picker=false}){Text("OpenAI 官方上游")}
                    choices.forEach{(id,label)->
                        DropdownMenuItem(onClick={edit(draft.copy(route=id));picker=false}){Text(label)}
                    }
                }
            }
            Text("官方名称可转发至已启用的中转模型。请先连接中转路由，再保存转发设置。",fontSize=12.sp)
        }
        Text("上下文与菜单设置在共享后端重新加载后生效，实际可用长度取决于上游。",fontSize=12.sp)
        TextButton(onClick={save(JSONObject().put("id",draft.id).put("settings",JSONObject()))},enabled=enabled){Text("恢复默认设置")}
        if(error.isNotBlank())Text(error,color=MaterialTheme.colors.error,fontSize=12.sp)
        if(apiError.isNotBlank())Text(apiError,color=MaterialTheme.colors.error,fontSize=12.sp)
    }},confirmButton={TextButton(onClick={
        error=when{draft.displayName.length>160->"显示名最多 160 字符";(draft.context.toIntOrNull()?:0) !in 4096..2000000->"上下文长度范围为 4096–2000000";else->""}
        if(error.isBlank())save(JSONObject().put("id",draft.id).put("connect",draft.route.isNotBlank()).put("settings",JSONObject().put("displayName",draft.displayName.trim()).put("contextWindow",draft.context.toInt()).put("enabled",draft.enabled).apply{
            if(draft.route.isNotBlank()){val parts=draft.route.split("::",limit=2);put("route",JSONObject().put("providerId",parts[0]).put("model",parts[1]))}
        }))
    },enabled=enabled){Text("保存")}},dismissButton={TextButton(onClick=dismiss){Text("取消")}})
}

@Composable private fun RelayProviderEditor(draft:RelayProviderDraft,enabled:Boolean,onChange:(RelayProviderDraft?)->Unit,onAction:(String,JSONObject)->Unit){
    var validation by remember{mutableStateOf("")}
    val changedUrl=draft.hasKey&&draft.originalUrl.trimEnd('/')!=draft.baseUrl.trim().trimEnd('/')
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
        OutlinedTextField(draft.name,{onChange(draft.copy(name=it))},label={Text("名称")},enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(draft.baseUrl,{onChange(draft.copy(baseUrl=it,discoveryApproved=false,discovered=emptyList()))},label={Text("API 地址")},placeholder={Text("https://api.example.com/v1")},enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(draft.apiKey,{onChange(draft.copy(apiKey=it,discoveryApproved=false))},label={Text("API 密钥")},placeholder={Text(if(draft.hasKey)"留空保留已保存密钥" else "填写 API Key")},visualTransformation=PasswordVisualTransformation(),enabled=enabled,singleLine=true,modifier=Modifier.fillMaxWidth())
        if(changedUrl)Text("地址已改变，需要填写新地址的密钥。",fontSize=12.sp,color=MaterialTheme.colors.error)
        Row(verticalAlignment=Alignment.CenterVertically){Checkbox(draft.enabled,{onChange(draft.copy(enabled=it))},enabled=enabled);Text("保存并启用")}
        Text("模型",fontWeight=FontWeight.SemiBold)
        draft.models.forEachIndexed{index,model->DashboardCard{
            fun change(value:RelayModelDraft){onChange(draft.copy(models=draft.models.toMutableList().also{it[index]=value}))}
            OutlinedTextField(model.id,{change(model.copy(id=it))},label={Text("模型 ID")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
            OutlinedTextField(model.name,{change(model.copy(name=it))},label={Text("显示名称（可选）")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
            OutlinedTextField(model.context,{change(model.copy(context=it.filter(Char::isDigit)))},label={Text("上下文长度")},singleLine=true,enabled=enabled,modifier=Modifier.fillMaxWidth())
            TextButton(onClick={onChange(draft.copy(models=draft.models.filterIndexed{i,_->i!=index}))},enabled=enabled&&draft.models.size>1){Text("移除此模型")}
        }}
        OutlinedButton(onClick={onChange(draft.copy(models=draft.models+RelayModelDraft()))},enabled=enabled){Text("添加自定义模型")}
        Row(verticalAlignment=Alignment.CenterVertically){Checkbox(draft.discoveryApproved,{onChange(draft.copy(discoveryApproved=it))},enabled=enabled);Text("允许电脑向此 API 地址发送密钥并读取模型列表",fontSize=12.sp)}
        OutlinedButton(onClick={onAction("discover-models",JSONObject().put("id",draft.id).put("baseUrl",draft.baseUrl.trim()).apply{if(draft.apiKey.isNotBlank())put("apiKey",draft.apiKey)})},enabled=enabled&&draft.discoveryApproved&&(!changedUrl||draft.apiKey.isNotBlank())){Text("拉取模型列表")}
        draft.discovered.filter{id->draft.models.none{it.id==id}}.forEach{id->TextButton(onClick={onChange(draft.copy(models=draft.models.filter{it.id.isNotBlank()}+RelayModelDraft(id=id)))},enabled=enabled){Text("添加 $id")}}
        if(validation.isNotBlank())Text(validation,color=MaterialTheme.colors.error,fontSize=13.sp)
        Button(onClick={
            val ids=draft.models.map{it.id.trim()}
            validation=when{
                draft.name.isBlank()->"请填写中转名称"
                relayUrlError(draft.baseUrl)!=null->relayUrlError(draft.baseUrl).orEmpty()
                changedUrl&&draft.apiKey.isBlank()->"请填写新地址的 API 密钥"
                draft.enabled&&!draft.hasKey&&draft.apiKey.isBlank()->"启用前请填写 API 密钥"
                ids.any{it.isBlank()||it.length>200||it.contains("::")}->"请填写有效的模型 ID"
                ids.distinct().size!=ids.size->"模型 ID 不能重复"
                draft.models.any{(it.context.toIntOrNull()?:0) !in 4096..2000000}->"上下文长度范围为 4096–2000000"
                else->""
            }
            if(validation.isBlank())onAction("save-provider",JSONObject().apply{
                if(draft.id.isNotBlank())put("id",draft.id)
                put("name",draft.name.trim());put("baseUrl",draft.baseUrl.trim());put("enabled",draft.enabled);put("contextWindow",draft.models.first().context.toInt())
                if(draft.apiKey.isNotBlank())put("apiKey",draft.apiKey)
                put("models",JSONArray(ids));put("modelSettings",JSONObject().apply{draft.models.forEach{put(it.id.trim(),JSONObject().put("displayName",it.name.trim()).put("contextWindow",it.context.toInt()))}})
            })
        },enabled=enabled,modifier=Modifier.fillMaxWidth().testTag("saveRelayProvider")){Text("保存配置")}
    }
}

private fun relayDraft(provider:JSONObject):RelayProviderDraft{
    val settings=provider.optJSONObject("modelSettings")
    val context=provider.optInt("contextWindow",272000)
    return RelayProviderDraft(id=provider.optString("id"),name=provider.optString("name"),baseUrl=provider.optString("baseUrl"),originalUrl=provider.optString("baseUrl"),hasKey=provider.optBoolean("hasKey"),enabled=provider.optBoolean("enabled"),models=relayStrings(provider.optJSONArray("models")).map{id->val model=settings?.optJSONObject(id);RelayModelDraft(id,model?.optString("displayName").orEmpty(),(model?.optInt("contextWindow",context)?:context).toString())}.ifEmpty{listOf(RelayModelDraft())})
}
internal fun relayObjects(array:JSONArray?):List<JSONObject> = if(array==null)emptyList() else (0 until array.length()).mapNotNull{array.optJSONObject(it)}
internal fun relayStrings(array:JSONArray?):List<String> = if(array==null)emptyList() else (0 until array.length()).mapNotNull{array.optString(it).takeIf(String::isNotBlank)}
internal fun relayUrlError(value:String):String?{
    val uri=runCatching{java.net.URI(value.trim())}.getOrNull()?:return "请输入完整 API 地址"
    if(uri.scheme !in listOf("https","http")||uri.host.isNullOrBlank()||uri.rawUserInfo!=null||uri.rawQuery!=null||uri.rawFragment!=null)return "API 地址必须为无凭据、查询参数或片段的 HTTP(S) 地址"
    if(uri.scheme=="http"&&uri.host !in listOf("localhost","127.0.0.1","[::1]","::1"))return "远程 API 地址必须使用 HTTPS"
    return null
}
