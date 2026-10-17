package com.localcodex.control

import androidx.compose.animation.core.animate
import androidx.compose.animation.core.spring
import androidx.compose.material.DrawerValue
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch

@Stable internal class NativeDrawerState(initial:DrawerValue=DrawerValue.Closed){
    var currentValue by mutableStateOf(initial);private set
    var targetValue by mutableStateOf(initial);private set
    var progress by mutableFloatStateOf(if(initial==DrawerValue.Open)1f else 0f);private set
    val isOpen get()=currentValue==DrawerValue.Open||targetValue==DrawerValue.Open||isAnimating
    var isAnimating by mutableStateOf(false);private set
    private var motion:Job?=null
    private var velocity=0f
    suspend fun open()=moveTo(DrawerValue.Open)
    suspend fun close()=moveTo(DrawerValue.Closed)
    private suspend fun moveTo(value:DrawerValue)=coroutineScope{
        motion?.cancel()
        // Cancel only the animation, preserving the caller's gesture/effect coroutine.
        val animation=launch(start=CoroutineStart.LAZY){
            try{
                animate(progress,if(value==DrawerValue.Open)1f else 0f,velocity,spring(dampingRatio=1f,stiffness=450f)){p,v->progress=p.coerceIn(0f,1f);velocity=v}
                currentValue=value;velocity=0f
            }finally{if(motion===currentCoroutineContext()[Job]){motion=null;isAnimating=false}}
        }
        motion=animation;targetValue=value;isAnimating=true
        animation.start();animation.join()
    }
    fun startDrag(){
        motion?.cancel();motion=null;velocity=0f
        if(progress>0f)targetValue=DrawerValue.Open
        isAnimating=false
    }
    fun dragBy(delta:Float,width:Float){
        progress=(progress+delta/width).coerceIn(0f,1f)
        if(progress>0f&&currentValue==DrawerValue.Closed)targetValue=DrawerValue.Open
    }
    suspend fun settle(pixelsPerSecond:Float,width:Float){
        velocity=pixelsPerSecond/width
        moveTo(if(velocity>0.6f||velocity>=-0.6f&&progress>=0.5f)DrawerValue.Open else DrawerValue.Closed)
    }
}

@Composable internal fun rememberNativeDrawerState():NativeDrawerState=rememberSaveable(saver=Saver(
    save={it.targetValue==DrawerValue.Open},restore={NativeDrawerState(if(it)DrawerValue.Open else DrawerValue.Closed)}
)){NativeDrawerState()}
