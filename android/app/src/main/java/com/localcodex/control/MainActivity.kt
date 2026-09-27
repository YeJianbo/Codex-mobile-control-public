package com.localcodex.control

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.ViewModelProvider

class MainActivity : ComponentActivity() {
    private lateinit var model:NativeViewModel
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor=android.graphics.Color.WHITE
        window.navigationBarColor=android.graphics.Color.WHITE
        window.decorView.systemUiVisibility=android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        model=ViewModelProvider(this).get(NativeViewModel::class.java)
        if(!model.state.connected&&!model.state.connecting) {if(!pair(intent))model.autoConnect()}
        setContent { NativeApp(model) }
    }
    private fun pair(intent:Intent?):Boolean {
        val uri=intent?.data?:return false
        val link=parseNativePairLink(uri.toString())?:return false
        model.connect(link.address,code=link.code,publicUrl=link.publicUrl,certificateSha256=link.certificateSha256)
        return true
    }
    override fun onNewIntent(intent:Intent?){super.onNewIntent(intent);pair(intent)}
}
