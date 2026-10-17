package com.localcodex.control

import okhttp3.Dispatcher
import okhttp3.OkHttpClient

// Share TLS, signing, pooling and heartbeat settings. History/file reads must
// not occupy the dispatcher needed to establish/check the event connection or
// recover a submission receipt after reconnecting.
internal fun OkHttpClient.connectionTransport():OkHttpClient = newBuilder().dispatcher(Dispatcher()).build()

internal fun OkHttpClient.requestTransport(connection:OkHttpClient,method:String,path:String):OkHttpClient {
    val route=path.substringBefore('?')
    return if(method=="GET"&&route.startsWith("/api/threads/")&&route.endsWith("/submission"))connection else this
}
