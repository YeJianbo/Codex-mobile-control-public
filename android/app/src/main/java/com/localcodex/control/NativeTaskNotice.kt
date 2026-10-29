package com.localcodex.control

import androidx.compose.animation.*
import androidx.compose.animation.core.MutableTransitionState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalAccessibilityManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import kotlinx.coroutines.delay

@Composable internal fun NativeTaskNotice(notice:TaskNotification?,onDismiss:(String)->Unit,onOpen:(TaskNotification)->Unit){
    if(notice==null)return
    val backdrop=LocalNativeOverlayBackdrop.current?:LocalNativeGlassBackdrop.current
    val question=notice.questionId.isNotBlank()
    key(notice.key){
        val visible=remember{MutableTransitionState(false).apply{targetState=true}}
        val accessibility=LocalAccessibilityManager.current
        val dismiss by rememberUpdatedState(onDismiss)
        LaunchedEffect(notice.key){
            delay(accessibility?.calculateRecommendedTimeoutMillis(4500,containsIcons=true,containsText=true,containsControls=true)?:4500)
            visible.targetState=false
            delay(180)
            dismiss(notice.key)
        }
        Popup(alignment=Alignment.TopCenter,properties=PopupProperties(focusable=false,dismissOnClickOutside=false,dismissOnBackPress=false)){
            CompositionLocalProvider(LocalNativeGlassBackdrop provides backdrop){
            AnimatedVisibility(visibleState=visible,enter=fadeIn(tween(180))+slideInVertically(tween(180)){ -it/3 },exit=fadeOut(tween(160))+slideOutVertically(tween(160)){ -it/3 }){
                NativeGlassSurface(Modifier.statusBarsPadding().padding(horizontal=16.dp,vertical=12.dp).widthIn(max=480.dp).fillMaxWidth().testTag(if(question)"questionNotice" else "taskCompletionNotice")
                    .semantics{liveRegion=LiveRegionMode.Polite},shape=Radius.Notice,color=MaterialTheme.colors.surface,kind=NativeGlassKind.MENU,elevation=4.dp){
                    Row(Modifier.padding(start=18.dp,top=10.dp,bottom=10.dp,end=8.dp),verticalAlignment=Alignment.CenterVertically){
                        Icon(painterResource(if(question)R.drawable.ic_lucide_circle_question_mark else if(notice.failureReason.isBlank())R.drawable.ic_lucide_check else R.drawable.ic_lucide_circle_alert),null,Modifier.size(20.dp),tint=if(notice.failureReason.isBlank())MaterialTheme.colors.primary else MaterialTheme.colors.error)
                        Column(Modifier.weight(1f).padding(start=12.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
                            Text(notice.title.substringBefore(" · "),fontSize=15.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)
                            val summary=if(question)notice.body else notice.title.substringAfter(" · ","").ifBlank{notice.body.lineSequence().firstOrNull().orEmpty()}
                            if(summary.isNotBlank())Text(summary,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.7f),maxLines=if(question)2 else 1,overflow=TextOverflow.Ellipsis)
                        }
                        TextButton(onClick={onOpen(notice)},contentPadding=PaddingValues(horizontal=12.dp,vertical=8.dp)){Text(if(question)"回答" else "查看",fontSize=13.sp)}
                        IconButton(onClick={onDismiss(notice.key)}){Icon(painterResource(R.drawable.ic_lucide_x),if(question)"关闭提问提示" else "关闭完成提示",Modifier.size(18.dp))}
                    }
                }
            }
            }
        }
    }
}
