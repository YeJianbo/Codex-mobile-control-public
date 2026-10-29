package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Confirmation content keeps its actions while sharing the active overlay material. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun NativeAlertDialog(
    onDismissRequest:()->Unit,
    confirmButton:@Composable ()->Unit,
    modifier:Modifier=Modifier,
    dismissButton:(@Composable ()->Unit)?=null,
    title:(@Composable ()->Unit)?=null,
    text:(@Composable ()->Unit)?=null,
    properties:DialogProperties=DialogProperties(),
){
    if(!LocalNativeGlassMode.current.floatingChrome){
        AlertDialog(onDismissRequest,confirmButton,modifier,dismissButton,title,text,shape=Radius.Panel,properties=properties)
        return
    }
    val backdrop=LocalNativeOverlayBackdrop.current?:LocalNativeGlassBackdrop.current
    Dialog(onDismissRequest,properties){
        CompositionLocalProvider(LocalNativeGlassBackdrop provides backdrop,LocalContentColor provides NativeInk){
            NativeGlassSurface(modifier.widthIn(max=560.dp).fillMaxWidth().testTag("nativeAlertSurface"),
                shape=Radius.Panel,kind=NativeGlassKind.MENU){
                Column(Modifier.padding(top=24.dp,bottom=8.dp)){
                    title?.let{content->
                        Box(Modifier.padding(horizontal=24.dp).padding(bottom=16.dp)){
                            ProvideTextStyle(MaterialTheme.typography.h6){content()}
                        }
                    }
                    text?.let{content->
                        Box(Modifier.weight(1f,fill=false).padding(horizontal=24.dp).padding(bottom=16.dp)){
                            CompositionLocalProvider(LocalContentAlpha provides ContentAlpha.medium){
                                ProvideTextStyle(MaterialTheme.typography.body1){content()}
                            }
                        }
                    }
                    FlowRow(Modifier.fillMaxWidth().padding(horizontal=8.dp),
                        horizontalArrangement=Arrangement.spacedBy(8.dp,androidx.compose.ui.Alignment.End)){
                        dismissButton?.invoke()
                        confirmButton()
                    }
                }
            }
        }
    }
}
