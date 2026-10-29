package com.localcodex.control

import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.FrameMetrics
import android.view.Window
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.util.WeakHashMap

internal data class NativePerformanceState(val recording:Boolean=false,val finishing:Boolean=false,val report:NativePerformanceReport?=null,val gatewayBefore:String?=null,val gatewayAfter:String?=null)

internal object NativePerformanceRecorder {
    val session=NativePerformanceSession(SystemClock::elapsedRealtime)
    private val mutableState=MutableStateFlow(NativePerformanceState())
    val state=mutableState.asStateFlow()
    private val main=Handler(Looper.getMainLooper())
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.Default)
    private val windows=WeakHashMap<Window,Boolean>()
    private val listeners=WeakHashMap<Window,Window.OnFrameMetricsAvailableListener>()
    private var thread:HandlerThread?=null
    private val timeout=Runnable{stop()}

    fun attach(window:Window,dialog:Boolean=false){
        windows[window]=dialog
        if(session.expired())stop() else if(session.active)attachCapture(window,dialog)
    }
    fun detach(window:Window){
        listeners.remove(window)?.let{window.removeOnFrameMetricsAvailableListener(it)}
        windows.remove(window)
        if(listeners.isEmpty()){thread?.quitSafely();thread=null}
    }
    fun start():Long?{
        if(mutableState.value.recording||mutableState.value.finishing)return null
        session.start();session.resume();mutableState.value=NativePerformanceState(recording=true)
        windows.entries.toList().forEach{(window,dialog)->attachCapture(window,dialog)}
        main.postDelayed(timeout,60000)
        return session.session
    }
    fun stop(){
        if(!mutableState.value.recording)return
        main.removeCallbacks(timeout);detachCapture()
        mutableState.update{it.copy(recording=false,finishing=true)}
        scope.launch{val report=session.finish();mutableState.update{it.copy(finishing=false,report=report)}}
    }
    fun gatewaySnapshot(owner:Long,value:String?,before:Boolean){
        if(session.session!=owner)return
        mutableState.update{if(before)it.copy(gatewayBefore=value) else it.copy(gatewayAfter=value)}
    }
    private fun attachCapture(current:Window,dialog:Boolean){
        if(listeners.containsKey(current))return
        val owner=session.session
        val refresh=current.decorView.display?.refreshRate?.takeIf{it>0}?:60f
        val fallback=(1_000_000_000.0/refresh).toLong()
        val worker=thread?:HandlerThread("native-frame-sample").apply{start();thread=this}
        val callback=Window.OnFrameMetricsAvailableListener{_,metrics,dropped->
            val deadline=if(Build.VERSION.SDK_INT>=31)metrics.getMetric(FrameMetrics.DEADLINE).takeIf{it>0}?:fallback else fallback
            session.frame(owner,metrics.getMetric(FrameMetrics.TOTAL_DURATION),deadline,dropped,dialog)
        }
        current.addOnFrameMetricsAvailableListener(callback,Handler(worker.looper))
        listeners[current]=callback
    }
    private fun detachCapture(){
        listeners.entries.toList().forEach{(window,listener)->window.removeOnFrameMetricsAvailableListener(listener)}
        listeners.clear();thread?.quitSafely();thread=null
    }
}
