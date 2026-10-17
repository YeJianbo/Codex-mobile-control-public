package com.localcodex.control

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.SubcomposeLayout
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

@Composable internal fun NativeConversationTitleFrame(modifier:Modifier,content:@Composable ()->Unit){
    if(LocalNativeFloatingChrome.current)NativeGlassSurface(modifier,shape=Radius.Chip,content=content)
    else Box(modifier,propagateMinConstraints=true){content()}
}

/** Both floating edges are measured before the list, without layout-to-composition state writes. */
@Composable internal fun ColumnScope.NativeConversationBody(
    liquid:Boolean,header:@Composable ()->Unit,messages:@Composable (Dp,Dp)->Unit,composer:@Composable ColumnScope.()->Unit,
) {
    // Keep the same slots across runtime theme changes so draft, focus and list
    // state survive switching between floating and standard layouts.
    val source=rememberNativeGlassBackdrop(LocalNativeGlassMode.current)
    SubcomposeLayout(Modifier.weight(1f).fillMaxWidth()){constraints->
        val toolbar=subcompose("toolbar"){
            CompositionLocalProvider(LocalNativeGlassBackdrop provides source,LocalNativeFloatingChrome provides liquid){header()}
        }.single().measure(constraints.copy(minHeight=0))
        val dock=subcompose("dock"){
            CompositionLocalProvider(LocalNativeGlassBackdrop provides source){Column(Modifier.fillMaxWidth(),content=composer)}
        }.single().measure(constraints.copy(minHeight=0,maxHeight=(constraints.maxHeight-toolbar.height).coerceAtLeast(0)))
        val topInset=toolbar.height.toDp()
        val bottomInset=dock.height.toDp()
        val sceneHeight=if(liquid)constraints.maxHeight else (constraints.maxHeight-toolbar.height-dock.height).coerceAtLeast(0)
        val scene=subcompose("scene"){
            Box(Modifier.fillMaxSize().nativeGlassSource(source).background(LocalNativeTheme.current.palette.chat).nativeGlassBackdrop()){
                Box(Modifier.fillMaxSize()){
                    CompositionLocalProvider(LocalNativeScrollBackdrop provides source){
                        messages(if(liquid)topInset else 0.dp,if(liquid)bottomInset else 0.dp)
                    }
                }
            }
        }.single().measure(constraints.copy(minHeight=sceneHeight,maxHeight=sceneHeight))
        layout(scene.width,constraints.maxHeight){
            scene.placeRelative(0,if(liquid)0 else toolbar.height)
            toolbar.placeRelative(0,0)
            dock.placeRelative(0,constraints.maxHeight-dock.height)
        }
    }
}

@Composable internal fun Modifier.nativeConversationEdgeFade(top:Dp,bottom:Dp):Modifier {
    val material=LocalNativeTheme.current.material
    val distance=material.edgeFadeDp
    if(distance<=0f)return this
    // Isolate only the foreground: DstIn must never erase or tint the chat
    // background. The cached mask follows measured chrome, not scroll state.
    return graphicsLayer { compositingStrategy=CompositingStrategy.Offscreen }.drawWithCache {
        val height=size.height.coerceAtLeast(1f)
        val upper=top.toPx().coerceIn(0f,height)
        val lower=(height-bottom.toPx()).coerceIn(upper,height)
        val fade=distance.dp.toPx()
        val topEnd=(upper+fade).coerceAtMost(lower)
        // Keep messages visible beneath floating chrome. Only a short band
        // softens at each reading edge; neither side becomes an empty strip.
        val edge=Color.Black.copy(alpha=material.edgeFadeMinAlpha)
        val mask=Brush.verticalGradient(
            0f to edge,
            (upper/height) to edge,
            (topEnd/height) to Color.Black,
            (lower/height) to Color.Black,
            ((lower+fade).coerceAtMost(height)/height) to edge,
            1f to edge,
            endY=height,
        )
        onDrawWithContent{
            drawContent()
            drawRect(mask,blendMode=BlendMode.DstIn)
        }
    }
}
