package com.localcodex.control

import android.graphics.RenderEffect
import android.graphics.RuntimeShader
import android.graphics.Shader
import androidx.annotation.RequiresApi
import androidx.compose.ui.graphics.asComposeRenderEffect

/** A single background sample bends only in the rounded edge band; foreground content stays sharp. */
@RequiresApi(33)
internal class NativeLiquidLens(private val blurRadius:Float,private val edgeWidth:Float,private val strength:Float) {
    private val shader=RuntimeShader("""
        uniform shader scene;
        uniform float2 bounds;
        uniform float padding;
        uniform float corner;
        uniform float edgeWidth;
        uniform float strength;
        half4 main(float2 position) {
            float2 local=position-float2(padding)-bounds*0.5;
            float2 q=abs(local)-(bounds*0.5-float2(corner));
            float d=length(max(q,float2(0.0)))+min(max(q.x,q.y),0.0)-corner;
            float2 normal;
            if(q.x>0.0&&q.y>0.0)normal=normalize(sign(local)*q);
            else if(q.x>q.y)normal=float2(sign(local.x),0.0);
            else normal=float2(0.0,sign(local.y));
            float rim=1.0-smoothstep(0.0,edgeWidth,max(-d,0.0));
            return scene.eval(position-normal*(strength*rim*rim));
        }
    """.trimIndent())
    private val blur=RenderEffect.createBlurEffect(blurRadius,blurRadius,Shader.TileMode.CLAMP)
    private var lastWidth=Float.NaN
    private var lastHeight=Float.NaN
    private var lastCorner=Float.NaN
    private var lastPadding=Float.NaN
    private var cached:androidx.compose.ui.graphics.RenderEffect?=null
    fun effect(width:Float,height:Float,corner:Float,padding:Float):androidx.compose.ui.graphics.RenderEffect {
        if(lastWidth!=width||lastHeight!=height||lastCorner!=corner||lastPadding!=padding){
            shader.setFloatUniform("bounds",width,height)
            shader.setFloatUniform("padding",padding)
            shader.setFloatUniform("corner",corner)
            shader.setFloatUniform("edgeWidth",edgeWidth)
            shader.setFloatUniform("strength",strength)
            cached=RenderEffect.createChainEffect(RenderEffect.createRuntimeShaderEffect(shader,"scene"),blur).asComposeRenderEffect()
            lastWidth=width;lastHeight=height;lastCorner=corner;lastPadding=padding
        }
        return checkNotNull(cached)
    }
}
