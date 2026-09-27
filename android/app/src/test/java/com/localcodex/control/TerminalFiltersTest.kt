package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TerminalFiltersTest {
    private val completed = TerminalCommandRecord(
        commandId = "cmd-1",
        threadId = "terminal:cmd-1",
        cwd = "F:\\Code\\Codex-mobile-control",
        command = "npm run smoke",
        status = "completed",
        output = "\u001B[32mSmoke test passed\u001B[0m",
    )

    private val failed = TerminalCommandRecord(
        commandId = "cmd-2",
        threadId = "terminal:cmd-2",
        cwd = "F:\\Code\\Other",
        command = "gradlew test",
        status = "error",
        stderr = "Compilation failed",
    )

    @Test
    fun queryMatchesCommandPathAndOutput() {
        assertTrue(terminalCommandMatchesQuery(completed, "npm"))
        assertTrue(terminalCommandMatchesQuery(completed, "Codex-mobile"))
        assertTrue(terminalCommandMatchesQuery(completed, "smoke"))
        assertFalse(terminalCommandMatchesQuery(completed, "gradlew"))
    }

    @Test
    fun statusFilterMatchesSpecificOrAll() {
        assertTrue(terminalCommandMatchesStatus(completed, "all"))
        assertTrue(terminalCommandMatchesStatus(completed, "completed"))
        assertFalse(terminalCommandMatchesStatus(completed, "error"))
    }

    @Test
    fun filterCombinesQueryAndStatus() {
        val records = listOf(completed, failed)
        assertEquals(listOf(completed), filterTerminalCommands(records, "smoke", "completed"))
        assertEquals(listOf(failed), filterTerminalCommands(records, "failed", "error"))
        assertEquals(emptyList<TerminalCommandRecord>(), filterTerminalCommands(records, "smoke", "error"))
    }

    @Test
    fun queryUsesNormalizedVisibleOutput() {
        val progress = TerminalCommandRecord(
            commandId = "cmd-3",
            threadId = "terminal:cmd-3",
            cwd = "F:\\Code\\Codex-mobile-control",
            command = "npm install",
            status = "running",
            output = "downloading 10%\rdownloading 100%\n",
        )
        assertTrue(terminalCommandMatchesQuery(progress, "100%"))
        assertFalse(terminalCommandMatchesQuery(progress, "10%"))
    }

    @Test
    fun runningCommandsArePinnedBeforeFinishedHistory() {
        val running = TerminalCommandRecord(
            commandId = "cmd-3",
            threadId = "terminal:cmd-3",
            command = "npm dev",
            status = "running",
        )
        val anotherRunning = TerminalCommandRecord(
            commandId = "cmd-4",
            threadId = "terminal:cmd-4",
            command = "server",
            status = "running",
        )

        assertEquals(
            listOf("cmd-3", "cmd-4", "cmd-1", "cmd-2"),
            filterTerminalCommands(listOf(completed, running, anotherRunning, failed), "", "all").map { it.commandId },
        )
    }

    @Test
    fun terminalHistorySummaryShowsRunningCountWhenPresent() {
        assertEquals("运行 2 · 3/5 条终端记录", terminalHistorySummary(filteredCount = 3, totalCount = 5, runningCount = 2))
        assertEquals("3/5 条终端记录", terminalHistorySummary(filteredCount = 3, totalCount = 5, runningCount = 0))
        assertEquals("运行 2 · 3/5", terminalHistoryCompactSummary(filteredCount = 3, totalCount = 5, runningCount = 2))
        assertEquals("3/5", terminalHistoryCompactSummary(filteredCount = 3, totalCount = 5, runningCount = 0))
    }

    @Test
    fun outputWindowLabelMarksTailOnlyWhenEarlierOutputExists() {
        val full = TerminalCommandRecord(
            commandId = "cmd-5",
            threadId = "terminal:cmd-5",
            output = "hello",
            outputLength = 5,
            outputOffset = 0,
            outputEnd = 5,
        )
        val tail = full.copy(
            commandId = "cmd-6",
            threadId = "terminal:cmd-6",
            output = "tail",
            outputLength = 100,
            outputOffset = 80,
            outputEnd = 100,
            outputTruncated = true,
        )

        assertEquals("1-5 / 5 字符", terminalOutputWindowLabel(full))
        assertEquals("尾部输出 81-100 / 100 字符", terminalOutputWindowLabel(tail))
    }
}
