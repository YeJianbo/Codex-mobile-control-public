@file:OptIn(androidx.compose.animation.ExperimentalAnimationApi::class,androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control
import com.localcodex.control.NativeThemeSurface as Surface

import androidx.compose.animation.*
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
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

@Composable internal fun NativeSettingsHome(connected:Boolean,capabilities:List<String>,onBack:()->Unit,onNavigate:(String)->Unit,updateVersion:String=""){
    NativeManagementPage("设置","",onBack,modifier=Modifier.testTag("settingsHome")){
        Column(Modifier.weight(1f).nativeManagementScroll(rememberScrollState()).padding(start=16.dp,end=16.dp,top=16.dp,bottom=28.dp),verticalArrangement=Arrangement.spacedBy(22.dp)){
            Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                SettingsSectionLabel("账号与服务")
                NativeSettingsGroup{
                    SettingsRow("账号","登录账号、切换账号与模型配置",R.drawable.ic_lucide_circle_user_round,"accounts",onNavigate)
                    SettingsRow("全部额度","各助手的账号额度与重置时间",R.drawable.ic_lucide_gauge,"all-quotas",onNavigate,divider=true)
                    SettingsRow("自动预热","额度重置后的空闲预热、5 小时与 7 天窗口",R.drawable.ic_lucide_zap,"quota-warmup",onNavigate,divider=true)
                    if(!connected||"agent-health" in capabilities)SettingsRow("助手管理","健康状态、版本与后端管理",R.drawable.ic_lucide_bot,"agents",onNavigate,divider=true)
                    if(!connected||"automations" in capabilities)SettingsRow("定时任务","安排任务与调整运行时间",R.drawable.ic_lucide_clock_3,"automations",onNavigate,divider=true)
                    SettingsRow("已归档与关闭","恢复归档、重新显示已关闭会话",R.drawable.ic_lucide_archive,"archives",onNavigate,divider=true)
                }
            }
            Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                SettingsSectionLabel("管理工具")
                NativeSettingsGroup{
                    SettingsRow("助理","助理配置、模型与会话",R.drawable.ic_lucide_bot,"assistant",onNavigate)
                    SettingsRow("扩展","MCP 服务、技能与插件",R.drawable.ic_lucide_puzzle,"extensions",onNavigate,divider=true)
                    SettingsRow("诊断","服务状态、故障排查与维护",R.drawable.ic_lucide_activity,"diagnostics",onNavigate,divider=true)
                    SettingsRow("会话管理","筛选、批量整理与恢复会话",R.drawable.ic_lucide_messages_square,"sessions",onNavigate,divider=true)
                    SettingsRow("渠道","管理消息渠道与会话绑定",R.drawable.ic_lucide_share_2,"channels",onNavigate,divider=true)
                    SettingsRow("Harness","运行方式与服务配置",R.drawable.ic_lucide_terminal,"harnesses",onNavigate,divider=true)
                    SettingsRow("助手指令","编辑各助手的全局指令",R.drawable.ic_lucide_file_text,"agent-instructions",onNavigate,divider=true)
                    SettingsRow("详细统计","用量明细、请求表现与筛选",R.drawable.ic_lucide_chart_spline,"statistics",onNavigate,divider=true)
                }
            }
            Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
                SettingsSectionLabel("应用")
                NativeSettingsGroup{
                    SettingsRow("外观","主题、颜色与显示模式",R.drawable.ic_lucide_palette,"appearance",onNavigate)
                    SettingsRow("助手显示","选择侧栏中显示的助手",R.drawable.ic_lucide_bot,"harness-visibility",onNavigate,divider=true)
                    SettingsRow("存储与缓存","本地缓存与上传文件",R.drawable.ic_lucide_hard_drive,"storage",onNavigate,divider=true)
                    SettingsRow("应用更新",if(updateVersion.isNotBlank())"发现新版本 $updateVersion" else "当前版本 ${BuildConfig.VERSION_NAME}",R.drawable.ic_lucide_arrow_down_to_line,"app-update",onNavigate,divider=true)
                }
            }
        }
    }
}

@Composable internal fun NativeArchivedThreads(threads:List<ThreadRecord>,loading:Boolean,error:String,connected:Boolean,
    refresh:()->Unit,restore:(ThreadRecord)->Unit,back:()->Unit){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.6f)
    NativeManagementPage("已归档与关闭","",back,modifier=Modifier.testTag("archivedThreadsPage"),actions={
        ChromeButton(R.drawable.ic_lucide_rotate_cw,"刷新",refresh,enabled=connected&&!loading)
    }){
        LazyColumn(Modifier.weight(1f).fillMaxWidth(),state=rememberNativeManagementListState(),contentPadding=nativeManagementPadding(PaddingValues(16.dp)),verticalArrangement=Arrangement.spacedBy(10.dp)){
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

/** A single inset group carries its rows, without giving every row another glass rim. */
@Composable internal fun NativeSettingsGroup(modifier:Modifier=Modifier,color:Color=MaterialTheme.colors.surface,content:@Composable ColumnScope.()->Unit){
    NativeLiquidSurface(modifier.fillMaxWidth(),shape=Radius.Section,color=color,kind=NativeGlassKind.INSET,
        border=BorderStroke(.5.dp,MaterialTheme.colors.onSurface.copy(alpha=if(MaterialTheme.colors.isLight).055f else .09f))){
        Column(content=content)
    }
}

@Composable internal fun SettingsSectionLabel(text:String){Text(text,Modifier.padding(start=16.dp),fontSize=13.sp,fontWeight=FontWeight.Medium,color=MaterialTheme.colors.onSurface.copy(alpha=.55f))}

@Composable internal fun Modifier.nativeSettingsRowClick(enabled:Boolean=true,role:Role=Role.Button,onClick:()->Unit):Modifier{
    val interaction=remember{MutableInteractionSource()}
    val pressed by interaction.collectIsPressedAsState()
    return background(if(pressed)MaterialTheme.colors.onSurface.copy(alpha=.065f) else Color.Transparent)
        .clickable(interactionSource=interaction,indication=null,enabled=enabled,role=role,onClick=onClick)
}

@Composable private fun SettingsRow(title:String,description:String,icon:Int,route:String,onNavigate:(String)->Unit,divider:Boolean=false){
    if(divider)Divider(Modifier.padding(start=64.dp,end=16.dp),color=MaterialTheme.colors.onSurface.copy(alpha=.065f),thickness=.5.dp)
    NativeNavigationRow(title,description,icon,{onNavigate(route)},Modifier.testTag("settings:$route"))
}

/** Settings and file lists share typography, touch targets and quiet icon badges. */
@Composable internal fun NativeNavigationRow(
    title:String,description:String,icon:Int,onClick:()->Unit,modifier:Modifier=Modifier,
    enabled:Boolean=true,iconTint:Color=NativeMuted,trailing:@Composable ()->Unit={
        Icon(painterResource(R.drawable.ic_lucide_chevron_right),null,Modifier.size(16.dp),tint=NativeInk.copy(alpha=.30f))
    },
){
    Row(modifier.fillMaxWidth().nativeSettingsRowClick(enabled=enabled,onClick=onClick).heightIn(min=68.dp)
        .padding(horizontal=16.dp,vertical=12.dp),verticalAlignment=Alignment.CenterVertically){
        Box(Modifier.size(36.dp).clip(Radius.Control).background(NativeInk.copy(alpha=.045f)),contentAlignment=Alignment.Center){
            Icon(painterResource(icon),null,Modifier.size(20.dp),tint=iconTint.copy(alpha=if(enabled)iconTint.alpha else .35f))
        }
        Column(Modifier.weight(1f).padding(start=12.dp,end=12.dp),verticalArrangement=Arrangement.spacedBy(3.dp)){
            Text(title,fontSize=15.sp,lineHeight=20.sp,fontWeight=FontWeight.Medium,color=NativeInk.copy(alpha=if(enabled)1f else .45f),maxLines=2,overflow=TextOverflow.Ellipsis)
            if(description.isNotBlank())Text(description,fontSize=12.sp,lineHeight=16.sp,color=NativeMuted,maxLines=2,overflow=TextOverflow.Ellipsis)
        }
        trailing()
    }
}
