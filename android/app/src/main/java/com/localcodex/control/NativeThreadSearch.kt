package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

data class NativeThreadSearch(
    val query:String="",val agent:String="",val matches:List<ThreadMatch> = emptyList(),
    val loading:Boolean=false,val error:String=""
)

@Composable internal fun NativeThreadSearchFeedback(state:NativeThreadSearch,onRetry:()->Unit,modifier:Modifier=Modifier){
    val muted=MaterialTheme.colors.onSurface.copy(alpha=.65f)
    Row(modifier.fillMaxWidth().heightIn(min=48.dp).padding(horizontal=13.dp).testTag("threadSearchFeedback"),verticalAlignment=Alignment.CenterVertically){
        Text("正文匹配",Modifier.weight(1f),fontSize=12.sp,fontWeight=FontWeight.SemiBold,color=muted)
        when{
            state.loading->NativeRunningTitle("正在搜索…",rememberNativeRunningPulse(true),Modifier.testTag("threadSearchLoading"),fontSize=11.sp)
            state.error.isNotBlank()->{
                Text("读取失败",fontSize=11.sp,color=muted)
                TextButton(onClick=onRetry,modifier=Modifier.testTag("threadSearchRetry")){Text("重试",fontSize=12.sp)}
            }
            else->Text("${state.matches.size} 项",fontSize=11.sp,color=muted)
        }
    }
}
