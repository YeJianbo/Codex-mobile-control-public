@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class,androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control
import com.localcodex.control.NativeThemeSurface as Surface

import androidx.compose.animation.*
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun NativeSettingsNavigation(destination:String,content:@Composable (String)->Unit){
    val saved=rememberSaveableStateHolder()
    val easing=CubicBezierEasing(.22f,1f,.36f,1f)
    Box(Modifier.fillMaxSize().clipToBounds().testTag("settingsNavigationContainer")){
    AnimatedContent(destination,modifier=Modifier.fillMaxSize(),contentAlignment=Alignment.TopStart,transitionSpec={
        val back=targetState.isEmpty()||targetState=="home"&&initialState.isNotEmpty()
        val enter=slideInHorizontally(tween(240,easing=easing)){if(back)-it/4 else it}
        val exit=slideOutHorizontally(tween(240,easing=easing)){if(back)it else -it/4}
        (enter togetherWith exit).apply{targetContentZIndex=if(back)-1f else 1f}.using(null)
    },label="settingsNavigation"){page->
        Box(Modifier.fillMaxSize().testTag("settingsFrame:$page")){
        if(page.isNotEmpty())saved.SaveableStateProvider(page){
            val active=page==destination
            CompositionLocalProvider(LocalManagementPageActive provides active){
                Box(Modifier.fillMaxSize().focusProperties{canFocus=active}.semantics{if(!active)invisibleToUser()}){content(page)}
            }
        }
        }
    }
    }
}

@Composable internal fun NativeSettingsHome(connected:Boolean,capabilities:List<String>,onBack:()->Unit,onNavigate:(String)->Unit){
    NativeManagementPage("设置","",onBack,modifier=Modifier.testTag("settingsHome")){
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal=16.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(22.dp)){
            Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
                SettingsSectionLabel("账号与服务")
                Surface(shape=Radius.Section,color=MaterialTheme.colors.surface){Column{
                    SettingsRow("账号","登录账号、切换账号与模型配置",R.drawable.ic_lucide_circle_user_round,"accounts",onNavigate)
                    SettingsRow("用量与额度","账号额度、用量统计与模型服务",R.drawable.ic_lucide_gauge,"quota",onNavigate,divider=true)
                    if(!connected||"agent-health" in capabilities)SettingsRow("助手管理","健康状态、版本与后端管理",R.drawable.ic_lucide_bot,"agents",onNavigate,divider=true)
                    if(!connected||"automations" in capabilities)SettingsRow("定时任务","安排任务与调整运行时间",R.drawable.ic_lucide_clock_3,"automations",onNavigate,divider=true)
                    SettingsRow("已归档与关闭","恢复归档、重新显示已关闭会话",R.drawable.ic_lucide_archive,"archives",onNavigate,divider=true)
                }}
            }
            Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
                SettingsSectionLabel("管理工具")
                Surface(shape=Radius.Section,color=MaterialTheme.colors.surface){Column{
                    SettingsRow("助理","助理配置、模型与会话",R.drawable.ic_lucide_bot,"assistant",onNavigate)
                    SettingsRow("扩展","MCP 服务、技能与插件",R.drawable.ic_lucide_puzzle,"extensions",onNavigate,divider=true)
                    SettingsRow("诊断","服务状态、故障排查与维护",R.drawable.ic_lucide_activity,"diagnostics",onNavigate,divider=true)
                    SettingsRow("会话管理","筛选、批量整理与恢复会话",R.drawable.ic_lucide_messages_square,"sessions",onNavigate,divider=true)
                    SettingsRow("渠道","管理消息渠道与会话绑定",R.drawable.ic_lucide_share_2,"channels",onNavigate,divider=true)
                    SettingsRow("Harness","运行方式与服务配置",R.drawable.ic_lucide_terminal,"harnesses",onNavigate,divider=true)
                    SettingsRow("详细统计","用量明细、请求表现与筛选",R.drawable.ic_lucide_chart_spline,"statistics",onNavigate,divider=true)
                }}
            }
            Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
                SettingsSectionLabel("应用")
                Surface(shape=Radius.Section,color=MaterialTheme.colors.surface){Column{
                    SettingsRow("外观","主题、颜色与显示模式",R.drawable.ic_lucide_palette,"appearance",onNavigate)
                    SettingsRow("存储与缓存","本地缓存与上传文件",R.drawable.ic_lucide_hard_drive,"storage",onNavigate,divider=true)
                }}
            }
        }
    }
}

@Composable internal fun NativeArchivedThreads(threads:List<ThreadRecord>,loading:Boolean,error:String,connected:Boolean,
    refresh:()->Unit,restore:(ThreadRecord)->Unit,back:()->Unit){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.6f)
    NativeManagementPage("已归档与关闭","",back,modifier=Modifier.testTag("archivedThreadsPage"),actions={
        TextButton(onClick=refresh,enabled=connected&&!loading){Text(if(loading)"加载中…" else "刷新")}
    }){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),contentPadding=PaddingValues(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
            if(!connected)item{Text("连接电脑后查看已归档与关闭的会话",fontSize=14.sp,color=muted)}
            if(error.isNotBlank())item{Text(error,color=MaterialTheme.colors.error,fontSize=13.sp)}
            items(threads,key={it.id}){thread->
                Surface(shape=Radius.Section,color=MaterialTheme.colors.surface){
                    Row(Modifier.fillMaxWidth().padding(start=16.dp,end=8.dp,top=10.dp,bottom=10.dp),verticalAlignment=Alignment.CenterVertically){
                        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)){
                            Text(subagentLabel(thread).ifBlank{"会话"},maxLines=2,overflow=TextOverflow.Ellipsis,fontSize=14.sp)
                            Text(if(thread.closureKind=="gatewayClosed")"已关闭" else "已归档",fontSize=11.sp,color=muted)
                            if(thread.projectPath.isNotBlank())Text(nativeDisplayPath(thread.projectPath),maxLines=1,overflow=TextOverflow.Ellipsis,fontSize=11.sp,color=muted)
                        }
                        TextButton(onClick={restore(thread)},enabled=connected,modifier=Modifier.testTag("restoreArchived:${thread.id}")){Text(if(thread.closureKind=="gatewayClosed")"重新显示" else "恢复")}
                    }
                }
            }
            if(connected&&!loading&&error.isBlank()&&threads.isEmpty())item{Text("没有已归档或关闭的会话",fontSize=14.sp,color=muted)}
        }
    }
}

@Composable private fun SettingsSectionLabel(text:String){Text(text,Modifier.padding(start=12.dp),fontSize=12.sp,fontWeight=FontWeight.Medium,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))}

@Composable private fun SettingsRow(title:String,description:String,icon:Int,route:String,onNavigate:(String)->Unit,divider:Boolean=false){
    if(divider)Divider(Modifier.padding(start=64.dp),color=MaterialTheme.colors.onSurface.copy(alpha=.065f))
    Row(Modifier.fillMaxWidth().testTag("settings:$route").clip(Radius.Control).clickable{onNavigate(route)}.heightIn(min=76.dp).padding(horizontal=16.dp,vertical=14.dp),verticalAlignment=Alignment.CenterVertically){
        Box(Modifier.size(36.dp).clip(Radius.Inset).background(MaterialTheme.colors.onSurface.copy(alpha=.045f)),contentAlignment=Alignment.Center){Icon(painterResource(icon),null,Modifier.size(19.dp),tint=MaterialTheme.colors.onSurface.copy(alpha=.8f))}
        Column(Modifier.weight(1f).padding(horizontal=12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
            Text(title,fontSize=15.sp,fontWeight=FontWeight.Medium)
            Text(description,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
        }
        Icon(painterResource(R.drawable.ic_lucide_chevron_right),null,Modifier.size(17.dp),tint=MaterialTheme.colors.onSurface.copy(alpha=.4f))
    }
}
