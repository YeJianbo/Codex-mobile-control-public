package com.localcodex.control

import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize

internal enum class NativePopupPlacement { OVER_ANCHOR,ADJACENT }

internal fun nativePopupPlacement(anchor:IntRect,window:IntSize,popup:IntSize,margin:Int,placement:NativePopupPlacement=NativePopupPlacement.ADJACENT):Pair<IntOffset,TransformOrigin>{
    val preferredX=if(anchor.left+anchor.right>window.width)anchor.right-popup.width else anchor.left
    val x=preferredX.coerceIn(margin,(window.width-popup.width-margin).coerceAtLeast(margin))
    val below=anchor.bottom+margin
    val above=anchor.top-popup.height-margin
    val y=if(placement==NativePopupPlacement.OVER_ANCHOR){
        val preferredY=if(anchor.top+anchor.bottom>window.height)anchor.bottom-popup.height else anchor.top
        preferredY.coerceIn(margin,(window.height-popup.height-margin).coerceAtLeast(margin))
    }else if(below+popup.height<=window.height-margin)below else above.coerceAtLeast(margin)
    // Pivot towards the trigger after edge clamping; only the drawing layer
    // consumes the pivot, so placement does not invalidate composition.
    val pivotX=((anchor.left+anchor.right)/2f-x).div(popup.width.coerceAtLeast(1)).coerceIn(0f,1f)
    val pivotY=((anchor.top+anchor.bottom)/2f-y).div(popup.height.coerceAtLeast(1)).coerceIn(0f,1f)
    return IntOffset(x,y) to TransformOrigin(pivotX,pivotY)
}
