package com.localcodex.control

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun NativeHarnessVisibilityPage(hidden:Set<String>,change:(String,Boolean)->Unit,back:()->Unit){
    NativeManagementPage("助手显示","",back){
        Column(Modifier.weight(1f).nativeManagementScroll(rememberScrollState()).padding(16.dp)){
            NativeSettingsGroup{
                nativeHarnesses.forEachIndexed{index,agent->
                    if(index>0)Divider(Modifier.padding(start=60.dp,end=16.dp),color=NativeInk.copy(alpha=.065f),thickness=.5.dp)
                    Row(Modifier.fillMaxWidth().heightIn(min=60.dp).padding(horizontal=16.dp),verticalAlignment=Alignment.CenterVertically){
                        NativeHarnessIcon(agent,Modifier.size(24.dp),NativeInk)
                        Text(nativeAgentName(agent),Modifier.weight(1f).padding(horizontal=12.dp),fontSize=15.sp,maxLines=2,overflow=TextOverflow.Ellipsis)
                        DashboardSwitch(agent !in hidden,{change(agent,it)},
                            Modifier.testTag("harnessVisible:$agent").semantics{contentDescription="显示 ${nativeAgentName(agent)}"},
                            enabled=agent in hidden||nativeHarnesses.count{it !in hidden}>1)
                    }
                }
            }
        }
    }
}

/** Keep service diagnostics bounded wherever they appear outside the detail viewer. */
@Composable internal fun NativeBackendNotice(detail:String,modifier:Modifier=Modifier){
    var expanded by remember(detail){mutableStateOf(false)}
    val clipboard=LocalClipboardManager.current
    Text(detail,modifier.clickable{expanded=true},fontSize=11.sp,lineHeight=16.sp,color=NativeMuted,
        maxLines=2,overflow=TextOverflow.Ellipsis)
    if(expanded)NativeAlertDialog(onDismissRequest={expanded=false},title={Text("服务详情")},
        text={SelectionContainer(Modifier.fillMaxWidth().heightIn(max=240.dp).verticalScroll(rememberScrollState())){
            Text(detail,fontSize=13.sp,lineHeight=19.sp)
        }},confirmButton={TextButton(onClick={expanded=false}){Text("关闭")}},
        dismissButton={TextButton(onClick={clipboard.setText(AnnotatedString(detail))}){Text("复制详情")}})
}
