package com.localcodex.control

fun terminalCommandMatchesQuery(record: TerminalCommandRecord, query: String): Boolean {
    val normalized = query.trim().lowercase()
    if (normalized.isBlank()) {
        return true
    }
    val visibleOutput = normalizeTerminalDisplayText(record.output).lowercase()
    val visibleStdout = normalizeTerminalDisplayText(record.stdout).lowercase()
    val visibleStderr = normalizeTerminalDisplayText(record.stderr).lowercase()
    return record.command.lowercase().contains(normalized) ||
        record.cwd.lowercase().contains(normalized) ||
        record.threadId.lowercase().contains(normalized) ||
        record.commandId.lowercase().contains(normalized) ||
        record.status.lowercase().contains(normalized) ||
        visibleOutput.contains(normalized) ||
        visibleStdout.contains(normalized) ||
        visibleStderr.contains(normalized)
}

fun terminalCommandMatchesStatus(record: TerminalCommandRecord, status: String): Boolean {
    return status.isBlank() || status == "all" || record.status == status
}

fun filterTerminalCommands(records: List<TerminalCommandRecord>, query: String, status: String): List<TerminalCommandRecord> {
    return sortTerminalCommandsForDisplay(records.filter { record ->
        terminalCommandMatchesStatus(record, status) && terminalCommandMatchesQuery(record, query)
    })
}

fun sortTerminalCommandsForDisplay(records: List<TerminalCommandRecord>): List<TerminalCommandRecord> {
    return records.withIndex()
        .sortedWith(compareBy<IndexedValue<TerminalCommandRecord>> { terminalCommandDisplayRank(it.value) }.thenBy { it.index })
        .map { it.value }
}

fun terminalRunningCount(records: List<TerminalCommandRecord>): Int {
    return records.count { it.status == "running" }
}

fun terminalHistorySummary(filteredCount: Int, totalCount: Int, runningCount: Int): String {
    val base = "$filteredCount/$totalCount 条终端记录"
    return if (runningCount > 0) "运行 $runningCount · $base" else base
}

fun terminalHistoryCompactSummary(filteredCount: Int, totalCount: Int, runningCount: Int): String {
    val base = "$filteredCount/$totalCount"
    return if (runningCount > 0) "运行 $runningCount · $base" else base
}

fun terminalOutputWindowLabel(record: TerminalCommandRecord): String {
    val totalOutputLength = record.outputLength.takeIf { it > 0 } ?: record.output.length
    if (totalOutputLength <= 0) {
        return ""
    }
    val end = record.outputEnd.coerceAtLeast(record.output.length)
    val range = "${record.outputOffset + 1}-$end / $totalOutputLength 字符"
    return if (record.outputOffset > 0 || record.outputTruncated) "尾部输出 $range" else range
}

private fun terminalCommandDisplayRank(record: TerminalCommandRecord): Int {
    return when (record.status) {
        "running" -> 0
        else -> 1
    }
}
