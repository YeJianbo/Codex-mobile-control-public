package com.localcodex.control

import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import org.junit.Assert.*
import org.junit.Test

class NativePopupTest {
    @Test fun bottomTriggerExpandsUpAndTopTriggerExpandsDown(){
        val window=IntSize(400,800);val popup=IntSize(240,200)
        val bottom=nativePopupPlacement(IntRect(320,740,368,788),window,popup,8)
        assertEquals(532,bottom.first.y)
        assertEquals(1f,bottom.second.pivotFractionY)
        assertEquals(0.9f,bottom.second.pivotFractionX,0.001f)
        val top=nativePopupPlacement(IntRect(12,12,60,60),window,popup,8)
        assertEquals(68,top.first.y)
        assertEquals(0f,top.second.pivotFractionY)
        assertEquals(0.1f,top.second.pivotFractionX,0.001f)
    }
    @Test fun edgeClampingKeepsPivotPointingAtTrigger(){
        val placement=nativePopupPlacement(IntRect(380,50,400,98),IntSize(400,800),IntSize(240,200),8)
        assertEquals(152,placement.first.x)
        assertTrue(placement.second.pivotFractionX in 0f..1f)
        assertEquals(0f,placement.second.pivotFractionY)
    }
}
