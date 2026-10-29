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
        Column(Modifier.weight(1f).nativeManagementScroll(rememberScrollState()).padding(start=16.dp,end=16.dp,top=22.dp,bottom=34.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
            SettingsSectionLabel("显示模式")
            NativeSettingsGroup(Modifier.selectableGroup()){
                listOf("system" to "跟随系统","light" to "浅色","dark" to "深色").forEachIndexed{index,(value,label)->
                    AppearanceChoice(label,appearance==value,!state.busy,index>0){onAppearance(value)}
                }
            }
            SettingsSectionLabel("主题")
            Box(Modifier.testTag("glassMaterialPreview")){NativeGlassPreview(LocalNativeGlassMode.current)}
            NativeSettingsGroup(Modifier.selectableGroup()){
                state.themes.forEachIndexed{index,theme->AppearanceChoice(theme.name,state.selectedId==theme.id,!state.busy,index>0){onTheme(theme.id)}}
            }
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
@Composable private fun AppearanceChoice(label:String,checked:Boolean,enabled:Boolean,divider:Boolean=false,onSelect:()->Unit){
    if(divider)Divider(Modifier.padding(horizontal=16.dp),color=MaterialTheme.colors.onSurface.copy(alpha=.07f),thickness=.5.dp)
    Row(Modifier.fillMaxWidth().nativeSettingsRowClick(enabled,Role.RadioButton,onSelect).heightIn(min=56.dp).padding(horizontal=18.dp,vertical=14.dp)
        .semantics{selected=checked;role=Role.RadioButton},verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
        Text(label,Modifier.weight(1f),color=MaterialTheme.colors.onSurface.copy(alpha=if(enabled)1f else .4f),fontSize=16.sp)
        if(checked)Icon(androidx.compose.ui.res.painterResource(R.drawable.ic_lucide_check),"已选择",Modifier.size(19.dp),tint=MaterialTheme.colors.primary)
    }
}
