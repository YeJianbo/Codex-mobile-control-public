package com.localcodex.control

fun reconnectDelayMillis(attempt: Int): Long {
    val safeAttempt = attempt.coerceAtLeast(0)
    return when {
        safeAttempt <= 0 -> 1_000L
        safeAttempt == 1 -> 2_000L
        safeAttempt == 2 -> 4_000L
        safeAttempt == 3 -> 8_000L
        else -> 15_000L
    }
}

fun connectionLabel(connected: Boolean, reconnecting: Boolean, attempt: Int): String {
    return when {
        connected -> "在线"
        reconnecting -> "重连中 ${attempt.coerceAtLeast(1)}"
        else -> "离线"
    }
}

fun shouldAutoConnectSavedConnection(
    baseUrl: String,
    token: String,
    pairCode: String,
    alreadyAttempted: Boolean,
    connected: Boolean,
): Boolean {
    return !alreadyAttempted &&
        !connected &&
        pairCode.isBlank() &&
        baseUrl.trim().isNotBlank() &&
        token.trim().isNotBlank()
}

fun shouldAutoCloseConnectionDialog(connected: Boolean, autoOpened: Boolean): Boolean {
    return connected && autoOpened
}

fun shouldScheduleReconnectAfterConnectFailure(baseUrl: String, token: String, message: String): Boolean {
    val normalized = message.lowercase()
    val authFailed = normalized.contains("http 401") || normalized.contains("http 403")
    return baseUrl.trim().isNotBlank() && token.trim().isNotBlank() && !authFailed
}
