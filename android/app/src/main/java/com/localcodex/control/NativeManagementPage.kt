package com.localcodex.control

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

internal val LocalManagementPageActive=compositionLocalOf{true}

/** Management destinations share the Activity window, so native dialog margins cannot resize the page. */
@Composable internal fun NativeManagementPage(
    title:String,subtitle:String,onBack:()->Unit,modifier:Modifier=Modifier,
    actions:@Composable RowScope.()->Unit={},content:@Composable ColumnScope.()->Unit
){
    BackHandler(enabled=LocalManagementPageActive.current,onBack=onBack)
    val focus=LocalFocusManager.current
    LaunchedEffect(Unit){focus.clearFocus()}
    val window=(LocalContext.current as? android.app.Activity)?.window
    val light=MaterialTheme.colors.isLight
    DisposableEffect(window){
        val status=window?.statusBarColor;val navigation=window?.navigationBarColor
        val controller=window?.let{WindowCompat.getInsetsController(it,it.decorView)}
        val statusIcons=controller?.isAppearanceLightStatusBars;val navigationIcons=controller?.isAppearanceLightNavigationBars
        onDispose{if(window!=null){
            status?.let{window.statusBarColor=it};navigation?.let{window.navigationBarColor=it}
            statusIcons?.let{controller?.isAppearanceLightStatusBars=it};navigationIcons?.let{controller?.isAppearanceLightNavigationBars=it}
        }}
    }
    SideEffect{window?.let{
        WindowCompat.setDecorFitsSystemWindows(it,false)
        it.statusBarColor=android.graphics.Color.TRANSPARENT;it.navigationBarColor=android.graphics.Color.TRANSPARENT
        WindowCompat.getInsetsController(it,it.decorView).apply{isAppearanceLightStatusBars=light;isAppearanceLightNavigationBars=light}
        if(android.os.Build.VERSION.SDK_INT>=29){it.isStatusBarContrastEnforced=false;it.isNavigationBarContrastEnforced=false}
    }}
    val glassBackdrop=rememberNativeGlassBackdrop(LocalNativeGlassMode.current)
    val liquid=LocalNativeTheme.current.floating
    CompositionLocalProvider(LocalNativeGlassBackdrop provides glassBackdrop,LocalNativeOverlayBackdrop provides glassBackdrop){
    BoxWithConstraints(Modifier.fillMaxSize().nativeGlassSource(glassBackdrop).background(MaterialTheme.colors.background).nativeGlassBackdrop().semantics{paneTitle=title}
        .pointerInput(Unit){awaitPointerEventScope{while(true)awaitPointerEvent()}}
        .statusBarsPadding().navigationBarsPadding().imePadding(),contentAlignment=Alignment.Center){
        val roomy=maxWidth>=600.dp
        Surface(modifier.padding(horizontal=if(roomy)24.dp else 0.dp).widthIn(max=960.dp).fillMaxWidth().fillMaxHeight(),
            color=if(liquid)Color.Transparent else MaterialTheme.colors.background,shape=if(roomy)Radius.Panel else RectangleShape){
            Column(Modifier.fillMaxSize()){
                NativeLiquidSurface(Modifier.padding(horizontal=if(liquid)16.dp else 0.dp,vertical=if(liquid)8.dp else 0.dp).fillMaxWidth(),
                    color=if(liquid)MaterialTheme.colors.surface else MaterialTheme.colors.background,shape=if(liquid)Radius.Panel else RectangleShape,kind=NativeGlassKind.INSET){
                Row(Modifier.fillMaxWidth().heightIn(min=56.dp).testTag("managementToolbar").padding(horizontal=8.dp),verticalAlignment=Alignment.CenterVertically){
                    IconButton(onClick=onBack){Icon(painterResource(R.drawable.ic_lucide_arrow_left),"返回")}
                    Row(Modifier.weight(1f).padding(horizontal=4.dp),verticalAlignment=Alignment.CenterVertically){
                        Text(title,fontSize=18.sp,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.weight(1f))
                        if(roomy&&subtitle.isNotBlank())Text(subtitle,fontSize=12.sp,color=MaterialTheme.colors.onSurface.copy(alpha=.65f),maxLines=1,overflow=TextOverflow.Ellipsis,modifier=Modifier.padding(start=12.dp).widthIn(max=220.dp))
                    }
                    actions()
                }
                }
                content()
            }
        }
    }
    }
}
