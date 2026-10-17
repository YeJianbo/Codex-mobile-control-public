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
            onPosition(down.position,size)
            while(true){
                val change=awaitPointerEvent().changes.firstOrNull{it.id==down.id}?:break
                if(!change.pressed||change.isConsumed)break
                val offset=change.position
                if(offset.x !in 0f..size.width.toFloat()||offset.y !in 0f..size.height.toFloat()){onRelease();continue}
                val delta=offset-down.position
                if(abs(delta.y)>viewConfiguration.touchSlop&&abs(delta.y)>abs(delta.x))break
                if(abs(delta.x)>viewConfiguration.touchSlop)change.consume()
                onPosition(offset,size)
            }
        }finally{onRelease()}
    }
}
