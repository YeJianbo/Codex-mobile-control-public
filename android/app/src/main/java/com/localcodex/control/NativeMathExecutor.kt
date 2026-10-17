package com.localcodex.control

import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

internal fun createNativeMathExecutor()=ThreadPoolExecutor(2,2,60,TimeUnit.SECONDS,LinkedBlockingQueue<Runnable>(),
    {task->Thread(task,"native-math").apply{isDaemon=true}}).apply{allowCoreThreadTimeOut(true)}

internal val nativeMathExecutor by lazy{createNativeMathExecutor()}
