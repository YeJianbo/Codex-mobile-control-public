package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable internal fun NativeStorageContent(state:NativeStorageState,onLimit:(Int)->Unit,onClear:()->Unit,uploads:NativeUploadStorageState,onRefresh:()->Unit,onDelete:(List<NativeStoredUpload>)->Unit,modifier:Modifier=Modifier){
    var limit by remember(state.limitMb){mutableStateOf(state.limitMb.toString())}
    val value=limit.toIntOrNull()
    val valid=value!=null&&value in 128..8192
    Column(modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(14.dp)){
        NativeUploadedStorage(uploads,onRefresh,onDelete)
        Divider()
        Text("手机预览缓存",fontSize=17.sp)
        Text("已使用 ${android.text.format.Formatter.formatFileSize(androidx.compose.ui.platform.LocalContext.current,state.bytes)} · ${state.files} 个文件",fontSize=16.sp)
        OutlinedTextField(limit,{limit=it.filter(Char::isDigit).take(5)},label={Text("缓存上限（MB）")},singleLine=true,enabled=!state.busy,
            keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),modifier=Modifier.fillMaxWidth(),isError=!valid)
        Text("可设为 128–8192 MB。超过上限时清理最久未使用的预览缓存，不按时间自动过期。",fontSize=13.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
        Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){
            Button(enabled=!state.busy&&valid&&value!=state.limitMb,onClick={value?.let(onLimit)}){Text("保存上限")}
            OutlinedButton(enabled=!state.busy&&state.files>0,onClick=onClear){Text("清理缓存")}
        }
        if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        if(state.message.isNotBlank())Text(state.message,fontSize=13.sp)
        if(state.error.isNotBlank())Text(state.error,fontSize=13.sp,color=MaterialTheme.colors.error)
        Divider()
        Text("图片保存到 Codex 相簿，文件保存到“下载/Codex”。",fontSize=13.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
    }
}

@Composable private fun NativeUploadedStorage(state:NativeUploadStorageState,onRefresh:()->Unit,onDelete:(List<NativeStoredUpload>)->Unit){
    var selected by remember{mutableStateOf(setOf<String>())}
    var days by remember{mutableStateOf(0)}
    var search by remember{mutableStateOf("")}
    var confirming by remember{mutableStateOf<List<NativeStoredUpload>?>(null)}
    val rows=state.items.filter{item->item.name.contains(search,true)&&(days==0||runCatching{java.time.Instant.parse(item.createdAt).toEpochMilli()<System.currentTimeMillis()-days*86400000L}.getOrDefault(false))}
    val chosen=state.items.filter{it.key in selected&&it.protectedReason.isBlank()}
    val enabled=!state.busy&&state.blockedReason.isBlank()
    val context=androidx.compose.ui.platform.LocalContext.current
    fun size(bytes:Long)=android.text.format.Formatter.formatFileSize(context,bytes)
    LaunchedEffect(state.items){selected=selected.intersect(state.items.filter{it.protectedReason.isBlank()}.map{it.key}.toSet())}
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)){
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("电脑上传附件",fontSize=17.sp);TextButton(onClick=onRefresh,enabled=!state.busy){Text("刷新")}}
        Text("${size(state.totalBytes)} · ${state.items.size} 个附件",fontSize=14.sp)
        OutlinedTextField(search,{search=it},label={Text("搜索文件名")},singleLine=true,modifier=Modifier.fillMaxWidth())
        Row{listOf(0 to "全部",30 to "30 天前",90 to "90 天前").forEach{(value,label)->TextButton(onClick={days=value;selected=emptySet()}){Text(if(days==value)"✓ $label" else label)}}}
        if(state.busy)LinearProgressIndicator(Modifier.fillMaxWidth())
        if(state.blockedReason.isNotBlank())Text(state.blockedReason,fontSize=13.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
        if(state.error.isNotBlank())Text(state.error,color=MaterialTheme.colors.error,fontSize=13.sp)
        if(state.message.isNotBlank())Text(state.message,fontSize=13.sp)
        if(rows.isEmpty()&&!state.busy&&state.error.isBlank())Text("没有符合条件的附件",fontSize=14.sp)
        LazyColumn(Modifier.fillMaxWidth().heightIn(max=240.dp)){
            items(rows,key={it.key}){item->
                Row(Modifier.fillMaxWidth().padding(vertical=4.dp)){
                    Checkbox(item.key in selected,{checked->selected=if(checked)selected+item.key else selected-item.key},enabled=enabled&&item.protectedReason.isBlank())
                    Column(Modifier.weight(1f)){
                        Text(item.name,fontSize=14.sp)
                        Text("${size(item.size)} · ${item.createdAt.take(10)} · ${if(item.kind=="image")"图片" else "文件"}",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.6f))
                        if(item.protectedReason.isNotBlank())Text(item.protectedReason,fontSize=12.sp,color=MaterialTheme.colors.primary)
                    }
                }
            }
        }
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            OutlinedButton(enabled=enabled&&rows.any{it.protectedReason.isBlank()},onClick={val keys=rows.filter{it.protectedReason.isBlank()}.map{it.key}.toSet();selected=if(selected.containsAll(keys))selected-keys else selected+keys}){Text("选择当前列表")}
            Button(enabled=enabled&&chosen.isNotEmpty(),onClick={confirming=chosen}){Text("清理 ${chosen.size} 个")}
        }
        if(chosen.isNotEmpty())Text("已选 ${size(chosen.sumOf{it.size})}",fontSize=13.sp)
    }
    confirming?.let{chosenItems->AlertDialog(onDismissRequest={confirming=null},title={Text("清理电脑附件")},text={Text("将永久删除 ${chosenItems.size} 个附件（${size(chosenItems.sumOf{it.size})}）。历史消息中的这些附件将无法再打开。聊天记录及另存到手机的文件会保留。")},confirmButton={TextButton(onClick={confirming=null;selected=emptySet();onDelete(chosenItems)}){Text("确认删除")}},dismissButton={TextButton(onClick={confirming=null}){Text("取消")}})}
}
