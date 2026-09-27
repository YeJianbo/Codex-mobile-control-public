package com.localcodex.control

import java.net.URI

data class PreviewAddressValidation(
    val url: String = "",
    val error: String = "",
)

fun normalizePreviewAddress(input: String): PreviewAddressValidation {
    val raw = input.trim()
    if (raw.isBlank()) {
        return PreviewAddressValidation(error = "请输入电脑本机 localhost 预览地址。")
    }

    val withScheme = if (raw.startsWith("http://") || raw.startsWith("https://")) raw else "http://$raw"
    return try {
        val uri = URI(withScheme)
        val host = uri.host.orEmpty()
        if (host !in setOf("localhost", "127.0.0.1")) {
            PreviewAddressValidation(error = "预览代理只支持 localhost 或 127.0.0.1。")
        } else if (uri.scheme !in setOf("http", "https")) {
            PreviewAddressValidation(error = "预览地址只支持 http 或 https。")
        } else {
            PreviewAddressValidation(url = uri.toString())
        }
    } catch (_: Exception) {
        PreviewAddressValidation(error = "预览地址格式不正确。")
    }
}
