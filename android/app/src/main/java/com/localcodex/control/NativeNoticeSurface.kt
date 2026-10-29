package com.localcodex.control

import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp

/** Chat notices share the composer's material while retaining their status tint. */
@Composable internal fun NativeNoticeSurface(
    tint:Color,modifier:Modifier=Modifier,content:@Composable ()->Unit,
){
    val base=lerp(MaterialTheme.colors.surface,tint,if(MaterialTheme.colors.isLight).09f else .14f)
    NativeLiquidSurface(modifier,shape=Radius.Notice,color=base,kind=NativeGlassKind.DOCK,content=content)
}
