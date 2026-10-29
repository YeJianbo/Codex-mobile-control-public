package com.localcodex.control

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import androidx.compose.ui.window.PopupProperties
import kotlin.math.roundToInt

/** Position relative to the plot's actual touch, independently of the selected value. */
@Composable internal fun ChartCallout(touchPosition:State<Offset>,content:@Composable ()->Unit){
    val density=LocalDensity.current
    val view=LocalView.current
    val backdrop=LocalNativeOverlayBackdrop.current?:LocalNativeGlassBackdrop.current
    val anchor=remember{mutableStateOf<ChartCalloutAnchor?>(null)}
    val gap=with(density){48.dp.roundToPx()}
    val inset=with(density){8.dp.roundToPx()}
    val normalWidth=with(density){200.dp.roundToPx()}
    val touch=touchPosition.value
    val position=remember(touch,gap,inset){ChartCalloutPosition(touch,gap,inset)}
    Spacer(Modifier.fillMaxSize().onGloballyPositioned{coordinates->
        val frame=android.graphics.Rect()
        view.getWindowVisibleDisplayFrame(frame)
        anchor.value=ChartCalloutAnchor(coordinates.positionInWindow(),IntSize(frame.width(),frame.height()))
    })
    val measure=remember(anchor,touchPosition,gap,inset,normalWidth){androidx.compose.ui.layout.MeasurePolicy{measurables,constraints->
        val geometry=anchor.value
        if(geometry==null){
            // Wait for the plot coordinates before showing the window. No
            // wide first frame that then jumps to a narrower side callout.
            layout(0,0){}
        }else{
            val finger=geometry.origin+touchPosition.value
            val width=minOf(normalWidth,constraints.maxWidth,geometry.window.width-inset*2).coerceAtLeast(0)
            val content=measurables.single()
            val height=content.minIntrinsicHeight(width)
            val sideWidth=maxOf(finger.x-gap-inset,geometry.window.width-inset-finger.x-gap).toInt().coerceAtLeast(0)
            val limit=if(finger.y-gap-inset>=height)width else minOf(width,sideWidth)
            val bubble=content.measure(Constraints(maxWidth=limit,maxHeight=minOf(constraints.maxHeight,(geometry.window.height-inset*2).coerceAtLeast(0))))
            layout(bubble.width,bubble.height){bubble.place(0,0)}
        }
    }}
    // A separate, non-focusable window can extend above the plot without resizing
    // the card or interrupting the chart's in-progress drag gesture.
    Popup(popupPositionProvider=position,properties=PopupProperties(
        focusable=false,dismissOnBackPress=false,dismissOnClickOutside=false,
    )){
        CompositionLocalProvider(LocalNativeGlassBackdrop provides backdrop){
        Layout(content={NativeGlassSurface(shape=Radius.Inset,color=MaterialTheme.colors.surface,kind=NativeGlassKind.MENU,
            border=BorderStroke(.75.dp,MaterialTheme.colors.onSurface.copy(alpha=.10f)),
            elevation=3.dp,modifier=Modifier.testTag("chartCallout")){content()}},measurePolicy=measure)
        }
    }
}

private data class ChartCalloutAnchor(val origin:Offset,val window:IntSize)

private class ChartCalloutPosition(
    private val touch:Offset,
    private val fingerClearance:Int,
    private val inset:Int,
):PopupPositionProvider{
    override fun calculatePosition(anchorBounds:IntRect,windowSize:IntSize,layoutDirection:LayoutDirection,popupContentSize:IntSize):IntOffset{
        val fingerX=anchorBounds.left+touch.x.roundToInt()
        val fingerY=anchorBounds.top+touch.y.roundToInt()
        val maxX=(windowSize.width-popupContentSize.width-inset).coerceAtLeast(inset)
        val maxY=(windowSize.height-popupContentSize.height-inset).coerceAtLeast(inset)
        var left=(fingerX-popupContentSize.width/2).coerceIn(inset,maxX)
        val above=fingerY-fingerClearance-popupContentSize.height
        val top=above.coerceIn(inset,maxY)
        if(above<inset){
            // Near the window top, prefer the side with room instead of dropping
            // the label below the fingertip, where the hand would cover it.
            val right=fingerX+fingerClearance
            val leftSide=fingerX-fingerClearance-popupContentSize.width
            left=when{
                right<=maxX->right
                leftSide>=inset->leftSide
                fingerX<windowSize.width/2->maxX
                else->inset
            }
        }
        return IntOffset(left,top)
    }
}
