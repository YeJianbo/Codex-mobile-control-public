package com.localcodex.control

import java.util.Locale
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal fun nativeRunEndLabel(value:String):String {
    val zone=ZoneId.systemDefault()
    val ended=runCatching{Instant.parse(value).atZone(zone)}.getOrNull()?:return ""
    val today=java.time.LocalDate.now(zone)
    val day=when(ended.toLocalDate()){
        today->"今天"
        today.minusDays(1)->"昨天"
        else->ended.format(DateTimeFormatter.ofPattern(if(ended.year==today.year)"M月d日" else "yyyy年M月d日",Locale.ROOT))
    }
    return "$day ${ended.format(DateTimeFormatter.ofPattern("HH:mm:ss",Locale.ROOT))}"
}

/** Keep Windows extended paths for I/O, but show the familiar path in the UI. */
internal fun nativeDisplayPath(path: String): String {
    val windows = path.replace('/', '\\')
    val prefix = "\\\\?\\"
    if (!windows.startsWith(prefix)) return path
    val remainder = windows.removePrefix(prefix)
    return when {
        remainder.length >= 3 && remainder[0].isLetter() && remainder[1] == ':' && remainder[2] == '\\' -> remainder
        remainder.startsWith("UNC\\", ignoreCase = true) -> "\\\\" + remainder.substring(4)
        else -> path
    }
}

internal fun nativeDisplayThreadTitle(value:String,fallback:String="未命名会话"):String {
    val title=value.trim()
    if(title.startsWith("<heartbeat",ignoreCase=true)){
        val instructions=Regex("<instructions>\\s*([^<]+)",RegexOption.IGNORE_CASE).find(title)?.groupValues?.get(1)?.lineSequence()?.firstOrNull()?.trim()
        return instructions?.takeIf{it.isNotBlank()}?.take(100)?:fallback
    }
    return title.ifBlank{fallback}
}

internal fun nativeTokenCount(value: Long): String {
    val (unit, suffix) = when {
        value >= 100_000_000 -> 100_000_000.0 to "亿"
        value >= 10_000 -> 10_000.0 to "万"
        else -> return value.toString()
    }
    return String.format(Locale.ROOT, "%.1f", value / unit).removeSuffix(".0") + suffix
}

internal fun nativeContextCount(value: Long): String =
    String.format(Locale.ROOT, if(value in 1..999) "%.3f" else "%.1f", value / 1_000.0)
        .trimEnd('0').trimEnd('.') + "K"
