package com.localcodex.control

import java.net.URI

data class ConnectionDraft(
    val host: String = "",
    val port: String = "",
)

enum class ConnectionRoute { AUTO, LOCAL, PUBLIC }

internal fun publicConnectionAddressError(value:String):String? {
    val uri=runCatching{URI(value)}.getOrNull()
    if(uri?.scheme!="https"||uri.host.isNullOrBlank()||uri.rawUserInfo!=null||uri.rawQuery!=null||uri.rawFragment!=null)
        return "请输入完整的公网 HTTPS 地址"
    val suffix=uri.rawPath.orEmpty()
    if(suffix.isNotEmpty()&&suffix!="/"&&!suffix.matches(Regex("/[A-Za-z0-9_-]{22,128}/?")))
        return "秘密路径需要 22 至 128 个字母、数字、下划线或短横线"
    return null
}

// Only the existing gateway APK route belongs to the in-app downloader. Resolve
// it through the active client so its TLS, device identity and route stay intact.
internal fun nativeGatewayDownloadEndpoint(href:String,addresses:List<String>):String? {
    val target=runCatching{URI(href)}.getOrNull()?:return null
    val endpoint="/downloads/android.apk"
    if(target.rawUserInfo!=null)return null
    fun matchesPath(address:URI)=target.rawPath==endpoint||target.rawPath==address.rawPath.orEmpty().trimEnd('/')+endpoint
    if(target.scheme==null)return if(target.rawAuthority==null&&(target.rawPath==endpoint||addresses.any{address->runCatching{matchesPath(URI(address))}.getOrDefault(false)}))endpoint else null
    fun origin(uri:URI):Triple<String,String,Int>? {
        val scheme=uri.scheme?.lowercase()?:return null
        if(scheme!="https"&&scheme!="http"||uri.rawUserInfo!=null)return null
        val host=uri.host?.lowercase()?:return null
        return Triple(scheme,host,if(uri.port>=0)uri.port else if(scheme=="https")443 else 80)
    }
    val requested=origin(target)?:return null
    return endpoint.takeIf{addresses.any{address->runCatching{val uri=URI(address);origin(uri)==requested&&matchesPath(uri)}.getOrDefault(false)}}
}

internal fun connectionRouteCandidates(local:String,remote:String,password:String,route:ConnectionRoute=ConnectionRoute.AUTO):List<String> = when(route){
    ConnectionRoute.LOCAL->listOf(local)
    ConnectionRoute.PUBLIC->listOfNotNull(remote.takeIf{it.isNotBlank()&&password.isNotBlank()})
    ConnectionRoute.AUTO->listOf(local)+listOfNotNull(remote.takeIf{it.isNotBlank()&&it!=local&&password.isNotBlank()})
}

internal fun shouldConnectTestedPublic(connected:Boolean,active:String,local:String,remote:String):Boolean =
    !connected || (active!=local && active!=remote)

fun connectionAttemptError(detail:String,publicConnection:Boolean,publicUrl:String,password:String):String {
    if(publicConnection)return "公网连接失败：$detail"
    return when {
        publicUrl.isBlank()->"内网连接失败：$detail；尚未填写公网地址"
        password.isBlank()->"内网连接失败：$detail；请填写公网独立密码后重试"
        else->"内网连接失败：$detail；正在尝试公网"
    }
}

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
