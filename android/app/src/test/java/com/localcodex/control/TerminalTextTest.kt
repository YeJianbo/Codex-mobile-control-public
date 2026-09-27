package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class TerminalTextTest {
    @Test
    fun stripsAnsiColorSequencesFromDisplayText() {
        val raw = "\u001B[32mBuild succeeded\u001B[0m"
        assertEquals("Build succeeded", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun capturesBasicSgrForegroundAndUnderlineSegments() {
        val rendered = renderTerminalDisplayText("\u001B[31mERR\u001B[0m plain \u001B[4;34mlink\u001B[0m")
        assertEquals("ERR plain link", rendered.plainText)
        assertEquals(3, rendered.segments.size)
        assertEquals(TerminalColor(205, 49, 49), rendered.segments[0].style.foreground)
        assertEquals(false, rendered.segments[0].style.underline)
        assertEquals(true, rendered.segments[2].style.underline)
        assertEquals(TerminalColor(36, 114, 200), rendered.segments[2].style.foreground)
    }

    @Test
    fun capturesExtendedForegroundAndBackgroundColors() {
        val rendered = renderTerminalDisplayText("\u001B[38;5;208;48;2;10;20;30mX\u001B[0m")
        assertEquals("X", rendered.plainText)
        val segment = rendered.segments.first()
        assertEquals(TerminalColor(255, 135, 0), segment.style.foreground)
        assertEquals(TerminalColor(10, 20, 30), segment.style.background)
    }

    @Test
    fun collapsedVisibleTextPreservesRecentStyledLines() {
        val raw = buildString {
            repeat(14) { index ->
                if (index == 13) {
                    append("\u001B[32mline-$index\u001B[0m")
                } else {
                    append("line-$index")
                }
                append('\n')
            }
        }
        val rendered = terminalVisibleRenderedText(raw, expanded = false, query = "")
        assertEquals((2..13).joinToString("\n") { "line-$it" }, rendered.plainText)
        assertEquals(TerminalColor(13, 188, 121), rendered.segments.last().style.foreground)
    }

    @Test
    fun queryFilteredVisibleTextPreservesMatchedStyle() {
        val raw = "plain\n\u001B[31merror line\u001B[0m\nok"
        val rendered = terminalVisibleRenderedText(raw, expanded = true, query = "error")
        assertEquals("error line", rendered.plainText)
        assertEquals(TerminalColor(205, 49, 49), rendered.segments.single().style.foreground)
    }

    @Test
    fun keepsCrlfAsNewlinesButResolvesBareCarriageReturnsAsOverwrite() {
        val raw = "line one\r\nprogress 10%\rprogress 100%\nDone"
        assertEquals("line one\nprogress 100%\nDone", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun removesOscSequencesAndAppliesBackspace() {
        val raw = "\u001B]0;Terminal title\u0007abc\b\bXY"
        assertEquals("aXY", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsCursorHomeAndClearScreen() {
        val raw = "loading...\nold line\u001B[2J\u001B[Hready"
        assertEquals("ready", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsCursorPositionOverwriteAcrossLines() {
        val raw = "hello\nworld\u001B[1;1HHELLO"
        assertEquals("HELLO\nworld", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsEraseLineAndRelativeCursorMoves() {
        val raw = "abcde\r\u001B[2Kdone\nline2\u001B[1A\u001B[1GDONE"
        assertEquals("DONE\nline2", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun restoresPrimaryScreenAfterLeavingAlternateScreen() {
        val raw = "shell prompt\n\u001B[?1049hfull screen ui\nrow2\u001B[?1049lready"
        assertEquals("shell prompt\nready", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun keepsAlternateScreenEditsInsideAlternateBuffer() {
        val raw = "base\n\u001B[?1049hALT\u001B[2J\u001B[Hnew alt\u001B[?1049lback"
        assertEquals("base\nback", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsInsertLineWithinCurrentViewport() {
        val raw = "one\ntwo\nthree\u001B[2;1H\u001B[Lmiddle"
        assertEquals("one\nmiddle\ntwo", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsDeleteCharsWithinLine() {
        val raw = "abc123\u001B[1;2H\u001B[P"
        assertEquals("ac123", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsScrollUpWholeScreen() {
        val raw = "a\nb\nc\u001B[S"
        assertEquals("b\nc", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsReverseIndexAtTopRow() {
        val raw = "a\nb\u001B[1;1H\u001BMtop"
        assertEquals("top\na", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsScrollRegionForIndexedWrites() {
        val raw = "1\n2\n3\n4\u001B[2;3r\u001B[3;1Hbottom\u001BEnext"
        assertEquals("1\nbottom\nnext\n4", normalizeTerminalDisplayText(raw))
    }

    @Test
    fun supportsOriginModeWithinScrollRegion() {
        val raw = "1\n2\n3\n4\u001B[2;4r\u001B[?6h\u001B[1;1Htop\u001B[4;1Hbottom\u001B[?6l\u001B[1;1HHEAD"
        assertEquals("HEAD\ntop\n3\nbottom", normalizeTerminalDisplayText(raw))
    }
}
