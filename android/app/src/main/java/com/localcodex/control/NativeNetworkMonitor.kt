package com.localcodex.control

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper

internal class NativeNetworkMonitor(context:Context,onChanged:()->Unit):AutoCloseable {
    private val manager=context.getSystemService(ConnectivityManager::class.java)
    private val handover=NativeNetworkHandover<Network>(manager.activeNetwork)
    private var closed=false
    private val callback=object:ConnectivityManager.NetworkCallback(){
        override fun onAvailable(network:Network){if(!closed&&handover.available(network))onChanged()}
        override fun onLost(network:Network){if(!closed)handover.lost(network)}
    }
    init{manager.registerDefaultNetworkCallback(callback,Handler(Looper.getMainLooper()))}
    override fun close(){if(!closed){closed=true;manager.unregisterNetworkCallback(callback)}}
}
