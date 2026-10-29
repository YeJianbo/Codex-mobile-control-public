package com.localcodex.control

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.IntSize
import kotlin.math.abs

internal fun Modifier.nativeChartPress(key:Any,onPosition:(Offset,IntSize)->Unit,onRelease:()->Unit)=pointerInput(key){
    awaitEachGesture{
        val down=awaitFirstDown(requireUnconsumed=false)
        try{
            var position=down.position
            // A vertical page scroll must resolve before showing any callout.
            // Horizontal intent starts immediately; a stationary press waits
            // briefly, without consuming the parent's scroll gesture.
            val intent=withTimeoutOrNull(140L){
                var decided:Boolean?=null
                while(decided==null){
                    val change=awaitPointerEvent().changes.firstOrNull{it.id==down.id}
                    if(change==null||!change.pressed||change.isConsumed){decided=false;continue}
                    position=change.position
                    val delta=position-down.position
                    decided=when{
                        position.x !in 0f..size.width.toFloat()||position.y !in 0f..size.height.toFloat()->false
                        abs(delta.y)>viewConfiguration.touchSlop&&abs(delta.y)>abs(delta.x)->false
                        abs(delta.x)>viewConfiguration.touchSlop->{change.consume();true}
                        else->null
                    }
                }
                decided==true
            }
            if(intent==false)return@awaitEachGesture
            onPosition(position,size)
            // Once a horizontal drag or hold owns the gesture, keep that
            // ownership until release. Finger drift must not restart selection
            // or hand a partly completed chart drag back to page scrolling.
            while(true){
                val change=awaitPointerEvent().changes.firstOrNull{it.id==down.id}?:break
                if(!change.pressed||change.isConsumed)break
                val offset=Offset(change.position.x.coerceIn(0f,size.width.toFloat()),change.position.y.coerceIn(0f,size.height.toFloat()))
                change.consume()
                onPosition(offset,size)
            }
        }finally{onRelease()}
    }
}
