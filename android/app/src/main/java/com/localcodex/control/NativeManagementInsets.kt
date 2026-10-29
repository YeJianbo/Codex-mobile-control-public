package com.localcodex.control

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.dp

internal val LocalNativeManagementTopInset=compositionLocalOf{0.dp}

/** Keep the initial content clear of floating chrome while allowing it to scroll underneath. */
@Composable internal fun Modifier.nativeManagementScroll(state:ScrollState):Modifier {
    NativeBackdropScrollMotion{state.value}
    return verticalScroll(state).padding(top=LocalNativeManagementTopInset.current)
}

@Composable internal fun nativeManagementPadding(padding:PaddingValues):PaddingValues {
    val direction=LocalLayoutDirection.current
    return PaddingValues(start=padding.calculateStartPadding(direction),end=padding.calculateEndPadding(direction),
        top=padding.calculateTopPadding()+LocalNativeManagementTopInset.current,bottom=padding.calculateBottomPadding())
}

@Composable internal fun rememberNativeManagementListState():LazyListState {
    val state=rememberLazyListState()
    NativeBackdropScrollMotion{31*state.firstVisibleItemIndex+state.firstVisibleItemScrollOffset}
    return state
}

/** Read changing scroll positions in drawing, without a composition pass for each pixel. */
@Composable internal fun NativeBackdropScrollMotion(position:()->Int){
    val backdrop=LocalNativeScrollBackdrop.current
    val current by rememberUpdatedState(position)
    DisposableEffect(backdrop){
        val provider={current()}
        backdrop?.scrollMotion=provider
        onDispose{if(backdrop!=null&&backdrop.scrollMotion===provider)backdrop.scrollMotion=null}
    }
}
