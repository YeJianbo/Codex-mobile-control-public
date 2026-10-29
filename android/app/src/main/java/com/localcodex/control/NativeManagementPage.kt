package com.localcodex.control

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat

internal val LocalManagementPageActive=compositionLocalOf{true}

/** Management destinations share the Activity window, so native dialog margins cannot resize the page. */
@Composable internal fun NativeManagementPage(
    title:String,subtitle:String,onBack:()->Unit,modifier:Modifier=Modifier,
    actions:@Composable RowScope.()->Unit={},pinnedContent:@Composable ColumnScope.()->Unit={},content:@Composable ColumnScope.()->Unit
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
    val liquid=LocalNativeTheme.current.floating
    BoxWithConstraints(Modifier.fillMaxSize().background(MaterialTheme.colors.background).nativeGlassBackdrop().semantics{paneTitle=title}
        .pointerInput(Unit){awaitPointerEventScope{while(true)awaitPointerEvent()}}
        .statusBarsPadding().navigationBarsPadding().imePadding(),contentAlignment=Alignment.Center){
        val roomy=maxWidth>=600.dp
        Surface(modifier.padding(horizontal=if(roomy)24.dp else 0.dp).widthIn(max=960.dp).fillMaxWidth().fillMaxHeight(),
            color=if(liquid)Color.Transparent else MaterialTheme.colors.background,shape=if(roomy)Radius.Panel else RectangleShape){
            NativeReaderLayout(header={
                Column{
                    NativeReaderToolbar(title,"返回",onBack,Modifier.testTag("managementToolbar"),
                        subtitle=if(roomy)subtitle else "",actions=actions)
                    pinnedContent()
                }
            }){topInset->
                CompositionLocalProvider(LocalNativeManagementTopInset provides topInset){
                    Column(Modifier.fillMaxSize().nativeSettingsEdgeFade(),content=content)
                }
            }
        }
    }
}

/** Management reading edges are shorter than chat's; floating chrome samples the scene separately. */
private fun Modifier.nativeSettingsEdgeFade():Modifier=graphicsLayer{
    compositingStrategy=CompositingStrategy.Offscreen
}.drawWithCache{
    val height=size.height.coerceAtLeast(1f)
    val top=18.dp.toPx().coerceAtMost(height*.25f)
    val bottom=26.dp.toPx().coerceAtMost(height*.25f)
    val mask=Brush.verticalGradient(
        0f to Color.Black.copy(alpha=.18f),
        top/height to Color.Black,
        1f-bottom/height to Color.Black,
        1f to Color.Black.copy(alpha=.12f),endY=height,
    )
    onDrawWithContent{drawContent();drawRect(mask,blendMode=BlendMode.DstIn)}
}
