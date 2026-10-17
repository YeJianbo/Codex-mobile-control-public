package com.localcodex.control

import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.conflate

/** Complete the visible version, then prepare the newest pending version. */
internal suspend fun <T> collectNativeRenderUpdates(source:Flow<String>,prepare:suspend (String)->T,publish:(String,T)->Unit){
    source.conflate().collect{input->
        val result=prepare(input)
        currentCoroutineContext().ensureActive()
        publish(input,result)
    }
}
