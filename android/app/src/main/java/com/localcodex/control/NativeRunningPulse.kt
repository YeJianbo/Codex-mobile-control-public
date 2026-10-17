package com.localcodex.control

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.MotionDurationScale
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.material.Text
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@OptIn(ExperimentalComposeUiApi::class)
@Composable internal fun rememberNativeRunningPulse(active:Boolean):State<Float>{
    val motionScale=rememberCoroutineScope().coroutineContext[MotionDurationScale]?.scaleFactor?:1f
    if(!active||motionScale==0f)return rememberUpdatedState(-1f)
    val transition=rememberInfiniteTransition(label="sidebarRunning")
    return transition.animateFloat(0f,1f,
        infiniteRepeatable(tween(1800,easing=LinearEasing),RepeatMode.Restart),label="sidebarRunningTextSweep")
}

@Composable internal fun NativeRunningTitle(text:String,pulse:State<Float>?,modifier:Modifier=Modifier,
    fontSize:TextUnit=15.sp,fontWeight:FontWeight=FontWeight.Normal,maxLines:Int=1){
    val inkWidth=remember{mutableFloatStateOf(0f)}
    Text(text,fontSize=fontSize,fontWeight=fontWeight,maxLines=maxLines,overflow=TextOverflow.Ellipsis,
        onTextLayout={layout->inkWidth.floatValue=(0 until layout.lineCount).maxOfOrNull{layout.getLineRight(it)-layout.getLineLeft(it)}?:0f},
        modifier=modifier.semantics{stateDescription="正在运行"}
            .graphicsLayer{compositingStrategy=CompositingStrategy.Offscreen}
            .drawWithCache{
                val width=inkWidth.floatValue.coerceIn(0f,size.width)
                val band=(width*0.5f).coerceIn(24.dp.toPx(),96.dp.toPx())
                val dim=Color.White.copy(alpha=0.32f)
                val mask=Brush.linearGradient(0f to dim,0.5f to Color.White,1f to dim,start=Offset.Zero,end=Offset(band,0f))
                onDrawWithContent{
                    drawContent()
                    val phase=pulse?.value?:-1f
                    if(phase>=0f&&width>0f){
                        val left=-band+(width+band)*phase
                        // Keep the shader cached and translate only its sweep. The
                        // offscreen mask affects glyphs, never the card background.
                        withTransform({translate(left=left)}){
                            drawRect(mask,topLeft=Offset(-left,0f),size=Size(size.width,size.height),blendMode=BlendMode.DstIn)
                        }
                    }
                }
            })
}
