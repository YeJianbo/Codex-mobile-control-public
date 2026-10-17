package com.localcodex.control

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

// Give the preferred route a short head start, without waiting for an unreachable LAN.
internal suspend fun <T> firstResponsiveRoute(
    routes:List<String>, headStartMs:Long=300, probe:suspend (String)->T,
):Pair<String,T> = coroutineScope {
    require(routes.isNotEmpty())
    val results=Channel<Result<Pair<String,T>>>(Channel.UNLIMITED)
    val jobs=routes.mapIndexed{index,route->launch{
        delay(index*headStartMs)
        try{results.send(Result.success(route to probe(route)))}
        catch(e:CancellationException){throw e}
        catch(e:Exception){results.send(Result.failure(e))}
    }}
    try {
        var failure:Throwable?=null
        repeat(routes.size){
            val result=results.receive()
            if(result.isSuccess)return@coroutineScope result.getOrThrow()
            failure=result.exceptionOrNull()
        }
        throw checkNotNull(failure)
    }finally{jobs.forEach{it.cancel()};results.close()}
}
