package com.localcodex.control

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties

/** Full-screen readers cover the host window, including the system-bar areas. */
@Composable internal fun NativeReaderDialog(
    close:()->Unit,
    modifier:Modifier=Modifier,
    overlay:(@Composable ()->Unit)?=null,
    header:@Composable ()->Unit,
    content:@Composable (Dp)->Unit,
){
    val background=MaterialTheme.colors.background.copy(alpha=1f)
    // Let the native MATCH_PARENT window supply the full display constraints.
    // Compose's custom-width Dialog instead caps height at screenHeightDp.
    Dialog(onDismissRequest=close,properties=DialogProperties(
        dismissOnClickOutside=false,usePlatformDefaultWidth=true,decorFitsSystemWindows=false,
    )){
        val source=rememberNativeGlassBackdrop(LocalNativeGlassMode.current)
        NativeDialogSystemBars(background=background,edgeToEdge=true)
        CompositionLocalProvider(LocalNativeGlassBackdrop provides source,LocalNativeOverlayBackdrop provides source){
        Box(modifier.fillMaxSize().background(background)){
            Box(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)){
                NativeReaderLayout(header=header,source=source,content=content)
            }
            overlay?.invoke()
        }
        }
    }
}

/** The toolbar samples only this reader's scene, never the Activity behind it. */
@Composable internal fun NativeReaderLayout(header:@Composable ()->Unit,source:NativeGlassBackdrop?=rememberNativeGlassBackdrop(LocalNativeGlassMode.current),content:@Composable (Dp)->Unit){
    val floating=LocalNativeGlassMode.current.floatingChrome
    val background=MaterialTheme.colors.background
    SubcomposeLayout(Modifier.fillMaxSize()){constraints->
        val toolbar=subcompose("toolbar"){
            CompositionLocalProvider(LocalNativeGlassBackdrop provides source,LocalNativeOverlayBackdrop provides source,LocalNativeFloatingChrome provides floating){
                Box(Modifier.fillMaxWidth()){header()}
            }
        }.single().measure(constraints.copy(minHeight=0))
        val sceneHeight=if(floating)constraints.maxHeight else (constraints.maxHeight-toolbar.height).coerceAtLeast(0)
        val scene=subcompose("scene"){
            Box(Modifier.fillMaxSize().nativeGlassSource(source).background(background).nativeGlassBackdrop()){
                CompositionLocalProvider(LocalNativeScrollBackdrop provides source,LocalNativeOverlayBackdrop provides source){content(if(floating)toolbar.height.toDp() else 0.dp)}
            }
        }.single().measure(constraints.copy(minHeight=sceneHeight,maxHeight=sceneHeight))
        layout(scene.width,constraints.maxHeight){
            scene.placeRelative(0,if(floating)0 else toolbar.height)
            toolbar.placeRelative(0,0)
        }
    }
}

@Composable internal fun NativeReaderToolbar(
    title:String,closeDescription:String,onClose:()->Unit,
    modifier:Modifier=Modifier,subtitle:String="",actions:@Composable RowScope.()->Unit={},
){
    val floating=LocalNativeFloatingChrome.current
    Row(modifier.fillMaxWidth().heightIn(min=56.dp).padding(horizontal=if(floating)12.dp else 8.dp,vertical=4.dp)
        .testTag("readerToolbar"),verticalAlignment=Alignment.CenterVertically,
        horizontalArrangement=Arrangement.spacedBy(if(floating)6.dp else 0.dp)){
        ChromeButton(R.drawable.ic_lucide_arrow_left,closeDescription,onClose)
        NativeConversationTitleFrame(Modifier.weight(1f)){
            Column(Modifier.fillMaxWidth().heightIn(min=if(floating)48.dp else 0.dp)
                .padding(horizontal=if(floating)14.dp else 6.dp,vertical=if(floating)5.dp else 0.dp),
                verticalArrangement=Arrangement.spacedBy(1.dp,Alignment.CenterVertically)){
                Text(title,fontSize=16.sp,lineHeight=20.sp,fontWeight=FontWeight.Medium,color=NativeInk,maxLines=1,overflow=TextOverflow.Ellipsis)
                if(subtitle.isNotBlank())Text(subtitle,fontSize=12.sp,lineHeight=16.sp,color=NativeMuted,maxLines=1,overflow=TextOverflow.Ellipsis)
            }
        }
        actions()
    }
}
