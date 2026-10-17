package com.localcodex.control

import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalView

/**
 * Thin wrapper around [View.performHapticFeedback] so call sites stay terse.
 * Uses only framework constants available since API 21-26; no new dependencies.
 */
internal class Haptics(private val view:View) {
    /** Small confirmation for initiating an action, e.g. sending a message. */
    fun virtualKey()=view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)

    /** Press-and-hold confirmations: long-press menus, approve/deny. */
    fun longPress()=view.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)

    /** Discrete tap confirmation, e.g. "copied" feedback. */
    fun keyTap()=view.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)

    /** Subtle tick while stepping through detents, e.g. the effort slider. */
    fun clockTick()=view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
}

@Composable internal fun rememberHaptics():Haptics{
    val view=LocalView.current
    return remember(view){Haptics(view)}
}
