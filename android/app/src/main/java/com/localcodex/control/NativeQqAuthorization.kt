package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

@Composable internal fun NativeQqAuthorization(accountId:String,authorizedCount:Int,pairing:ManagedChannelPairing?,enabled:Boolean,onPair:()->Unit,onRevoke:()->Unit){
    val clipboard=LocalClipboardManager.current
    val current=pairing?.takeIf{it.accountId==accountId}
    var expired by remember(current?.expiresAt){mutableStateOf(current!=null&&current.expiresAt<=System.currentTimeMillis())}
    LaunchedEffect(current?.expiresAt){if(current!=null){delay((current.expiresAt-System.currentTimeMillis()).coerceAtLeast(0));expired=true}}
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(if(authorizedCount==0)"尚未授权 QQ，机器人不会执行聊天任务" else "已授权 $authorizedCount 个 QQ 账号",fontSize=13.sp)
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            OutlinedButton(onClick=onPair,enabled=enabled){Text("生成绑定码")}
            if(authorizedCount>0)TextButton(onClick=onRevoke,enabled=enabled){Text("清除授权",color=MaterialTheme.colors.error)}
        }
        if(current!=null){
            if(expired)Text("绑定码已过期，请重新生成",fontSize=12.sp,color=MaterialTheme.colors.error)
            else{
                Text("用需要授权的 QQ 私聊机器人，发送以下命令。绑定码十分钟内有效，只能使用一次。",fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f))
                SelectionContainer{Text("/绑定 ${current.code}",fontFamily=FontFamily.Monospace,fontSize=14.sp)}
                TextButton(onClick={clipboard.setText(AnnotatedString("/绑定 ${current.code}"))}){Text("复制绑定命令")}
            }
        }
    }
}
