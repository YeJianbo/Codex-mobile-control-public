package com.localcodex.control

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterialApi::class)
@Composable internal fun NativeAdaptiveDrawer(
    expanded:Boolean,
    sidebarVisible:Boolean,
    drawerState:NativeDrawerState,
    gesturesEnabled:Boolean,
    drawerBackgroundColor:Color,
    contentBackgroundColor:Color,
    contentCornerRadius:Dp,
    scrimColor:Color,
    drawerContent:@Composable ColumnScope.()->Unit,
    modifier:Modifier=Modifier,
    content:@Composable ()->Unit,
){
    val liquid=LocalNativeTheme.current.floating
    if(expanded){
        Row(modifier.fillMaxSize().then(if(liquid)Modifier.nativeGlassBackdrop() else Modifier).testTag("expandedLayout")){
            if(sidebarVisible){
                NativeSidebarFrame(Modifier.width(304.dp).fillMaxHeight().testTag("persistentSidebar"),drawerBackgroundColor,drawerContent)
                Divider(Modifier.fillMaxHeight().width(1.dp),color=MaterialTheme.colors.onSurface.copy(alpha=.06f))
            }
            Box(Modifier.weight(1f).fillMaxHeight(),contentAlignment=Alignment.TopCenter){
                Box(Modifier.widthIn(max=840.dp).fillMaxSize(),propagateMinConstraints=true){content()}
            }
        }
    }else{
        val scope=rememberCoroutineScope()
        BoxWithConstraints(modifier.fillMaxSize().background(drawerBackgroundColor).nativeGlassBackdrop()){
            val width=(maxWidth-(if(liquid)40.dp else 24.dp)).coerceAtMost(if(liquid)336.dp else 360.dp).coerceAtLeast(1.dp)
            val widthPx=with(LocalDensity.current){width.toPx()}
            val drag=rememberDraggableState{drawerState.dragBy(it,widthPx)}
            Box(Modifier.fillMaxSize().draggable(drag,Orientation.Horizontal,enabled=gesturesEnabled,
                startDragImmediately=drawerState.isAnimating,
                onDragStarted={drawerState.startDrag()},onDragStopped={drawerState.settle(it,widthPx)})){
                // Both layers follow the same gesture, with a small depth offset
                // in the sidebar rather than another independently timed effect.
                NativeSidebarFrame(Modifier.width(width).fillMaxHeight().graphicsLayer{
                    translationX=-18.dp.toPx()*(1f-drawerState.progress)
                }.testTag("drawerSidebar")
                    .then(if(drawerState.isOpen)Modifier else Modifier.clearAndSetSemantics{}),drawerBackgroundColor,drawerContent)
                // Fixed chat corners expose this layer even at rest; cover and block hidden rows there.
                if(!drawerState.isOpen)Box(Modifier.width(width).fillMaxHeight().background(drawerBackgroundColor).pointerInput(Unit){
                    awaitPointerEventScope{while(true)awaitPointerEvent()}
                })
                Box(Modifier.fillMaxSize().graphicsLayer{
                    val p=drawerState.progress
                    translationX=widthPx*p
                    shape=RoundedCornerShape(contentCornerRadius)
                    clip=true
                }.testTag("drawerChat").background(contentBackgroundColor).pointerInput(Unit){
                    // Keep covered sidebar rows out of hit testing, without consuming chat/drag gestures.
                    awaitPointerEventScope{while(true)awaitPointerEvent()}
                }){
                    Box(Modifier.fillMaxSize().then(if(drawerState.isOpen)Modifier.clearAndSetSemantics{} else Modifier)){content()}
                    if(drawerState.isOpen)Box(Modifier.fillMaxSize().testTag("drawerDismiss")
                        .semantics{contentDescription="返回聊天"}
                        .drawBehind{drawRect(scrimColor.copy(alpha=scrimColor.alpha*drawerState.progress))}
                        .clickable{scope.launch{drawerState.close()}})
                }
            }
        }
    }
}

@Composable private fun NativeSidebarFrame(modifier:Modifier,color:Color,content:@Composable ColumnScope.()->Unit){
    val theme=LocalNativeTheme.current
    Box(modifier.background(color).nativeGlassBackdrop()){
        if(theme.floating&&!theme.dark)Box(Modifier.matchParentSize().background(theme.palette.surface.copy(alpha=.22f)))
        Column(Modifier.fillMaxSize(),content=content)
    }
}

@Composable internal fun Modifier.nativeSidebarEdgeFade(list:LazyListState):Modifier{
    val distance=LocalNativeTheme.current.material.sidebarFadeDp
    if(distance<=0f)return this
    // One cached mask softens both scrolling edges; fixed controls stay clear.
    return graphicsLayer{compositingStrategy=CompositingStrategy.Offscreen}.drawWithCache{
        val height=size.height.coerceAtLeast(1f)
        val fade=distance.dp.toPx().coerceAtMost(height*.45f)
        val mask=Brush.verticalGradient(0f to Color.Transparent,(fade/height) to Color.Black,
            (1f-fade/height) to Color.Black,1f to Color.Transparent,endY=height)
        val bottomMask=Brush.verticalGradient(0f to Color.Black,(1f-fade/height) to Color.Black,
            1f to Color.Transparent,endY=height)
        onDrawWithContent{
            drawContent()
            // Read scroll state only while drawing; the first row stays clear at rest.
            drawRect(if(list.canScrollBackward)mask else bottomMask,blendMode=BlendMode.DstIn)
        }
    }
}
