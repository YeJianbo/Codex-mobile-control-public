package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CornerSize
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal data class QuotaOverviewWindow(val name:String,val remaining:Double,val resetsAt:String)
internal data class QuotaOverviewAccount(val id:String,val label:String,val active:Boolean,val plan:String,val updatedAt:String,val stale:Boolean,val configured:Boolean,val reason:String,val windows:List<QuotaOverviewWindow>,val credits:JSONObject?=null)
internal data class QuotaOverviewSource(val id:String,val label:String,val accounts:List<QuotaOverviewAccount> = emptyList(),val refreshing:Boolean=false,val error:String="",val supported:Boolean=true,val refreshable:Boolean=true)
private fun JSONObject.quotaText(key:String)=optString(key).takeUnless{it=="null"}.orEmpty()
private fun quotaOverviewTime(value:String)=try{Instant.parse(value).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM-dd HH:mm",Locale.ROOT))}catch(_:Exception){"未读取"}
private fun parseQuotaOverview(value:JSONObject):QuotaOverviewSource{
    val accounts=value.optJSONArray("accounts")
    return QuotaOverviewSource(value.quotaText("source"),value.quotaText("label"),(0 until (accounts?.length()?:0)).mapNotNull accountLoop@{index->
        val row=accounts?.optJSONObject(index)?:return@accountLoop null
        val windows=row.optJSONArray("windows")
        QuotaOverviewAccount(row.quotaText("id"),row.quotaText("label"),row.optBoolean("active"),row.quotaText("plan"),row.quotaText("updatedAt"),row.optBoolean("stale"),row.optBoolean("configured",true),row.quotaText("reason"),
            (0 until (windows?.length()?:0)).mapNotNull windowLoop@{windowIndex->
                val window=windows?.optJSONObject(windowIndex)?:return@windowLoop null
                val remaining=window.optDouble("remainingPercent",Double.NaN).takeIf{it.isFinite()&&it in 0.0..100.0}?:return@windowLoop null
                QuotaOverviewWindow(window.quotaText("name"),remaining,window.quotaText("resetsAt"))
            },row.optJSONObject("credits"))
    },value.optBoolean("refreshing"),value.quotaText("error"),value.optBoolean("supported",true),value.optBoolean("refreshable",true))
}

@Composable internal fun NativeAllQuotas(vm:NativeViewModel,back:()->Unit,onViewUsage:(String)->Unit={}){
    val address=vm.state.address
    var sources by remember(vm,address){mutableStateOf(emptyList<QuotaOverviewSource>())}
    var reading by remember(vm,address){mutableStateOf(emptySet<String>())}
    var catalogRevision by remember(vm,address){mutableStateOf(0)}
    var catalogError by remember(vm,address){mutableStateOf("")}
    var revisions by remember(vm,address){mutableStateOf(emptyMap<String,Int>())}
    val submitted=remember(vm,address){mutableMapOf<String,Int>()}
    val owner=LocalLifecycleOwner.current
    var foreground by remember(owner){mutableStateOf(owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))}
    DisposableEffect(owner){
        val observer=LifecycleEventObserver{_,_->foreground=owner.lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)}
        owner.lifecycle.addObserver(observer);onDispose{owner.lifecycle.removeObserver(observer)}
    }
    val active=LocalManagementPageActive.current
    val connected=vm.state.connected
    LaunchedEffect(vm,address,connected,active,foreground,catalogRevision){
        if(!connected||!active||!foreground)return@LaunchedEffect
        reading=reading+"catalog";catalogError=""
        try{
            val result=vm.managementRequest("/api/mobile-management/statistics/quotas?catalog=1")
            val rows=result.getJSONArray("sources")
            sources=(0 until rows.length()).map{index->
                val descriptor=parseQuotaOverview(rows.getJSONObject(index))
                sources.find{it.id==descriptor.id}?.copy(label=descriptor.label,supported=descriptor.supported,refreshable=descriptor.refreshable)?:descriptor
            }
        }catch(error:CancellationException){throw error}
        catch(error:Exception){catalogError=error.message?:"额度来源读取失败"}
        finally{reading=reading-"catalog"}
    }
    sources.filter{it.supported}.forEach{source->key(source.id){
        val id=source.id
        val revision=revisions[id]?:0
        LaunchedEffect(vm,address,connected,active,foreground,id,revision){
            if(!connected||!active||!foreground){reading=reading-id;return@LaunchedEffect}
            reading=reading+id
            try{
                // Consume an explicit refresh once. Returning from the background
                // only reads the running job; it never submits another refresh.
                if(revision>(submitted[id]?:0)){
                    submitted[id]=revision
                    vm.managementRequest("/api/mobile-management/statistics/quotas/refresh",JSONObject().put("source",id))
                }
                do{
                    val result=vm.managementRequest("/api/mobile-management/statistics/quotas?source=$id")
                    val row=result.optJSONArray("sources")?.optJSONObject(0)?:error("额度响应不完整")
                    val parsed=parseQuotaOverview(row)
                    require(parsed.id==id){"额度来源不匹配"}
                    sources=sources.map{if(it.id==id)parsed else it}
                    if(!parsed.refreshing)break
                    delay(2000)
                }while(true)
            }catch(error:CancellationException){throw error}
            catch(error:Exception){sources=sources.map{if(it.id==id)it.copy(error=error.message?:"额度读取失败")else it}}
            finally{reading=reading-id}
        }
    }}
    NativeAllQuotasContent(sources,reading,connected,back,catalogError,onViewUsage){id->
        if(catalogError.isNotBlank()||sources.isEmpty())catalogRevision++
        val ids=if(id=="all")sources.filter{it.supported&&it.refreshable}.map{it.id}else listOf(id)
        revisions=revisions.toMutableMap().apply{ids.forEach{source->put(source,(get(source)?:0)+1)}}
    }
}

@Composable internal fun NativeAllQuotasContent(sources:List<QuotaOverviewSource>,reading:Set<String>,connected:Boolean,back:()->Unit,catalogError:String="",onViewUsage:(String)->Unit={},onRefresh:(String)->Unit){
    var currentOnly by rememberSaveable{mutableStateOf(false)}
    var expandedAccounts by rememberSaveable{mutableStateOf(emptyList<String>())}
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.62f)
    NativeManagementPage("全部额度","",back,actions={ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新全部额度",{onRefresh("all")},enabled=connected&&reading.isEmpty())}){
        LazyColumn(Modifier.weight(1f).fillMaxWidth().testTag("allQuotaSources"),state=rememberNativeManagementListState(),contentPadding=nativeManagementPadding(PaddingValues(16.dp))){
            item{StatisticsTabStrip(listOf("all" to "全部账号","current" to "当前账号"),if(currentOnly)"current" else "all",{currentOnly=it=="current"});Spacer(Modifier.height(12.dp))}
            if(!connected)item{Text("连接电脑后查看全部额度",fontSize=13.sp,color=muted)}
            if("catalog" in reading&&sources.isEmpty())item{NativeRunningTitle("正在读取额度来源",rememberNativeRunningPulse(true),fontSize=12.sp)}
            if(catalogError.isNotBlank())item{Text(catalogError,fontSize=12.sp,color=MaterialTheme.colors.error,maxLines=4,overflow=TextOverflow.Ellipsis)}
            sources.filter{it.supported}.forEach{source->
                item(key="source:${source.id}"){
                    Row(Modifier.fillMaxWidth().padding(top=8.dp,bottom=12.dp),verticalAlignment=Alignment.CenterVertically){
                        Text(source.label,fontWeight=FontWeight.SemiBold,fontSize=15.sp)
                        Box(Modifier.padding(start=8.dp).weight(1f).height(22.dp),contentAlignment=Alignment.CenterStart){
                            if(source.id in reading)NativeRunningTitle("正在更新",rememberNativeRunningPulse(true),fontSize=11.sp)
                        }
                        ChromeButton(R.drawable.ic_lucide_chart_spline,"查看 ${source.label} 用量统计",{onViewUsage(source.id)},enabled=connected)
                        ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新 ${source.label} 当前账号额度",{onRefresh(source.id)},enabled=connected&&source.refreshable&&source.id !in reading)
                    }
                }
                val accounts=source.accounts.filter{!currentOnly||it.active}
                accounts.forEach{account->
                    val accountKey="${source.id}:${account.id}"
                    val expanded=accountKey in expandedAccounts
                    val toggle={expandedAccounts=if(expanded)expandedAccounts-accountKey else expandedAccounts+accountKey}
                    item(key="account:$accountKey"){
                        if(!expanded){QuotaOverviewAccountCard(account,toggle);Spacer(Modifier.height(12.dp))}
                        else QuotaAccountSegment(top=true){QuotaAccountHeading(account)}
                    }
                    if(expanded){
                        // Each pair is a lazy item; expanding an account does not
                        // compose its full model list inside one oversized card.
                        items(count=(account.windows.size+1)/2,key={"windows:$accountKey:$it"},contentType={"quota-window-row"}){index->
                            val first=index*2
                            QuotaAccountSegment{QuotaWindowRow(account.windows.subList(first,minOf(first+2,account.windows.size)))}
                        }
                        item(key="footer:$accountKey"){
                            QuotaAccountSegment(bottom=true){
                                TextButton(onClick=toggle,contentPadding=PaddingValues(0.dp)){Text("收起额度",fontSize=12.sp)}
                                QuotaAccountFoot(account)
                            }
                            Spacer(Modifier.height(12.dp))
                        }
                    }
                }
                if(accounts.isEmpty())item(key="empty:${source.id}"){Text(if(source.id in reading)"正在读取账号信息" else if(currentOnly)"暂无当前账号额度" else "未发现已登录或保存的账号",fontSize=12.sp,color=muted)}
                if(source.error.isNotBlank())item(key="error:${source.id}"){Text(source.error,fontSize=12.sp,color=MaterialTheme.colors.error,maxLines=4,overflow=TextOverflow.Ellipsis)}
            }
            val unsupported=sources.filter{!it.supported}
            if(unsupported.isNotEmpty())item{Text(unsupported.joinToString("、"){it.label}+" 暂无可读取的官方额度；请求消耗可在用量统计中查看。",Modifier.padding(vertical=12.dp),fontSize=12.sp,color=muted)}
        }
    }
}

@Composable private fun QuotaOverviewAccountCard(account:QuotaOverviewAccount,onExpand:()->Unit){
    DashboardCard(Modifier.fillMaxWidth()){
        QuotaAccountHeading(account)
        account.windows.take(4).chunked(2).forEach{QuotaWindowRow(it)}
        if(account.windows.size>4)TextButton(onClick=onExpand,contentPadding=PaddingValues(0.dp)){
            Text("查看其余 ${account.windows.size-4} 项额度",fontSize=12.sp)
        }
        QuotaAccountFoot(account)
    }
}

@Composable private fun QuotaAccountSegment(top:Boolean=false,bottom:Boolean=false,content:@Composable ColumnScope.()->Unit){
    val base=Radius.Section
    val flat=CornerSize(0.dp)
    NativeLiquidSurface(Modifier.fillMaxWidth(),shape=base.copy(topStart=if(top)base.topStart else flat,topEnd=if(top)base.topEnd else flat,bottomStart=if(bottom)base.bottomStart else flat,bottomEnd=if(bottom)base.bottomEnd else flat),kind=NativeGlassKind.INSET){
        Column(Modifier.padding(start=16.dp,end=16.dp,top=if(top)16.dp else 6.dp,bottom=if(bottom)16.dp else 6.dp),verticalArrangement=Arrangement.spacedBy(12.dp),content=content)
    }
}

@Composable private fun QuotaAccountHeading(account:QuotaOverviewAccount){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.62f)
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
        Text(account.label,Modifier.weight(1f),fontSize=13.sp,fontWeight=FontWeight.SemiBold,maxLines=2,overflow=TextOverflow.Ellipsis)
        if(account.active)Text("当前",fontSize=11.sp,color=MaterialTheme.colors.primary)
        if(account.plan.isNotBlank())Text(account.plan.uppercase(Locale.ROOT),fontSize=11.sp,color=muted)
    }
    if(account.credits!=null)Text("Credits 余额  "+creditLabel(account.credits),fontSize=13.sp,fontWeight=FontWeight.Medium)
}

@Composable private fun QuotaWindowRow(group:List<QuotaOverviewWindow>){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.62f)
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)){
        group.forEach{window->
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
                    Text(window.name,Modifier.weight(1f),fontSize=12.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
                    Text("${window.remaining.toInt()}%",fontSize=24.sp,fontWeight=FontWeight.Medium)
                }
                LinearProgressIndicator((window.remaining/100).toFloat(),Modifier.fillMaxWidth().height(5.dp),color=if(window.remaining<10)MaterialTheme.colors.error else MaterialTheme.colors.primary,backgroundColor=MaterialTheme.colors.onSurface.copy(alpha=.065f))
                Text(if(window.resetsAt.isNotBlank())quotaOverviewTime(window.resetsAt)+" 重置" else "重置时间未提供",fontSize=10.sp,color=muted)
            }
        }
        if(group.size==1)Spacer(Modifier.weight(1f))
    }
}

@Composable private fun QuotaAccountFoot(account:QuotaOverviewAccount){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.62f)
    if(account.windows.isEmpty())Text(if(account.configured)"暂无额度记录" else "未登录",fontSize=12.sp,color=muted)
    Text(if(account.updatedAt.isNotBlank())quotaOverviewTime(account.updatedAt)+" 采集"+(if(account.stale)" · 上次成功数据" else "")else "尚无采集记录",fontSize=10.sp,color=muted)
    if(account.reason.isNotBlank())Text(account.reason,fontSize=11.sp,color=muted,maxLines=3,overflow=TextOverflow.Ellipsis)
}
