@file:OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
package com.localcodex.control

import android.app.Activity
import android.os.Build
import android.view.WindowManager
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.invisibleToUser
import androidx.compose.ui.semantics.semantics

internal class NativeSheetEntry(val content:@Composable ()->Unit)

/** Sheets render at the app root even when their caller lives in a message or a small card. */
@Stable internal class NativeSheetHost {
    val entries=mutableStateListOf<NativeSheetEntry>()
    val visible get()=entries.isNotEmpty()
}

internal val LocalNativeSheetHost=staticCompositionLocalOf<NativeSheetHost?>{null}

@Composable internal fun NativeSheetRegistration(host:NativeSheetHost,content:@Composable ()->Unit){
    val latestContent by rememberUpdatedState(content)
    val latestLocals by rememberUpdatedState(currentCompositionLocalContext)
    val entry=remember(host){NativeSheetEntry{CompositionLocalProvider(latestLocals){latestContent()}}}
    DisposableEffect(host,entry){
        host.entries.add(entry)
        onDispose{host.entries.remove(entry)}
    }
}

@Composable internal fun NativeSheetPortal(host:NativeSheetHost){
    NativeSheetWindowPolicy(host.visible)
    val top=host.entries.lastOrNull()
    host.entries.forEach{entry->key(entry){
        Box(Modifier.fillMaxSize().focusProperties{canFocus=entry===top}.semantics{if(entry!==top)invisibleToUser()}){
            entry.content()
        }
    }}
}

/** One window policy spans the whole stack; closing a child must not restore the parent's IME mode. */
@Composable internal fun NativeSheetWindowPolicy(enabled:Boolean){
    val window=(LocalContext.current as? Activity)?.window
    DisposableEffect(window,enabled){
        val before=window?.attributes?.softInputMode?:0
        val next=(before and WindowManager.LayoutParams.SOFT_INPUT_MASK_ADJUST.inv()) or WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING
        val changed=enabled&&Build.VERSION.SDK_INT>=31&&window!=null&&before!=next
        if(changed)window?.setSoftInputMode(next)
        onDispose{if(changed)window?.setSoftInputMode(before)}
    }
}
