package com.localcodex.control

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Shared surface palette and component geometry. */
internal object AppColor {
    // Neutral opaque surfaces preserve crisp text and inexpensive scrolling.
    val WashLight=Color(0xfff1f2f4)
    val WashDark=Color(0xff202020)
    val BubbleLight=Color(0xffecf2fe)
    val BubbleDark=Color(0xff252525)
    val ChatLight=Color(0xfffcfcfc)
    val ChatDark=Color.Black
    val GlassLineLight=Color(0xffe4e6e9)
    val GlassLineDark=Color(0xff303030)

    // Material theme palette (lightColors / darkColors in NativeApp)
    val LightPrimary=Color(0xff3566ef)
    val LightBackground=Color(0xfff7f7f7)
    val LightSurface=Color(0xffffffff)
    val LightOnSurface=Color(0xff0d0d0d)
    val DarkPrimary=Color(0xff8abaff)
    val DarkBackground=Color.Black
    val DarkSurface=Color(0xff151515)
    val DarkOnSurface=Color(0xfff1f1f1)

    // Accent (toggle track / effort slider)
    val AccentLight=Color(0xff3566ef)
    val AccentDark=Color(0xff8abaff)
    val UltraLight=Color(0xff9258cf)
    val UltraDark=Color(0xffcca2fa)
    val UltraTrack=listOf(Color(0xff3c43cf),Color(0xff6d62ef),Color(0xff9d79fd),Color(0xffad72fe),Color(0xff8d56f9),Color(0xff8d65fc))
    val SelectionLight=Color(0xffe9ebee)
    val SelectionDark=Color(0xff262626)

    // Destructive + status dots
    val Danger=Color(0xffb4423c)
    val StatusError=Color(0xffc14954)
    val StatusWarning=Color(0xffa56a14)
    val StatusOk=Color(0xff429575)

    // Misc chrome
    val PlaceholderIcon=Color(0xffa5a5a5)
    val ChartPurple=Color(0xff9382ed)
    val ChartCyan=Color(0xff55c8e5)
    val PreviewBackdrop=Color(0xff151617)
    val PreviewToolbarScrim=Color(0xaa202124)
}

/** Shared surface palette and component geometry. */
internal object Radius {
    // Geometry follows the active theme; capsules and hairlines retain their fixed roles.
    val Control:RoundedCornerShape @Composable get()=RoundedCornerShape(LocalNativeTheme.current.geometry.control.dp)
    val Card:RoundedCornerShape @Composable get()=RoundedCornerShape(LocalNativeTheme.current.geometry.card.dp)
    val Panel:RoundedCornerShape @Composable get()=RoundedCornerShape(LocalNativeTheme.current.geometry.panel.dp)
    val Notice:RoundedCornerShape @Composable get()=RoundedCornerShape((LocalNativeTheme.current.geometry.panel+2f).coerceIn(28f,36f).dp)
    val Button:RoundedCornerShape @Composable get()=RoundedCornerShape(LocalNativeTheme.current.geometry.button.dp)
    val Field:RoundedCornerShape @Composable get()=RoundedCornerShape(LocalNativeTheme.current.geometry.field.dp)
    val Inset:RoundedCornerShape @Composable get()=Field
    val MenuItem:RoundedCornerShape @Composable get()=RoundedCornerShape(LocalNativeTheme.current.geometry.menuItem.dp)
    val Section:RoundedCornerShape @Composable get()=Card
    val Sheet:RoundedCornerShape @Composable get()=Panel
    val Composer:RoundedCornerShape @Composable get()=Panel
    val Tiny = RoundedCornerShape(2.dp)
    val Chip = RoundedCornerShape(50)
}
