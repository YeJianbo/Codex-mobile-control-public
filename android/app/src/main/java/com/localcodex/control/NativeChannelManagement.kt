package com.localcodex.control
import androidx.compose.ui.text.style.TextOverflow

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.net.URLEncoder

internal data class ManagedChannelAccount(
    val id:String,val channel:String,val label:String,val projectPath:String,val state:String,val configured:Boolean,
    val appId:String,val ownerId:String,val transport:String,val lastError:String,val bindingCount:Int,val authorizedCount:Int=0
)
internal data class ManagedChannelLogin(val accountId:String,val generation:Long,val status:String,val qrImage:String,val expiresAt:Long?){
    val active:Boolean get()=status in listOf("wait","scaned","scaned_but_redirect","need_verifycode")
}
internal data class ManagedChannelOperation(
    val kind:String,val action:String,val accountId:String="",val projectPath:String="",val appId:String="",val appSecret:String=""
)
internal data class ManagedChannelPairing(val accountId:String,val code:String,val expiresAt:Long)
internal data class ChannelManagementState(
    val accounts:List<ManagedChannelAccount> = emptyList(),val available:Set<String> = emptySet(),val selected:Map<String,String> = emptyMap(),
    val loaded:Boolean=false,val loading:Boolean=false,val busy:String="",val error:String="",val message:String="",
    val login:ManagedChannelLogin?=null,val loginWorking:Boolean=false,val confirmation:ManagedChannelOperation?=null,val pairing:ManagedChannelPairing?=null
)
private fun JSONObject.channelText(key:String)=if(isNull(key))"" else optString(key)
private fun JSONObject.channelRows(key:String):List<JSONObject>{val array=optJSONArray(key)?:return emptyList();return (0 until array.length()).mapNotNull{array.optJSONObject(it)}}
private fun channelAccount(row:JSONObject):ManagedChannelAccount{
    val details=row.optJSONObject("details")?:JSONObject()
    return ManagedChannelAccount(row.channelText("id"),row.channelText("channel"),row.channelText("label"),row.channelText("projectPath"),row.channelText("state"),
        details.optBoolean("configured"),details.channelText("appId"),details.channelText("ownerId"),details.channelText("transport"),details.channelText("lastError"),row.optInt("bindingCount"),details.optInt("authorizedCount"))
}
private fun channelEndpoint(id:String,action:String)="/api/mobile-management/channels/accounts/"+URLEncoder.encode(id,"UTF-8")+"/"+action

private class ChannelManagementController(private val scope:CoroutineScope,private val request:suspend(String,JSONObject?)->JSONObject){
    var state by mutableStateOf(ChannelManagementState());private set
    private var refreshJob:Job?=null
    private var operationJob:Job?=null
    private var verifyJob:Job?=null
    private var refreshTicket=0
    private var loginGeneration=0L
    private val loginMutex=Mutex()
    fun cancel(){refreshTicket++;refreshJob?.cancel();operationJob?.cancel();verifyJob?.cancel();state=state.copy(loading=false,busy="",loginWorking=false)}
    private fun accept(raw:JSONObject){
        val accounts=raw.channelRows("accounts").map(::channelAccount)
        state=state.copy(accounts=accounts,available=raw.channelRows("channels").filter{it.optBoolean("available")}.map{it.channelText("kind")}.toSet(),loaded=true,loading=false,
            selected=state.selected.filter{(kind,id)->accounts.any{it.channel==kind&&it.id==id}})
    }
    fun refresh(silent:Boolean=false){
        if(state.busy.isNotBlank())return
        refreshJob?.cancel();val ticket=++refreshTicket
        if(!silent)state=state.copy(loading=true,error="")
        refreshJob=scope.launch{
            try{val result=request("/api/mobile-management/channels",null);if(ticket==refreshTicket)accept(result)}
            catch(error:CancellationException){throw error}catch(error:Exception){if(ticket==refreshTicket)state=state.copy(loading=false,error=error.message?:"读取通道状态失败")}
        }
    }
    fun select(kind:String,id:String){if(kind=="weixin")verifyJob?.cancel();state=state.copy(selected=state.selected+(kind to id),confirmation=null,login=if(kind!="weixin"||state.login?.accountId==id)state.login else null,error="",message="")}
    fun dismiss(){state=state.copy(confirmation=null)}
    fun action(operation:ManagedChannelOperation){
        if(state.busy.isNotBlank())return
        state=state.copy(error="",message="")
        if(operation.action in listOf("save-project","pair"))perform(operation) else state=state.copy(confirmation=operation)
    }
    private suspend fun ensure(operation:ManagedChannelOperation):String{
        if(operation.accountId.isNotBlank())return operation.accountId
        val result=request("/api/mobile-management/channels/accounts",JSONObject().put("channel",operation.kind).put("label",if(operation.kind=="qq")"QQ 官方机器人" else "微信"))
        return result.optJSONObject("account")?.channelText("id")?.takeIf{it.isNotBlank()}?:throw IllegalStateException("创建通道账号失败")
    }
    fun confirm(){val operation=state.confirmation?:return;perform(operation)}
    private fun perform(operation:ManagedChannelOperation){
        if(state.busy.isNotBlank())return
        refreshTicket++;refreshJob?.cancel()
        val changesLogin=operation.action=="login"||(operation.accountId==state.login?.accountId&&operation.action!="save-project")
        if(changesLogin)verifyJob?.cancel()
        state=state.copy(loading=false,busy=operation.kind+":"+operation.action,confirmation=null,error="",message="",login=if(changesLogin)null else state.login)
        operationJob=scope.launch{
            try{
                val id=ensure(operation)
                if(operation.action in listOf("save-project","connect-qq","connect","login")){
                    request(channelEndpoint(id,"settings"),JSONObject().put("projectPath",operation.projectPath))
                }
                when(operation.action){
                    "pair"->{val result=request(channelEndpoint(id,"pair"),JSONObject());state=state.copy(pairing=ManagedChannelPairing(id,result.getString("code"),result.getLong("expiresAt")))}
                    "revoke-access"->{request(channelEndpoint(id,"revoke-access"),JSONObject().put("confirm",true));state=state.copy(pairing=null,message="QQ 授权已清除，原会话保留")}
                    "save-project"->state=state.copy(message=if(operation.projectPath.isBlank())"已切换为通用助理" else "工作目录已保存")
                    "connect-qq"->{
                        if(operation.appSecret.isNotBlank())request(channelEndpoint(id,"credentials"),JSONObject().put("appId",operation.appId.trim()).put("appSecret",operation.appSecret.trim()))
                        request(channelEndpoint(id,"disconnect"),JSONObject())
                        request(channelEndpoint(id,"connect"),JSONObject())
                        state=state.copy(message="QQ 连接请求已提交")
                    }
                    "connect"->{request(channelEndpoint(id,"disconnect"),JSONObject());request(channelEndpoint(id,"connect"),JSONObject());state=state.copy(message="连接请求已提交")}
                    "login"->{
                        state=state.copy(login=null)
                        request(channelEndpoint(id,"disconnect"),JSONObject())
                        val result=request(channelEndpoint(id,"login"),JSONObject().put("refresh",true))
                        state=state.copy(login=login(result,id,++loginGeneration),selected=state.selected+(operation.kind to id))
                    }
                    "disconnect"->{request(channelEndpoint(id,"disconnect"),JSONObject());state=state.copy(message="通道已断开",login=if(state.login?.accountId==id)null else state.login)}
                    "remove"->{request(channelEndpoint(id,"remove"),JSONObject().put("confirm",true));state=state.copy(message="登录凭据和通道绑定已清除",login=if(state.login?.accountId==id)null else state.login)}
                }
                state=state.copy(busy="");refresh(silent=true)
            }catch(error:CancellationException){throw error}catch(error:Exception){state=state.copy(busy="",error=error.message?:"通道操作未完成");refresh(silent=true)}
        }
    }
    private fun login(raw:JSONObject,id:String,generation:Long)=ManagedChannelLogin(id,generation,raw.channelText("status"),raw.channelText("qrImage"),if(raw.isNull("expiresAt"))null else raw.optLong("expiresAt"))
    suspend fun pollLogin(verifyCode:String?=null){
        loginMutex.withLock{
            val current=state.login?:return@withLock
            if(!current.active)return@withLock
            state=state.copy(loginWorking=true)
            try{
                val body=JSONObject();if(!verifyCode.isNullOrBlank())body.put("verifyCode",verifyCode.trim())
                val result=request(channelEndpoint(current.accountId,"login"),body)
                if(state.login?.generation!=current.generation)return@withLock
                val next=login(result,current.accountId,current.generation)
                if(next.status=="confirmed"){
                    request(channelEndpoint(current.accountId,"connect"),JSONObject())
                    state=state.copy(message="微信登录成功，连接请求已提交")
                    refresh(silent=true)
                }
                state=state.copy(login=next)
            }catch(error:CancellationException){throw error}catch(error:Exception){
                if(state.login?.generation==current.generation)state=state.copy(error=error.message?:"检查扫码状态失败",login=current.copy(status="error"))
            }finally{state=state.copy(loginWorking=false)}
        }
    }
    fun verify(code:String){if(!state.loginWorking)verifyJob=scope.launch{pollLogin(code)}}
    fun cancelLogin(){verifyJob?.cancel();state=state.copy(login=null,error="")}
}

@Composable internal fun NativeChannelManagement(vm:NativeViewModel,back:()->Unit){
    val scope=rememberCoroutineScope()
    val controller=remember(vm,vm.state.address){ChannelManagementController(scope){route,body->vm.managementRequest(route,body)}}
    val connected=vm.state.connected
    val active=LocalManagementPageActive.current
    val owner=LocalLifecycleOwner.current
    var foreground by remember(owner){mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))}
    DisposableEffect(owner){val observer=LifecycleEventObserver{_,_->foreground=owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)};owner.lifecycle.addObserver(observer);onDispose{owner.lifecycle.removeObserver(observer)}}
    LaunchedEffect(controller,connected,active,foreground){
        if(connected&&active&&foreground){controller.refresh();while(true){delay(4000);controller.refresh(silent=true)}}else controller.cancel()
    }
    LaunchedEffect(controller,connected,active,foreground,controller.state.login?.generation){
        if(connected&&active&&foreground){
            while(controller.state.login?.active==true){
                delay(2500)
                if(controller.state.login?.status!="need_verifycode")controller.pollLogin()
            }
        }
    }
    DisposableEffect(controller){onDispose{controller.cancel()}}
    NativeChannelManagementContent(controller.state,connected,vm.state.projects,back,{controller.refresh()},controller::select,controller::action,
        controller::dismiss,controller::confirm,controller::verify,controller::cancelLogin)
}

@Composable internal fun NativeChannelManagementContent(
    state:ChannelManagementState,connected:Boolean,projects:List<Project>,back:()->Unit,refresh:()->Unit,
    select:(String,String)->Unit,action:(ManagedChannelOperation)->Unit,dismiss:()->Unit,confirm:()->Unit,verify:(String)->Unit,cancelLogin:()->Unit
){
    val enabled=connected&&!state.loading&&state.busy.isBlank()
    NativeManagementPage("QQ / 微信","",back,modifier=Modifier.testTag("channelManagement"),actions={ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",refresh,enabled=enabled)}){
        Column(Modifier.weight(1f).fillMaxWidth().nativeManagementScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
            if(!connected)Text("连接电脑后管理消息通道")
            if(state.loading||state.busy.isNotBlank())LinearProgressIndicator(Modifier.fillMaxWidth())
            if(state.error.isNotBlank())Text(state.error,color=MaterialTheme.colors.error,modifier=Modifier.testTag("channelManagementError"))
            if(state.message.isNotBlank())Text(state.message,fontSize=13.sp,modifier=Modifier.testTag("channelManagementResult"))
            for(kind in listOf("qq","weixin")){
                val accounts=state.accounts.filter{it.channel==kind}
                val account=accounts.firstOrNull{it.id==state.selected[kind]}?:accounts.firstOrNull()
                NativeChannelPlatformCard(kind,account,accounts,kind in state.available,state.loaded,enabled,projects,state.login,state.loginWorking,state.pairing,
                    {select(kind,it)},action,verify,cancelLogin)
            }
            Text("发送文字开始任务。支持 /状态、/结果、/停止、/新会话；审批在手机或电脑控制台处理。",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
        }
    }
    state.confirmation?.let{operation->
        val account=state.accounts.firstOrNull{it.id==operation.accountId}
        val name=if(operation.kind=="qq")"QQ" else "微信"
        val title=when(operation.action){"revoke-access"->"清除 QQ 授权";"remove"->"清除${name}登录";"disconnect"->"断开$name";"login"->"微信扫码连接";"connect-qq"->"保存并连接 QQ";else->"重新连接$name"}
        NativeAlertDialog(onDismissRequest=dismiss,title={Text(title)},text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
            Text(when(operation.action){
                "revoke-access"->"所有 QQ 账号将失去任务和结果访问权限，需要重新用绑定码授权。原会话记录保留。"
                "remove"->"将移除此通道账号、电脑上保存的登录凭据和 ${account?.bindingCount?:0} 个会话绑定。已有会话保留；再次使用需要重新登录。"
                "disconnect"->"断开后将停止从${name}接收任务和回传结果。已启动的任务继续在电脑上运行。"
                "login"->"将断开微信通道并生成登录二维码。扫码确认后，可从微信与助理对话。"
                "connect-qq"->"将保存机器人配置并连接 QQ，可从 QQ 与助理对话并接收任务结果。"
                else->"将重新连接$name，并接收已绑定会话的任务结果。"
            })
            if(operation.action=="connect-qq"&&account?.configured==true&&operation.appId!=account.appId)Text("AppID 已改变，原有平台身份和会话绑定会清除。",fontSize=13.sp)
            if(operation.action=="login"&&account?.configured==true)Text("扫码确认后将替换此通道保存的微信登录；更换微信身份会清除原绑定。",fontSize=13.sp)
            if(operation.projectPath.isNotBlank())Text("工作目录：${nativeDisplayPath(operation.projectPath)}",fontSize=13.sp)
        }},confirmButton={TextButton(onClick=confirm,modifier=Modifier.testTag("confirmChannelOperation")){Text(when(operation.action){"revoke-access"->"清除授权";"remove"->"清除登录";"disconnect"->"断开";"login"->"生成二维码";else->"连接"},color=if(operation.action in listOf("remove","revoke-access"))MaterialTheme.colors.error else MaterialTheme.colors.primary)}},dismissButton={TextButton(onClick=dismiss){Text("取消")}})
    }
}

@Composable private fun NativeChannelPlatformCard(
    kind:String,account:ManagedChannelAccount?,accounts:List<ManagedChannelAccount>,available:Boolean,loaded:Boolean,enabled:Boolean,
    projects:List<Project>,login:ManagedChannelLogin?,loginWorking:Boolean,pairing:ManagedChannelPairing?,select:(String)->Unit,action:(ManagedChannelOperation)->Unit,
    verify:(String)->Unit,cancelLogin:()->Unit
){
    var projectPath by remember(account?.id){mutableStateOf(account?.projectPath.orEmpty())}
    var appId by remember(account?.id){mutableStateOf(account?.appId.orEmpty())}
    // Secrets stay in this form only until the user submits a concrete operation.
    var appSecret by remember(account?.id){mutableStateOf("")}
    var accountMenu by remember{mutableStateOf(false)}
    val ready=enabled&&loaded&&available
    val uri=LocalUriHandler.current
    val name=if(kind=="qq")"QQ 官方机器人" else "微信"
    val operation={type:String->ManagedChannelOperation(kind,type,account?.id.orEmpty(),projectPath,appId,appSecret)}
    DashboardCard(Modifier.testTag("channelPlatform:$kind")){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
            Text(name,Modifier.weight(1f),fontSize=17.sp,fontWeight=FontWeight.SemiBold)
            Text(when{!loaded->"读取中";!available->"不可用";account==null->"未配置";account.transport=="reconnecting"->"正在重连";else->when(account.state){"connected"->"已连接";"connecting"->"正在连接";"error"->"连接失败";"unavailable"->"不可用";else->"未连接"}},fontSize=12.sp,color=if(account?.state=="connected")MaterialTheme.colors.primary else MaterialTheme.colors.onSurface.copy(alpha=.6f))
        }
        if(accounts.size>1)Box{
            OutlinedButton(onClick={accountMenu=true},enabled=ready){Text(account?.label?:"选择通道账号")}
            NativeDropdownMenu(accountMenu,{accountMenu=false}){accounts.forEach{item->DropdownMenuItem(onClick={select(item.id);accountMenu=false}){Text(item.label)}}}
        }
        if(account?.lastError?.isNotBlank()==true)Text(account.lastError,color=MaterialTheme.colors.error,fontSize=13.sp)
        if(account!=null){
            Text((if(account.configured)"已保存登录配置" else "尚未保存登录配置")+" · ${account.bindingCount} 个会话绑定",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
            if(kind=="weixin"&&account.ownerId.isNotBlank())Text("微信身份：${account.ownerId}",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
        }
        ChannelProjectChoice(projectPath,projects,ready){projectPath=it}
        OutlinedButton(onClick={action(operation("save-project"))},enabled=ready&&projectPath!=account?.projectPath.orEmpty()){Text("保存会话设置")}
        if(kind=="qq"){
            if(account!=null)NativeQqAuthorization(account.id,account.authorizedCount,pairing,ready,{action(operation("pair"))},{action(operation("revoke-access"))})
            OutlinedTextField(appId,{appId=it.take(30)},label={Text("QQ AppID")},singleLine=true,enabled=ready,modifier=Modifier.fillMaxWidth().testTag("channelQqAppId"))
            OutlinedTextField(appSecret,{appSecret=it.take(512)},label={Text(if(account?.configured==true)"AppSecret（留空保留）" else "QQ AppSecret")},visualTransformation=PasswordVisualTransformation(),singleLine=true,enabled=ready,modifier=Modifier.fillMaxWidth().testTag("channelQqSecret"))
            val credentialsReady=appId.trim().matches(Regex("^\\d{4,30}$"))&&(appSecret.trim().length>=8||appSecret.isBlank()&&account?.configured==true&&appId==account.appId)
            Button(onClick={val next=operation("connect-qq");appSecret="";action(next)},enabled=ready&&credentialsReady,modifier=Modifier.fillMaxWidth()){Text("保存并连接")}
            TextButton(onClick={uri.openUri("https://q.qq.com/")}){Text("打开 QQ 机器人开放平台")}
        }else{
            Button(onClick={action(operation("login"))},enabled=ready,modifier=Modifier.fillMaxWidth().testTag("channelWeixinLogin")){Text("微信扫码连接")}
            if(login!=null&&login.accountId==account?.id)NativeChannelLoginContent(login,loginWorking,ready,verify,cancelLogin)
        }
        if(account!=null){
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                TextButton(onClick={action(operation("connect"))},enabled=ready&&account.configured){Text("重新连接")}
                TextButton(onClick={action(operation("disconnect"))},enabled=ready&&account.state in listOf("connected","connecting","error")){Text("断开")}
                TextButton(onClick={action(operation("remove"))},enabled=ready){Text("清除登录",color=MaterialTheme.colors.error)}
            }
        }
    }
}

@Composable private fun ChannelProjectChoice(value:String,projects:List<Project>,enabled:Boolean,onSelect:(String)->Unit){
    var open by remember{mutableStateOf(false)}
    Column(verticalArrangement=Arrangement.spacedBy(5.dp)){
        Text("新会话",fontSize=13.sp)
        Box{
            OutlinedButton(onClick={open=true},enabled=enabled,modifier=Modifier.fillMaxWidth()){
                Text(projects.firstOrNull{it.path==value}?.name?:nativeDisplayPath(value).ifBlank{"通用助理 · 不绑定项目"},maxLines=2)
            }
            NativeDropdownMenu(open,{open=false}){
                DropdownMenuItem(onClick={onSelect("");open=false}){Text("通用助理 · 不绑定项目")}
                projects.forEach{project->DropdownMenuItem(onClick={onSelect(project.path);open=false}){Column{Text(project.name);Text(nativeDisplayPath(project.path),fontSize=11.sp,maxLines=2,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))}}}
            }
        }
        if(value.isNotBlank())Text(value,fontSize=11.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
        if(value.isBlank())Text("普通聊天使用独立助理空间，需要处理项目时再指定目录。",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
    }
}

@Composable private fun NativeChannelLoginContent(login:ManagedChannelLogin,working:Boolean,enabled:Boolean,verify:(String)->Unit,cancel:()->Unit){
    val bitmap=remember(login.qrImage){runCatching{
        if(!login.qrImage.startsWith("data:image/png;base64,")||login.qrImage.length>512*1024)null else {
            val bytes=Base64.decode(login.qrImage.substringAfter(','),Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes,0,bytes.size)?.asImageBitmap()
        }
    }.getOrNull()}
    var code by remember(login.generation){mutableStateOf("")}
    val status=when(login.status){
        "wait"->"请用微信扫描二维码";"scaned"->"已扫码，请在微信确认";"confirmed"->"已登录";"expired"->"二维码已过期，请重新扫码"
        "need_verifycode"->"请填写微信显示的验证码";"verify_code_blocked"->"验证次数过多，请重新扫码";"scaned_but_redirect"->"正在继续验证"
        "binded_redirect"->"请在微信调整机器人绑定后重新扫码";"error"->"扫码检查未完成，请重新扫码";else->"正在等待微信"
    }
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp),horizontalAlignment=Alignment.CenterHorizontally){
        if(login.active&&bitmap!=null)Image(bitmap,"微信登录二维码",Modifier.sizeIn(maxWidth=280.dp,maxHeight=280.dp).size(256.dp).background(Color.White).testTag("channelWeixinQr"))
        Text(status,fontSize=13.sp,modifier=Modifier.testTag("channelWeixinLoginStatus"))
        if(login.status=="need_verifycode"){
            OutlinedTextField(code,{code=it.take(40)},label={Text("微信显示的验证码")},singleLine=true,enabled=enabled&&!working,modifier=Modifier.fillMaxWidth())
            Button(onClick={verify(code);code=""},enabled=enabled&&!working&&code.isNotBlank()){Text(if(working)"验证中…" else "提交验证码")}
        }
        if(login.active)TextButton(onClick=cancel,enabled=enabled){Text("停止检查扫码状态")}
    }
}
