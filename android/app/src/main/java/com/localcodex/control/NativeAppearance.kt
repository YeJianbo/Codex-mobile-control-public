package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun NativeAppearancePage(
    appearance:String,state:NativeThemeState,onAppearance:(String)->Unit,onTheme:(String)->Unit,
    onImport:()->Unit,onExport:()->Unit,onRemove:()->Unit,onBack:()->Unit,
){
    NativeManagementPage("外观","",onBack){
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
            Text("显示模式",fontSize=16.sp,fontWeight=FontWeight.SemiBold)
            NativeThemeSurface(shape=Radius.Section){Column(Modifier.selectableGroup()){
                listOf("system" to "跟随系统","light" to "浅色","dark" to "深色").forEach{(value,label)->
                    AppearanceChoice(label,appearance==value,!state.busy){onAppearance(value)}
                }
            }}
            Text("主题",fontSize=16.sp,fontWeight=FontWeight.SemiBold)
            Box(Modifier.testTag("glassMaterialPreview")){NativeGlassPreview(LocalNativeGlassMode.current)}
            NativeThemeSurface(shape=Radius.Section){Column(Modifier.selectableGroup()){
                state.themes.forEach{theme->AppearanceChoice(theme.name,state.selectedId==theme.id,!state.busy){onTheme(theme.id)}}
            }}
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                DashboardAction("导入主题",onImport,Modifier.weight(1f).testTag("importTheme"),enabled=!state.busy,icon=R.drawable.ic_lucide_folder_open)
                DashboardAction("导出当前主题",onExport,Modifier.weight(1f).testTag("exportTheme"),enabled=!state.busy,icon=R.drawable.ic_lucide_share_2)
            }
            if(state.busy)Text("正在加载主题…",color=MaterialTheme.colors.onSurface.copy(alpha=.65f),fontSize=13.sp)
            if(state.error.isNotBlank())Text(state.error,color=MaterialTheme.colors.error,fontSize=13.sp)
            if(state.notice.isNotBlank())Text(state.notice,color=MaterialTheme.colors.onSurface.copy(alpha=.65f),fontSize=13.sp)
            if(state.selectedId.startsWith("custom:"))TextButton(onClick=onRemove,enabled=!state.busy){Text("移除此主题")}
            if(state.selectedId!="off")TextButton(onClick={onTheme("off")},enabled=!state.busy,modifier=Modifier.testTag("restoreStandardAppearance")){Text("恢复标准主题")}
        }
    }
}
@Composable private fun AppearanceChoice(label:String,checked:Boolean,enabled:Boolean,onSelect:()->Unit){
    Row(Modifier.fillMaxWidth().heightIn(min=52.dp).padding(horizontal=8.dp).semantics{selected=checked;role=Role.RadioButton}){
        TextButton(onClick=onSelect,enabled=enabled,modifier=Modifier.fillMaxWidth()){
            Text(label,Modifier.weight(1f),color=if(checked)MaterialTheme.colors.primary else MaterialTheme.colors.onSurface,fontSize=15.sp)
            if(checked)Icon(androidx.compose.ui.res.painterResource(R.drawable.ic_lucide_check),"已选择",Modifier.size(18.dp))
        }
    }
}
