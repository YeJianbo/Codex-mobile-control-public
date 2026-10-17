package com.localcodex.control

import androidx.compose.ui.text.input.ImeAction

/**
 * Pure terminal input/session helpers extracted verbatim from the removed
 * LegacyControlScreen.kt. They carry no UI: TerminalInputTest covers them, so the
 * logic must stay available even though the legacy screen itself is gone.
 */
internal data class TerminalShortcut(
    val label: String,
    val sequence: String,
)

internal data class TerminalViewport(
    val cols: Int,
    val rows: Int,
)

internal fun canSendTerminalSessionInput(rawInputMode: Boolean, input: String): Boolean {
    return if (rawInputMode) {
        input.isNotEmpty()
    } else {
        input.isNotBlank()
    }
}

internal fun resolveInteractiveSessionSelection(current: String, commands: List<TerminalCommandRecord>): String {
    if (commands.isEmpty()) {
        return ""
    }
    return commands.firstOrNull { it.commandId == current }?.commandId ?: commands.firstOrNull()?.commandId.orEmpty()
}

internal fun terminalSessionChipLabel(session: TerminalCommandRecord, index: Int, total: Int): String {
    val prefix = if (total > 1) "${index + 1} " else ""
    val base = session.command.ifBlank { session.commandId }.trim()
    val text = prefix + base
    return if (text.length <= 18) text else text.take(15) + "..."
}

internal fun terminalSessionImeAction(rawInputMode: Boolean): ImeAction {
    return if (rawInputMode) ImeAction.Default else ImeAction.Send
}

internal fun estimateTerminalViewport(widthPx: Int, heightPx: Int): TerminalViewport? {
    if (widthPx <= 0 || heightPx <= 0) {
        return null
    }
    val cols = (widthPx / 9.2f).toInt().coerceIn(40, 240)
    val rows = (heightPx / 18f).toInt().coerceIn(12, 80)
    return TerminalViewport(cols, rows)
}

internal fun shouldFollowTerminalTail(scrollValue: Int, maxValue: Int, thresholdPx: Int = 24): Boolean {
    if (maxValue <= 0) {
        return true
    }
    return scrollValue >= (maxValue - thresholdPx).coerceAtLeast(0)
}

internal fun shouldFollowConversationTail(lastVisibleIndex: Int, itemCount: Int, thresholdItems: Int = 1): Boolean {
    if (itemCount <= 0) {
        return true
    }
    if (lastVisibleIndex < 0) {
        return true
    }
    return lastVisibleIndex >= itemCount - 1 - thresholdItems
}

internal fun terminalOutputMaxHeightDp(autoFollowTail: Boolean): Int {
    return if (autoFollowTail) 420 else 320
}

internal fun terminalOutputSoftWrap(wrapLines: Boolean): Boolean {
    return wrapLines
}

internal fun terminalPrimaryShortcuts(): List<TerminalShortcut> {
    return listOf(
        TerminalShortcut("Ctrl+C", "\u0003"),
        TerminalShortcut("Tab", "\t"),
        TerminalShortcut("Enter", "\r"),
        TerminalShortcut("↑", "\u001B[A"),
        TerminalShortcut("⌫", "\b"),
    )
}

internal fun terminalSecondaryShortcutRows(): List<List<TerminalShortcut>> {
    return listOf(
        listOf(
            TerminalShortcut("↓", "\u001B[B"),
            TerminalShortcut("←", "\u001B[D"),
            TerminalShortcut("→", "\u001B[C"),
        ),
        listOf(
            TerminalShortcut("Esc", "\u001B"),
            TerminalShortcut("Home", "\u001B[H"),
            TerminalShortcut("End", "\u001B[F"),
        ),
        listOf(
            TerminalShortcut("Del", "\u001B[3~"),
        ),
    )
}
