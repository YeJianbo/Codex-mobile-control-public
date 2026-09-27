package com.localcodex.control

import androidx.compose.ui.text.input.ImeAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalInputTest {
    @Test
    fun lineModeRequiresNonBlankInput() {
        assertFalse(canSendTerminalSessionInput(rawInputMode = false, input = ""))
        assertFalse(canSendTerminalSessionInput(rawInputMode = false, input = "   "))
        assertTrue(canSendTerminalSessionInput(rawInputMode = false, input = "ls"))
    }

    @Test
    fun rawModeAllowsWhitespaceAndMultilineChunks() {
        assertFalse(canSendTerminalSessionInput(rawInputMode = true, input = ""))
        assertTrue(canSendTerminalSessionInput(rawInputMode = true, input = "   "))
        assertTrue(canSendTerminalSessionInput(rawInputMode = true, input = "line 1\nline 2"))
    }

    @Test
    fun lineModeUsesSendImeAction() {
        assertEquals(ImeAction.Send, terminalSessionImeAction(rawInputMode = false))
    }

    @Test
    fun rawModeKeepsDefaultImeAction() {
        assertEquals(ImeAction.Default, terminalSessionImeAction(rawInputMode = true))
    }

    @Test
    fun sessionSelectionKeepsCurrentSessionWhenStillPresent() {
        val sessions = listOf(
            TerminalCommandRecord(commandId = "session-1", threadId = "terminal:session-1", interactive = true, status = "running"),
            TerminalCommandRecord(commandId = "session-2", threadId = "terminal:session-2", interactive = true, status = "running"),
        )

        assertEquals("session-2", resolveInteractiveSessionSelection("session-2", sessions))
    }

    @Test
    fun sessionSelectionFallsBackToFirstRunningSession() {
        val sessions = listOf(
            TerminalCommandRecord(commandId = "session-1", threadId = "terminal:session-1", interactive = true, status = "running"),
            TerminalCommandRecord(commandId = "session-2", threadId = "terminal:session-2", interactive = true, status = "running"),
        )

        assertEquals("session-1", resolveInteractiveSessionSelection("missing", sessions))
    }

    @Test
    fun chipLabelPrefixesIndexWhenMultipleSessionsExist() {
        val session = TerminalCommandRecord(commandId = "session-2", threadId = "terminal:session-2", command = "python -m http.server")

        assertEquals("2 python -m htt...", terminalSessionChipLabel(session, index = 1, total = 3))
    }

    @Test
    fun chipLabelKeepsSingleSessionCompact() {
        val session = TerminalCommandRecord(commandId = "session-1", threadId = "terminal:session-1", command = "npm dev")

        assertEquals("npm dev", terminalSessionChipLabel(session, index = 0, total = 1))
    }

    @Test
    fun primaryShortcutsKeepHighFrequencyKeysVisible() {
        assertEquals(listOf("Ctrl+C", "Tab", "Enter", "↑", "⌫"), terminalPrimaryShortcuts().map { it.label })
    }

    @Test
    fun secondaryShortcutsKeepLowFrequencyKeysCollapsed() {
        assertEquals(
            listOf(
                listOf("↓", "←", "→"),
                listOf("Esc", "Home", "End"),
                listOf("Del"),
            ),
            terminalSecondaryShortcutRows().map { row -> row.map { it.label } }
        )
    }

    @Test
    fun viewportEstimateReturnsNullForMissingSize() {
        assertNull(estimateTerminalViewport(0, 0))
    }

    @Test
    fun viewportEstimateClampsToSupportedRange() {
        assertEquals(TerminalViewport(40, 12), estimateTerminalViewport(120, 120))
        assertEquals(TerminalViewport(240, 80), estimateTerminalViewport(4000, 4000))
    }

    @Test
    fun followTailTreatsNearBottomAsSticky() {
        assertTrue(shouldFollowTerminalTail(scrollValue = 90, maxValue = 100, thresholdPx = 12))
        assertFalse(shouldFollowTerminalTail(scrollValue = 40, maxValue = 100, thresholdPx = 12))
    }

    @Test
    fun followTailDefaultsToTrueWhenNoScrollableOverflow() {
        assertTrue(shouldFollowTerminalTail(scrollValue = 0, maxValue = 0))
    }

    @Test
    fun runningTerminalOutputGetsMoreVerticalRoom() {
        assertEquals(420, terminalOutputMaxHeightDp(autoFollowTail = true))
        assertEquals(320, terminalOutputMaxHeightDp(autoFollowTail = false))
    }

    @Test
    fun terminalOutputWrapIsOptIn() {
        assertFalse(terminalOutputSoftWrap(wrapLines = false))
        assertTrue(terminalOutputSoftWrap(wrapLines = true))
    }
}
