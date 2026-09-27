package com.localcodex.control

import android.net.Uri

internal data class NativePairLink(
    val address: String,
    val code: String,
    val publicUrl: String,
    val certificateSha256: String,
)

internal fun parseNativePairLink(raw: String): NativePairLink? {
    val uri = runCatching { Uri.parse(raw.trim()) }.getOrNull() ?: return null
    if (uri.scheme != "codex-control" || uri.host != "pair") return null
    val address = uri.getQueryParameter("baseUrl").orEmpty().trimEnd('/')
    val code = uri.getQueryParameter("code").orEmpty()
    val publicUrl = uri.getQueryParameter("publicUrl").orEmpty().trimEnd('/')
    val certificate = uri.getQueryParameter("certSha256").orEmpty()
    if (!address.startsWith("https://") || code.isBlank() || !certificate.matches(Regex("[0-9a-fA-F]{64}"))) return null
    if (publicUrl.isNotBlank() && !publicUrl.startsWith("https://")) return null
    return NativePairLink(address, code, publicUrl, certificate)
}
