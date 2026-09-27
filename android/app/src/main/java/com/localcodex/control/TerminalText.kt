package com.localcodex.control

private const val escape = '\u001B'

internal data class TerminalColor(
    val red: Int,
    val green: Int,
    val blue: Int,
)

internal data class TerminalStyle(
    val foreground: TerminalColor? = null,
    val background: TerminalColor? = null,
    val bold: Boolean = false,
    val dim: Boolean = false,
    val italic: Boolean = false,
    val underline: Boolean = false,
    val inverse: Boolean = false,
)

internal data class TerminalTextSegment(
    val text: String,
    val style: TerminalStyle,
)

internal data class TerminalRenderedText(
    val plainText: String,
    val segments: List<TerminalTextSegment>,
)

internal data class TerminalRenderedLine(
    val plainText: String,
    val segments: List<TerminalTextSegment>,
)

fun normalizeTerminalDisplayText(text: String): String {
    if (text.isEmpty()) {
        return ""
    }
    return renderTerminalDisplayText(text).plainText
}

internal fun renderTerminalDisplayText(text: String): TerminalRenderedText {
    if (text.isEmpty()) {
        return TerminalRenderedText("", emptyList())
    }
    return TerminalDisplayBuffer().append(text).render()
}

internal fun terminalVisibleRenderedText(text: String, expanded: Boolean, query: String): TerminalRenderedText {
    val rendered = renderTerminalDisplayText(text)
    val lines = terminalRenderedLines(rendered)
    val selectedLines = when {
        !expanded -> lines.takeLast(12)
        query.isBlank() -> lines
        else -> lines.filter { it.plainText.contains(query, ignoreCase = true) }
    }
    return joinTerminalRenderedLines(selectedLines)
}

private class TerminalDisplayBuffer {
    private val lines = mutableListOf(mutableListOf<TerminalCell>())
    private var cursorRow = 0
    private var cursorCol = 0
    private var savedCursorRow = 0
    private var savedCursorCol = 0
    private var scrollTop = 0
    private var scrollBottom = -1
    private var originMode = false
    private var currentStyle = TerminalStyle()
    private var savedStyle = TerminalStyle()
    private var primarySnapshot: ScreenSnapshot? = null
    private var alternateSnapshot: ScreenSnapshot? = null
    private var usingAlternateScreen = false

    fun append(text: String): TerminalDisplayBuffer {
        var index = 0
        while (index < text.length) {
            val char = text[index]
            if (char == escape) {
                index = consumeEscape(text, index)
                continue
            }
            when (char) {
                '\r' -> cursorCol = 0
                '\n' -> moveToNextLine()
                '\b' -> cursorCol = (cursorCol - 1).coerceAtLeast(0)
                '\t' -> repeat(4 - (cursorCol % 4)) { writeChar(' ') }
                else -> writeChar(char)
            }
            index += 1
        }
        return this
    }

    fun render(): TerminalRenderedText {
        val plainBuilder = StringBuilder()
        val segments = mutableListOf<TerminalTextSegment>()
        lines.forEachIndexed { rowIndex, row ->
            val lastVisibleIndex = row.indexOfLast { it.char != ' ' }
            if (lastVisibleIndex >= 0) {
                var segmentStyle: TerminalStyle? = null
                val segmentBuilder = StringBuilder()
                for (index in 0..lastVisibleIndex) {
                    val cell = row[index]
                    plainBuilder.append(cell.char)
                    if (segmentStyle == null || segmentStyle != cell.style) {
                        if (segmentBuilder.isNotEmpty() && segmentStyle != null) {
                            segments += TerminalTextSegment(segmentBuilder.toString(), segmentStyle)
                            segmentBuilder.clear()
                        }
                        segmentStyle = cell.style
                    }
                    segmentBuilder.append(cell.char)
                }
                if (segmentBuilder.isNotEmpty() && segmentStyle != null) {
                    segments += TerminalTextSegment(segmentBuilder.toString(), segmentStyle)
                }
            }
            if (rowIndex < lines.lastIndex) {
                plainBuilder.append('\n')
                segments += TerminalTextSegment("\n", TerminalStyle())
            }
        }
        return TerminalRenderedText(
            plainText = plainBuilder.toString().trimEnd('\n'),
            segments = segments.trimTrailingNewlineSegments(),
        )
    }

    private fun consumeEscape(text: String, start: Int): Int {
        if (start + 1 >= text.length) {
            return text.length
        }
        return when (text[start + 1]) {
            '[' -> consumeCsi(text, start + 2)
            ']' -> consumeOsc(text, start + 2)
            'D' -> {
                indexForward(resetColumn = false)
                start + 2
            }

            'E' -> {
                indexForward(resetColumn = true)
                start + 2
            }

            'M' -> {
                reverseIndex()
                start + 2
            }

            '7' -> {
                saveCursor()
                start + 2
            }

            '8' -> {
                restoreCursor()
                start + 2
            }

            else -> start + 2
        }
    }

    private fun consumeOsc(text: String, start: Int): Int {
        var index = start
        while (index < text.length) {
            if (text[index] == '\u0007') {
                return index + 1
            }
            if (text[index] == escape && index + 1 < text.length && text[index + 1] == '\\') {
                return index + 2
            }
            index += 1
        }
        return text.length
    }

    private fun consumeCsi(text: String, start: Int): Int {
        var index = start
        while (index < text.length && !isCsiFinalByte(text[index])) {
            index += 1
        }
        if (index >= text.length) {
            return text.length
        }
        applyCsi(text.substring(start, index), text[index])
        return index + 1
    }

    private fun applyCsi(parameters: String, command: Char) {
        val privateMode = parameters.startsWith("?")
        val numericSection = if (privateMode) parameters.drop(1) else parameters
        val values = parseCsiParameters(numericSection)
        when (command) {
            'm' -> applySgr(values)
            'A' -> cursorRow = clampCursorRow(cursorRow - valueAt(values, 0, 1))
            'B' -> cursorRow = clampCursorRow(cursorRow + valueAt(values, 0, 1))
            'C' -> cursorCol += valueAt(values, 0, 1)
            'D' -> cursorCol = (cursorCol - valueAt(values, 0, 1)).coerceAtLeast(0)
            'L' -> insertLines(valueAt(values, 0, 1))
            'M' -> deleteLines(valueAt(values, 0, 1))
            'P' -> deleteChars(valueAt(values, 0, 1))
            'S' -> scrollUp(valueAt(values, 0, 1))
            'T' -> scrollDown(valueAt(values, 0, 1))
            'X' -> eraseChars(valueAt(values, 0, 1))
            'E' -> {
                cursorRow += valueAt(values, 0, 1)
                cursorCol = 0
            }

            'F' -> {
                cursorRow = clampCursorRow(cursorRow - valueAt(values, 0, 1))
                cursorCol = 0
            }

            'G' -> cursorCol = (valueAt(values, 0, 1) - 1).coerceAtLeast(0)
            'H', 'f' -> {
                cursorRow = targetRowFromParameters(valueAt(values, 0, 1))
                cursorCol = (valueAt(values, 1, 1) - 1).coerceAtLeast(0)
            }

            'J' -> eraseInDisplay(valueAt(values, 0, 0))
            'K' -> eraseInLine(valueAt(values, 0, 0))
            'd' -> cursorRow = targetRowFromParameters(valueAt(values, 0, 1))
            'r' -> setScrollRegion(values)
            's' -> saveCursor()
            'u' -> restoreCursor()
            'h', 'l' -> {
                if (privateMode) {
                    when (numericSection) {
                        "1049", "1047", "47" -> {
                            if (command == 'h') {
                                enterAlternateScreen()
                            } else {
                                exitAlternateScreen()
                            }
                        }

                        "6" -> {
                            originMode = command == 'h'
                            moveCursorHome()
                        }
                    }
                }
            }
        }
    }

    private fun applySgr(values: List<Int>) {
        if (values.isEmpty()) {
            currentStyle = TerminalStyle()
            return
        }
        var index = 0
        var style = currentStyle
        while (index < values.size) {
            when (val code = values[index]) {
                0 -> style = TerminalStyle()
                1 -> style = style.copy(bold = true, dim = false)
                2 -> style = style.copy(dim = true)
                3 -> style = style.copy(italic = true)
                4 -> style = style.copy(underline = true)
                7 -> style = style.copy(inverse = true)
                22 -> style = style.copy(bold = false, dim = false)
                23 -> style = style.copy(italic = false)
                24 -> style = style.copy(underline = false)
                27 -> style = style.copy(inverse = false)
                in 30..37 -> style = style.copy(foreground = ansiColor(code - 30, bright = false))
                in 40..47 -> style = style.copy(background = ansiColor(code - 40, bright = false))
                in 90..97 -> style = style.copy(foreground = ansiColor(code - 90, bright = true))
                in 100..107 -> style = style.copy(background = ansiColor(code - 100, bright = true))
                39 -> style = style.copy(foreground = null)
                49 -> style = style.copy(background = null)
                38, 48 -> {
                    val parsed = parseExtendedColor(values, index + 1)
                    if (parsed != null) {
                        style = if (code == 38) {
                            style.copy(foreground = parsed.color)
                        } else {
                            style.copy(background = parsed.color)
                        }
                        index = parsed.nextIndex - 1
                    }
                }
            }
            index += 1
        }
        currentStyle = style
    }

    private fun eraseInDisplay(mode: Int) {
        when (mode) {
            0 -> {
                eraseInLine(0)
                val start = (cursorRow + 1).coerceAtMost(lines.lastIndex)
                for (row in start..lines.lastIndex) {
                    lines[row].clear()
                }
            }

            1 -> {
                for (row in 0 until cursorRow) {
                    lines[row].clear()
                }
                eraseInLine(1)
            }

            2 -> clearAll()
        }
    }

    private fun eraseInLine(mode: Int) {
        val line = lineAt(cursorRow)
        when (mode) {
            0 -> {
                if (cursorCol < line.size) {
                    line.subList(cursorCol, line.size).clear()
                }
            }

            1 -> {
                val end = cursorCol.coerceAtMost(line.size)
                for (index in 0 until end) {
                    line[index] = blankCell()
                }
            }

            2 -> line.clear()
        }
    }

    private fun clearAll() {
        lines.clear()
        lines.add(mutableListOf())
        scrollTop = 0
        scrollBottom = -1
    }

    private fun moveToNextLine() {
        indexForward(resetColumn = true)
    }

    private fun indexForward(resetColumn: Boolean) {
        val bottom = effectiveScrollBottom()
        if (hasExplicitScrollRegion() && cursorRow == bottom) {
            scrollRegionUp(1)
        } else {
            cursorRow = clampCursorRow(cursorRow + 1)
        }
        if (resetColumn) {
            cursorCol = 0
        }
        ensureLine(cursorRow)
    }

    private fun writeChar(char: Char) {
        val line = lineAt(cursorRow)
        ensureColumn(line, cursorCol)
        val cell = TerminalCell(char, currentStyle)
        if (cursorCol < line.size) {
            line[cursorCol] = cell
        } else {
            line.add(cell)
        }
        cursorCol += 1
    }

    private fun ensureLine(row: Int) {
        while (lines.size <= row) {
            lines.add(mutableListOf())
        }
    }

    private fun lineAt(row: Int): MutableList<TerminalCell> {
        ensureLine(row)
        return lines[row]
    }

    private fun ensureColumn(line: MutableList<TerminalCell>, col: Int) {
        while (line.size < col) {
            line.add(blankCell())
        }
    }

    private fun blankCell(): TerminalCell = TerminalCell(' ', currentStyle)

    private fun saveCursor() {
        savedCursorRow = cursorRow
        savedCursorCol = cursorCol
        savedStyle = currentStyle
    }

    private fun restoreCursor() {
        cursorRow = clampCursorRow(savedCursorRow)
        cursorCol = savedCursorCol.coerceAtLeast(0)
        currentStyle = savedStyle
        ensureLine(cursorRow)
    }

    private fun reverseIndex() {
        val top = effectiveScrollTop()
        if (cursorRow > top) {
            cursorRow -= 1
            return
        }
        insertBlankLines(top, 1, effectiveScrollBottom())
        cursorRow = top
    }

    private fun insertLines(count: Int) {
        val safeCount = count.coerceAtLeast(1)
        if (cursorRow !in effectiveScrollTop()..effectiveScrollBottom()) {
            return
        }
        insertBlankLines(cursorRow, safeCount, effectiveScrollBottom())
    }

    private fun deleteLines(count: Int) {
        val safeCount = count.coerceAtLeast(1)
        if (cursorRow !in effectiveScrollTop()..effectiveScrollBottom()) {
            return
        }
        deleteLinesInRegion(cursorRow, safeCount, effectiveScrollBottom())
    }

    private fun scrollUp(count: Int) {
        scrollRegionUp(count.coerceAtLeast(1))
    }

    private fun scrollDown(count: Int) {
        scrollRegionDown(count.coerceAtLeast(1))
    }

    private fun deleteChars(count: Int) {
        val safeCount = count.coerceAtLeast(1)
        val line = lineAt(cursorRow)
        if (cursorCol >= line.size) {
            return
        }
        val end = (cursorCol + safeCount).coerceAtMost(line.size)
        line.subList(cursorCol, end).clear()
    }

    private fun eraseChars(count: Int) {
        val safeCount = count.coerceAtLeast(1)
        val line = lineAt(cursorRow)
        ensureColumn(line, cursorCol + safeCount)
        for (index in cursorCol until (cursorCol + safeCount).coerceAtMost(line.size)) {
            line[index] = blankCell()
        }
    }

    private fun setScrollRegion(values: List<Int>) {
        val requestedTop = (values.getOrNull(0)?.takeIf { it > 0 } ?: 1) - 1
        val requestedBottomValue = values.getOrNull(1)?.takeIf { it > 0 }
        val requestedBottom = (requestedBottomValue ?: (lines.size.coerceAtLeast(1))) - 1
        ensureLine(requestedBottom.coerceAtLeast(requestedTop))
        scrollTop = requestedTop.coerceIn(0, lines.lastIndex)
        scrollBottom = requestedBottom.coerceIn(scrollTop, lines.lastIndex)
        moveCursorHome()
    }

    private fun moveCursorHome() {
        cursorRow = if (originMode) effectiveScrollTop() else 0
        cursorCol = 0
        ensureLine(cursorRow)
    }

    private fun targetRowFromParameters(rowParameter: Int): Int {
        val zeroBased = (rowParameter - 1).coerceAtLeast(0)
        return if (originMode) {
            clampCursorRow(effectiveScrollTop() + zeroBased)
        } else {
            clampCursorRow(zeroBased)
        }
    }

    private fun effectiveScrollTop(): Int {
        ensureLine(scrollTop)
        return scrollTop.coerceIn(0, lines.lastIndex)
    }

    private fun effectiveScrollBottom(): Int {
        if (scrollBottom < effectiveScrollTop()) {
            return lines.lastIndex.coerceAtLeast(0)
        }
        ensureLine(scrollBottom)
        return scrollBottom.coerceIn(effectiveScrollTop(), lines.lastIndex)
    }

    private fun hasExplicitScrollRegion(): Boolean {
        return scrollBottom >= scrollTop
    }

    private fun clampCursorRow(value: Int): Int {
        val min = if (originMode) effectiveScrollTop() else 0
        val max = if (originMode) effectiveScrollBottom() else lines.lastIndex.coerceAtLeast(0)
        if (!originMode) {
            ensureLine(value.coerceAtLeast(0))
            return value.coerceAtLeast(0)
        }
        ensureLine(max)
        return value.coerceIn(min, max)
    }

    private fun scrollRegionUp(count: Int) {
        val top = effectiveScrollTop()
        val bottom = effectiveScrollBottom()
        deleteLinesInRegion(top, count, bottom)
        cursorRow = cursorRow.coerceIn(top, bottom)
    }

    private fun scrollRegionDown(count: Int) {
        val top = effectiveScrollTop()
        val bottom = effectiveScrollBottom()
        insertBlankLines(top, count, bottom)
        cursorRow = cursorRow.coerceIn(top, bottom)
    }

    private fun insertBlankLines(startRow: Int, count: Int, bottom: Int) {
        val safeCount = count.coerceAtLeast(1)
        ensureLine(bottom)
        repeat(safeCount) {
            lines.add(startRow, mutableListOf())
            if (bottom + 1 <= lines.lastIndex) {
                lines.removeAt((bottom + 1).coerceAtMost(lines.lastIndex))
            }
        }
    }

    private fun deleteLinesInRegion(startRow: Int, count: Int, bottom: Int) {
        val safeCount = count.coerceAtLeast(1)
        ensureLine(bottom)
        repeat(safeCount) {
            if (startRow <= bottom && startRow <= lines.lastIndex) {
                lines.removeAt(startRow)
            }
            lines.add((bottom).coerceAtMost(lines.size), mutableListOf())
        }
        while (lines.size <= bottom) {
            lines.add(mutableListOf())
        }
    }

    private fun enterAlternateScreen() {
        if (usingAlternateScreen) {
            clearAll()
            cursorRow = 0
            cursorCol = 0
            currentStyle = TerminalStyle()
            return
        }
        primarySnapshot = snapshot()
        alternateSnapshot = ScreenSnapshot(
            lines = mutableListOf(mutableListOf()),
            cursorRow = 0,
            cursorCol = 0,
            savedCursorRow = 0,
            savedCursorCol = 0,
            scrollTop = 0,
            scrollBottom = -1,
            originMode = false,
            currentStyle = TerminalStyle(),
            savedStyle = TerminalStyle(),
        )
        restoreSnapshot(alternateSnapshot!!)
        usingAlternateScreen = true
    }

    private fun exitAlternateScreen() {
        if (!usingAlternateScreen) {
            return
        }
        alternateSnapshot = snapshot()
        val primary = primarySnapshot
        if (primary != null) {
            restoreSnapshot(primary)
        } else {
            clearAll()
            cursorRow = 0
            cursorCol = 0
            currentStyle = TerminalStyle()
        }
        usingAlternateScreen = false
    }

    private fun snapshot(): ScreenSnapshot {
        return ScreenSnapshot(
            lines = lines.map { row -> row.map { it.copy() }.toMutableList() }.toMutableList(),
            cursorRow = cursorRow,
            cursorCol = cursorCol,
            savedCursorRow = savedCursorRow,
            savedCursorCol = savedCursorCol,
            scrollTop = scrollTop,
            scrollBottom = scrollBottom,
            originMode = originMode,
            currentStyle = currentStyle,
            savedStyle = savedStyle,
        )
    }

    private fun restoreSnapshot(snapshot: ScreenSnapshot) {
        lines.clear()
        lines.addAll(snapshot.lines.map { row -> row.map { it.copy() }.toMutableList() })
        if (lines.isEmpty()) {
            lines.add(mutableListOf())
        }
        cursorRow = snapshot.cursorRow.coerceAtLeast(0)
        cursorCol = snapshot.cursorCol.coerceAtLeast(0)
        savedCursorRow = snapshot.savedCursorRow.coerceAtLeast(0)
        savedCursorCol = snapshot.savedCursorCol.coerceAtLeast(0)
        scrollTop = snapshot.scrollTop.coerceAtLeast(0)
        scrollBottom = snapshot.scrollBottom
        originMode = snapshot.originMode
        currentStyle = snapshot.currentStyle
        savedStyle = snapshot.savedStyle
        ensureLine(cursorRow)
        if (scrollBottom >= scrollTop) {
            ensureLine(scrollBottom)
        }
    }
}

private data class TerminalCell(
    val char: Char,
    val style: TerminalStyle,
)

private data class ScreenSnapshot(
    val lines: MutableList<MutableList<TerminalCell>>,
    val cursorRow: Int,
    val cursorCol: Int,
    val savedCursorRow: Int,
    val savedCursorCol: Int,
    val scrollTop: Int,
    val scrollBottom: Int,
    val originMode: Boolean,
    val currentStyle: TerminalStyle,
    val savedStyle: TerminalStyle,
)

private data class ParsedExtendedColor(
    val color: TerminalColor?,
    val nextIndex: Int,
)

internal fun terminalRenderedLines(rendered: TerminalRenderedText): List<TerminalRenderedLine> {
    if (rendered.segments.isEmpty()) {
        return listOf(TerminalRenderedLine(rendered.plainText, if (rendered.plainText.isEmpty()) emptyList() else listOf(TerminalTextSegment(rendered.plainText, TerminalStyle()))))
    }
    val lines = mutableListOf<TerminalRenderedLine>()
    var currentPlain = StringBuilder()
    val currentSegments = mutableListOf<TerminalTextSegment>()

    fun flushLine() {
        lines += TerminalRenderedLine(currentPlain.toString(), currentSegments.toList())
        currentPlain = StringBuilder()
        currentSegments.clear()
    }

    rendered.segments.forEach { segment ->
        val parts = segment.text.split('\n')
        parts.forEachIndexed { index, part ->
            if (part.isNotEmpty()) {
                currentPlain.append(part)
                appendTerminalSegment(currentSegments, TerminalTextSegment(part, segment.style))
            }
            if (index < parts.lastIndex) {
                flushLine()
            }
        }
    }
    if (currentPlain.isNotEmpty() || lines.isEmpty()) {
        flushLine()
    }
    return lines
}

private fun joinTerminalRenderedLines(lines: List<TerminalRenderedLine>): TerminalRenderedText {
    if (lines.isEmpty()) {
        return TerminalRenderedText("", emptyList())
    }
    val plain = buildString {
        lines.forEachIndexed { index, line ->
            append(line.plainText)
            if (index < lines.lastIndex) {
                append('\n')
            }
        }
    }
    val segments = mutableListOf<TerminalTextSegment>()
    lines.forEachIndexed { index, line ->
        line.segments.forEach { segment -> appendTerminalSegment(segments, segment) }
        if (index < lines.lastIndex) {
            appendTerminalSegment(segments, TerminalTextSegment("\n", TerminalStyle()))
        }
    }
    return TerminalRenderedText(plainText = plain, segments = segments)
}

private fun appendTerminalSegment(target: MutableList<TerminalTextSegment>, segment: TerminalTextSegment) {
    if (segment.text.isEmpty()) {
        return
    }
    val last = target.lastOrNull()
    if (last != null && last.style == segment.style) {
        target[target.lastIndex] = last.copy(text = last.text + segment.text)
    } else {
        target += segment
    }
}

private fun parseCsiParameters(section: String): List<Int> {
    if (section.isBlank()) {
        return emptyList()
    }
    return section.split(';').map { item ->
        item.toIntOrNull() ?: 0
    }
}

private fun valueAt(values: List<Int>, index: Int, defaultValue: Int): Int {
    return values.getOrNull(index)?.takeIf { it != 0 } ?: defaultValue
}

private fun ansiColor(index: Int, bright: Boolean): TerminalColor {
    val palette = if (bright) brightAnsiPalette else standardAnsiPalette
    return palette[index.coerceIn(0, palette.lastIndex)]
}

private fun parseExtendedColor(values: List<Int>, startIndex: Int): ParsedExtendedColor? {
    val mode = values.getOrNull(startIndex) ?: return null
    return when (mode) {
        5 -> {
            val paletteIndex = values.getOrNull(startIndex + 1) ?: return null
            ParsedExtendedColor(xterm256Color(paletteIndex), startIndex + 2)
        }

        2 -> {
            val red = values.getOrNull(startIndex + 1) ?: return null
            val green = values.getOrNull(startIndex + 2) ?: return null
            val blue = values.getOrNull(startIndex + 3) ?: return null
            ParsedExtendedColor(
                TerminalColor(red.coerceIn(0, 255), green.coerceIn(0, 255), blue.coerceIn(0, 255)),
                startIndex + 4,
            )
        }

        else -> null
    }
}

private fun xterm256Color(index: Int): TerminalColor {
    val clamped = index.coerceIn(0, 255)
    if (clamped < 8) {
        return standardAnsiPalette[clamped]
    }
    if (clamped < 16) {
        return brightAnsiPalette[clamped - 8]
    }
    if (clamped in 16..231) {
        val value = clamped - 16
        val red = value / 36
        val green = (value % 36) / 6
        val blue = value % 6
        return TerminalColor(xtermCube(red), xtermCube(green), xtermCube(blue))
    }
    val gray = 8 + (clamped - 232) * 10
    return TerminalColor(gray, gray, gray)
}

private fun xtermCube(value: Int): Int {
    return if (value == 0) 0 else 55 + value * 40
}

private fun List<TerminalTextSegment>.trimTrailingNewlineSegments(): List<TerminalTextSegment> {
    if (isEmpty()) {
        return this
    }
    val segments = toMutableList()
    while (segments.isNotEmpty() && segments.last().text == "\n") {
        segments.removeAt(segments.lastIndex)
    }
    return segments
}

private fun isCsiFinalByte(char: Char): Boolean {
    return char in '@'..'~'
}

private val standardAnsiPalette = listOf(
    TerminalColor(0, 0, 0),
    TerminalColor(205, 49, 49),
    TerminalColor(13, 188, 121),
    TerminalColor(229, 229, 16),
    TerminalColor(36, 114, 200),
    TerminalColor(188, 63, 188),
    TerminalColor(17, 168, 205),
    TerminalColor(229, 229, 229),
)

private val brightAnsiPalette = listOf(
    TerminalColor(102, 102, 102),
    TerminalColor(241, 76, 76),
    TerminalColor(35, 209, 139),
    TerminalColor(245, 245, 67),
    TerminalColor(59, 142, 234),
    TerminalColor(214, 112, 214),
    TerminalColor(41, 184, 219),
    TerminalColor(255, 255, 255),
)
