package com.localcodex.control

import android.os.Build
import android.view.WindowManager
import android.view.ViewTreeObserver
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Dialogs own a window; Activity system-bar updates do not configure that window. */
@Composable internal fun NativeDialogSystemBars(
    background:Color=MaterialTheme.colors.background,
    lightIcons:Boolean=!MaterialTheme.colors.isLight,
    immersive:Boolean=false,
    edgeToEdge:Boolean=immersive
){
    val window=(LocalView.current.parent as? DialogWindowProvider)?.window
    DisposableEffect(window,immersive,edgeToEdge){
        val controller=window?.let{WindowCompat.getInsetsController(it,it.decorView)}
        val decor=window?.decorView
        val hideBars=Runnable{controller?.hide(WindowInsetsCompat.Type.systemBars())}
        val focusListener=ViewTreeObserver.OnWindowFocusChangeListener{focused->if(focused&&immersive)decor?.post(hideBars)}
        if(edgeToEdge&&window!=null){
            WindowCompat.setDecorFitsSystemWindows(window,false)
            window.attributes=window.attributes.apply{
                if(Build.VERSION.SDK_INT>=28)layoutInDisplayCutoutMode=WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                // Dialog windows otherwise keep fitting inside system bars, even
                // when their Compose content opts out of decor insets.
                if(Build.VERSION.SDK_INT>=30)setFitInsetsTypes(0)
            }
            window.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window.setLayout(WindowManager.LayoutParams.MATCH_PARENT,WindowManager.LayoutParams.MATCH_PARENT)
        }
        if(immersive&&window!=null){
            controller?.systemBarsBehavior=WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            decor?.viewTreeObserver?.addOnWindowFocusChangeListener(focusListener)
            decor?.post(hideBars)
        }
        onDispose{
            decor?.removeCallbacks(hideBars)
            if(immersive&&decor?.viewTreeObserver?.isAlive==true)decor.viewTreeObserver.removeOnWindowFocusChangeListener(focusListener)
        }
    }
    DisposableEffect(window,background,lightIcons){window?.let{
        it.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        it.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS or WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION)
        it.statusBarColor=background.toArgb()
        it.navigationBarColor=background.toArgb()
        WindowCompat.getInsetsController(it,it.decorView).apply{
            isAppearanceLightStatusBars=!lightIcons
            isAppearanceLightNavigationBars=!lightIcons
        }
        if(Build.VERSION.SDK_INT>=29){it.isStatusBarContrastEnforced=false;it.isNavigationBarContrastEnforced=false}
    };onDispose{}}
}
