package com.localcodex.control

import java.net.URI

data class ConnectionDraft(
    val host: String = "",
    val port: String = "",
)

fun parseConnectionDraft(baseUrl: String): ConnectionDraft {
    if (baseUrl.isBlank()) {
        return ConnectionDraft()
    }
    return try {
        val uri = URI(baseUrl)
        val host = uri.host ?: baseUrl.removePrefix("http://").removePrefix("https://").substringBefore(":")
        val port = if (uri.port >= 0) uri.port.toString() else ""
        ConnectionDraft(host, port)
    } catch (_: Exception) {
        val raw = baseUrl.removePrefix("http://").removePrefix("https://").trimEnd('/')
        ConnectionDraft(raw.substringBefore(":"), raw.substringAfter(":", ""))
    }
}

fun gatewayBaseUrlCandidates(hostInput: String, portInput: String): List<String> {
    val host = hostInput.trim().trimEnd('/')
    val port = portInput.trim().ifBlank { "38457" }
    if (host.startsWith("http://") || host.startsWith("https://")) {
        val parsed=runCatching{URI(host)}.getOrNull()
        val local=parsed?.host?.let{it=="localhost"||it=="127.0.0.1"||it.matches(Regex("[0-9.]+"))}==true
        return listOf((if(local)withPortIfNeeded(host,port) else host).trimEnd('/'))
    }
    val normalizedHost = host.removePrefix("ws://").removePrefix("wss://").trimEnd('/')
    val hostWithPort = if (normalizedHost.substringAfterLast('/').contains(":")) normalizedHost else "$normalizedHost:$port"
    return listOf("https://$hostWithPort")
}

fun withPortIfNeeded(url: String, port: String): String {
    return try {
        val parsed = URI(url)
        if (parsed.port >= 0 || port.isBlank()) {
            url
        } else {
            val authority = parsed.host ?: return url
            val userInfo = parsed.userInfo?.let { "$it@" }.orEmpty()
            val path = parsed.rawPath.orEmpty()
            val query = parsed.rawQuery?.let { "?$it" }.orEmpty()
            "${parsed.scheme}://$userInfo$authority:$port$path$query"
        }
    } catch (_: Exception) {
        url
    }
}
