package com.localcodex.control

import android.view.View
import android.os.Build
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.BlurEffect
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.layer.GraphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.ceil
import kotlinx.coroutines.flow.first

/** Source and consumers are separate drawing trees: a panel must never capture itself. */
internal data class NativeGlassPlacement(val coordinates:LayoutCoordinates,val windowOffset:Offset,val size:IntSize)

private fun glassPlacement(coordinates:LayoutCoordinates)=NativeGlassPlacement(coordinates,coordinates.positionInWindow(),coordinates.size)

internal class NativeGlassBackdrop(val layer:GraphicsLayer,var view:View) {
    var consumers by mutableIntStateOf(0)
    var frame by mutableIntStateOf(0)
    var placement by mutableStateOf<NativeGlassPlacement?>(null)
    val coordinates get()=placement?.coordinates
    var scrollMotion by mutableStateOf<(() -> Int)?>(null)
    var recorded=false
    private var generation=0
    fun rendered(){frame=++generation}
}

internal val LocalNativeGlassBackdrop=staticCompositionLocalOf<NativeGlassBackdrop?>{null}
internal val LocalNativeScrollBackdrop=staticCompositionLocalOf<NativeGlassBackdrop?>{null}
// Popups can extend beyond a card or composer. Their source must cover the
// surrounding viewport, while remaining outside the popup's own drawing tree.
internal val LocalNativeOverlayBackdrop=staticCompositionLocalOf<NativeGlassBackdrop?>{null}
internal val LocalNativeGlassMotion=staticCompositionLocalOf<()->Float>{{0f}}

internal suspend fun awaitNativeGlassBackdrop(backdrop:NativeGlassBackdrop?){
    if(backdrop!=null)snapshotFlow{backdrop.frame>0&&backdrop.coordinates?.isAttached==true}.first{it}
}

@Composable internal fun rememberNativeGlassBackdrop(mode:NativeGlassMode):NativeGlassBackdrop? {
    if(!mode.samplesBackdrop)return null
    val layer=rememberGraphicsLayer()
    val view=LocalView.current
    return remember(layer,view){NativeGlassBackdrop(layer,view)}
}

@Composable internal fun Modifier.nativeGlassSource(backdrop:NativeGlassBackdrop?,underlay:NativeGlassBackdrop?=null):Modifier {
    if(backdrop==null)return this
    val view=LocalView.current
    SideEffect{backdrop.view=view}
    val screen=remember{IntArray(2)}
    val window=remember{IntArray(2)}
    if(underlay!=null)DisposableEffect(underlay){
        underlay.consumers++
        onDispose{underlay.consumers--}
    }
    // Isolate the source from its consumers' invalidations. The frame signal is
    // only read by independent consumer layers, never by this drawing layer.
    // LayoutCoordinates can mutate in place. Capture position and size as
    // values so a moved/resized source invalidates its sampled background.
    return graphicsLayer().onGloballyPositioned{backdrop.placement=glassPlacement(it)}.drawWithContent {
        // Lazy items can move through child render layers without invalidating
        // this source's display list. Read scroll state here to refresh it.
        backdrop.scrollMotion?.invoke()
        if(backdrop.consumers==0){
            if(backdrop.recorded){
                // Drop the retained display list when the last panel closes.
                backdrop.layer.record(size=IntSize(1,1)){}
                backdrop.recorded=false
                backdrop.frame=0
            }
            drawContent()
        }else{
            backdrop.layer.record{
                val target=backdrop.coordinates
                val source=underlay?.coordinates
                if(underlay!=null&&underlay.frame>0&&target?.isAttached==true&&source?.isAttached==true&&!underlay.layer.isReleased){
                    val delta=screenOrigin(target,view,screen,window)-screenOrigin(source,underlay.view,screen,window)
                    translate(-delta.x,-delta.y){drawLayer(underlay.layer)}
                }
                this@drawWithContent.drawContent()
            }
            backdrop.recorded=true
            // The underlay is already on screen. Only the retained sample needs
            // the complete composite; drawing it again would duplicate scrims.
            if(underlay==null)drawLayer(backdrop.layer) else drawContent()
            backdrop.rendered()
        }
    }
}

/** Window offsets also cover Popup/Dialog windows; no screenshot or pixel readback is involved. */
private fun screenOrigin(coordinates:LayoutCoordinates,view:View,screen:IntArray,window:IntArray):Offset {
    view.getLocationOnScreen(screen)
    view.getLocationInWindow(window)
    return coordinates.positionInWindow()+Offset((screen[0]-window[0]).toFloat(),(screen[1]-window[1]).toFloat())
}

@Composable internal fun Modifier.nativeGaussianBackdrop(backdrop:NativeGlassBackdrop?,shape:Shape=RectangleShape,liquid:Boolean=false,frosted:Boolean=false):Modifier {
    if(backdrop==null)return this
    val effect=rememberGraphicsLayer()
    val motionFrame=LocalNativeGlassMotion.current
    val view=LocalView.current
    val material=LocalNativeTheme.current.material
    val radius=with(LocalDensity.current){(if(frosted)material.overlayBlurDp else material.blurDp).coerceAtLeast(.1f).dp.toPx()}
    val blur=remember(radius){BlurEffect(radius,radius,TileMode.Clamp)}
    val density=LocalDensity.current
    val lens=remember(liquid,density,radius){if(liquid&&Build.VERSION.SDK_INT>=33)with(density){NativeLiquidLens(radius,10.dp.toPx(),4.dp.toPx())} else null}
    var placement by remember{mutableStateOf<NativeGlassPlacement?>(null)}
    val screen=remember{IntArray(2)}
    val window=remember{IntArray(2)}
    DisposableEffect(backdrop){
        backdrop.consumers++
        onDispose{backdrop.consumers--}
    }
    // A parent graphicsLayer transform does not redraw its cached children.
    // Observe the same motion here, in an isolated background layer, so only
    // the sampled backdrop follows the panel's current screen position.
    return graphicsLayer().onGloballyPositioned{placement=glassPlacement(it)}.drawWithContent {
        motionFrame()
        backdrop.scrollMotion?.invoke()
        val target=placement?.coordinates
        val source=backdrop.coordinates
        if(backdrop.frame>0&&target?.isAttached==true&&source?.isAttached==true&&!backdrop.layer.isReleased){
            val delta=screenOrigin(target,view,screen,window)-screenOrigin(source,backdrop.view,screen,window)
            val padding=ceil(radius*2).toInt()
            val extent=IntSize(ceil(size.width).toInt()+padding*2,ceil(size.height).toInt()+padding*2)
            val outline=shape.createOutline(size,layoutDirection,this)
            val corner=(outline as? Outline.Rounded)?.roundRect?.topLeftCornerRadius?.x?:0f
            effect.renderEffect=if(Build.VERSION.SDK_INT>=33&&lens!=null)lens.effect(size.width,size.height,corner,padding.toFloat()) else blur
            effect.record(size=extent){
                translate(padding-delta.x,padding-delta.y){drawLayer(backdrop.layer)}
            }
            clipRect{translate(-padding.toFloat(),-padding.toFloat()){drawLayer(effect)}}
        }
        // The foreground text and controls are drawn after the blurred background.
        drawContent()
    }
}
