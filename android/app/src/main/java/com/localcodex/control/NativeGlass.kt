package com.localcodex.control

import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.material.Text
import androidx.compose.ui.unit.sp
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke

internal enum class NativeGlassMode(val stored:String,val title:String) {
    OFF("off","标准外观"),LIGHT("light","液态轻量"),LIQUID("liquid","液态玻璃");
    val floatingChrome get()=this!=OFF
    val samplesBackdrop get()=this==LIQUID
    companion object {fun from(value:String?)=if(value=="soft")LIGHT else entries.firstOrNull{it.stored==value}?:OFF}
}
internal enum class NativeGlassKind { PANEL,CHROME,SHEET,INSET,MENU,DOCK }
internal val LocalNativeGlassMode=staticCompositionLocalOf{NativeGlassMode.OFF}
internal val LocalNativeFloatingChrome=staticCompositionLocalOf{false}

/** Inset cards reuse their parent's sampled backing instead of sampling a tree containing themselves. */
@Composable internal fun NativeLiquidSurface(
    modifier:Modifier=Modifier,shape:Shape=Radius.Panel,color:Color=MaterialTheme.colors.surface,
    border:BorderStroke?=null,kind:NativeGlassKind=NativeGlassKind.PANEL,content:@Composable ()->Unit,
){
    if(LocalNativeGlassMode.current.floatingChrome)NativeGlassSurface(modifier,shape,color,border,kind=kind,content=content)
    else Surface(modifier,shape,color,border=border,content=content)
}

internal fun nativeGlassPolicy(mode:NativeGlassMode,supported:Boolean=Build.VERSION.SDK_INT>=31):NativeGlassMode =
    if(mode.samplesBackdrop&&!supported)NativeGlassMode.LIGHT else mode

@Composable internal fun Modifier.nativeGlassBackdrop():Modifier {
    if(LocalNativeGlassMode.current==NativeGlassMode.OFF)return this
    val palette=LocalNativeTheme.current.palette
    return drawWithCache {
        val wash=Brush.verticalGradient(listOf(palette.gradientStart,palette.chat,palette.gradientEnd))
        onDrawBehind{drawRect(wash)}
    }
}

/** Only independent overlays sample the source; inset cards share the already sampled backing. */
@Composable internal fun NativeGlassSurface(
    modifier:Modifier=Modifier,shape:Shape=RectangleShape,color:Color=MaterialTheme.colors.surface,
    border:BorderStroke?=null,elevation:Dp=0.dp,kind:NativeGlassKind=NativeGlassKind.PANEL,
    content:@Composable ()->Unit,
){
    val mode=LocalNativeGlassMode.current
    if(mode==NativeGlassMode.OFF){Surface(modifier,shape,color,border=border,elevation=elevation,content=content);return}
    val light=MaterialTheme.colors.isLight
    val material=LocalNativeTheme.current.material
    if(mode==NativeGlassMode.LIGHT){
        // The same floating geometry without backdrop capture, blur, lens or sheen layers.
        val outline=LocalNativeTheme.current.palette.ink.copy(alpha=if(light).065f else .10f)
        Surface(modifier,shape,color.copy(alpha=material.opacity(kind,light)),
            border=border?:BorderStroke(material.edgeDp.dp,outline),elevation=0.dp,content=content)
        return
    }
    val frosted=kind==NativeGlassKind.SHEET||kind==NativeGlassKind.MENU
    val edge=remember(light,kind,material.edgeDp){
        if(kind==NativeGlassKind.INSET||frosted)BorderStroke(material.edgeDp.dp,Brush.verticalGradient(
            if(light)listOf(Color.White.copy(alpha=if(frosted).82f else .55f),Color.Black.copy(alpha=.045f),Color.Black.copy(alpha=.09f))
            else listOf(Color.White.copy(alpha=.30f),Color.White.copy(alpha=.075f),Color.Black.copy(alpha=.20f))))
        else BorderStroke(1.1.dp,Brush.verticalGradient(listOf(
            Color.White.copy(alpha=if(light).78f else .58f),
            Color.White.copy(alpha=if(light).16f else .10f),
            Color.Black.copy(alpha=if(light).10f else .24f))))
    }
    val samples=kind==NativeGlassKind.PANEL||kind==NativeGlassKind.DOCK||frosted
    val backdrop=LocalNativeGlassBackdrop.current.takeIf{mode.samplesBackdrop&&samples}
    val nestedBackdrop=rememberNativeGlassBackdrop(if(samples)mode else NativeGlassMode.OFF)
    val tint=material.opacity(kind,light)
    // Surface's opaque backing would cover the sampled scene, so tint is drawn inside its clip.
    CompositionLocalProvider(LocalNativeGlassBackdrop provides (nestedBackdrop?:LocalNativeGlassBackdrop.current)){
    // Keep the shadow faint and outside the material layer: the default opaque
    // elevation shadow would gray the whole transparent panel interior.
    val overlayShadow=if(frosted)Modifier.shadow(material.shadowDp.dp,shape,clip=false,
        ambientColor=Color.Black.copy(alpha=if(light).08f else .20f),
        spotColor=Color.Black.copy(alpha=if(light).10f else .26f)) else Modifier
    Surface(modifier.then(overlayShadow).nativeGlassSource(nestedBackdrop),shape,Color.Transparent,border=edge,elevation=0.dp){
        Box(propagateMinConstraints=true) {
            Box(Modifier.matchParentSize().clipToBounds().nativeGaussianBackdrop(backdrop,shape,liquid=true,frosted=frosted)
                .background(color.copy(alpha=tint))){
                Box(Modifier.matchParentSize()
                    .drawWithCache{
                        val sheen=Brush.verticalGradient(listOf(Color.White.copy(alpha=.045f),Color.Transparent),
                            endY=size.minDimension.coerceAtLeast(1f))
                        val outline=shape.createOutline(size,layoutDirection,this)
                        val corner=(outline as? Outline.Rounded)?.roundRect?.topLeftCornerRadius?.x?:0f
                        val rim=Brush.verticalGradient(listOf(Color.White.copy(alpha=.28f),Color.Transparent))
                        val inset=1.8.dp.toPx()
                        val rimStroke=Stroke(.55.dp.toPx())
                        onDrawBehind{
                            drawRect(sheen)
                            if(size.minDimension>inset*2){
                                drawRoundRect(rim,Offset(inset,inset),Size(size.width-2*inset,size.height-2*inset),
                                    CornerRadius((corner-inset).coerceAtLeast(0f)),style=rimStroke)
                            }
                        }
                    })
            }
            content()
        }
    }
    }
}

@Composable internal fun NativeGlassPreview(mode:NativeGlassMode) {
    val source=rememberNativeGlassBackdrop(mode)
    val palette=LocalNativeTheme.current.palette
    CompositionLocalProvider(LocalNativeGlassBackdrop provides source){
        Box(Modifier.fillMaxWidth().height(164.dp).clip(Radius.Card)){
            Box(Modifier.matchParentSize().nativeGlassSource(source)
                .background(Brush.linearGradient(listOf(palette.gradientStart,palette.chat,palette.gradientEnd)))){
                Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Text("Aa  12",fontSize=32.sp,color=palette.ink)
                    repeat(3){index->Box(Modifier.width((240-index*32).dp).height(12.dp).background(palette.ink.copy(alpha=.35f),Radius.Tiny))}
                }
            }
            NativeGlassSurface(Modifier.align(Alignment.CenterEnd).padding(14.dp).width(196.dp),shape=Radius.Card){
                Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                    Text(mode.title,fontSize=16.sp)
                    Text(when(mode){NativeGlassMode.LIQUID->"通透背景 · 折射亮边";NativeGlassMode.LIGHT->"柔和半透明 · 轻量绘制";else->"纯色面板"},fontSize=13.sp)
                }
            }
        }
    }
}
