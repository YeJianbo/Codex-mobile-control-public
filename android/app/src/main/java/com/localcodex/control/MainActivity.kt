package com.localcodex.control

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.lifecycle.ViewModelProvider

internal fun consumeNativeNotificationThread(intent:Intent?):String {
    val id=intent?.getStringExtra("notificationThreadId").orEmpty()
    intent?.removeExtra("notificationThreadId")
    return id
}

class MainActivity : ComponentActivity() {
    private lateinit var model:NativeViewModel
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window,false)
        window.statusBarColor=android.graphics.Color.TRANSPARENT
        window.navigationBarColor=android.graphics.Color.TRANSPARENT
        model=ViewModelProvider(this).get(NativeViewModel::class.java)
        if(!model.state.connected&&!model.state.connecting) {if(!pair(intent))model.autoConnect()}
        model.openNotificationThread(consumeNativeNotificationThread(intent))
        setContent { NativeApp(model) }
    }
    private fun pair(intent:Intent?):Boolean {
        val uri=intent?.data?:return false
        val link=parseNativePairLink(uri.toString())?:return false
        model.connect(link.address,code=link.code,publicUrl=link.publicUrl,certificateSha256=link.certificateSha256)
        return true
    }
    override fun onNewIntent(intent:Intent?){super.onNewIntent(intent);setIntent(intent);pair(intent);model.openNotificationThread(consumeNativeNotificationThread(intent))}
    override fun onStart(){super.onStart();NativePerformanceRecorder.attach(window);NotificationHelper.setAppForeground(this,true);model.setForeground(true)}
    override fun onStop(){NativePerformanceRecorder.detach(window);NotificationHelper.setAppForeground(this,false);model.setForeground(false);super.onStop()}
    override fun onResume(){
        super.onResume()
        val screen=window.decorView.display
        val mode=screen?.mode
        val rate=if(screen!=null&&mode!=null)screen.supportedModes.asSequence()
            .filter{it.physicalWidth==mode.physicalWidth&&it.physicalHeight==mode.physicalHeight}
            .maxOfOrNull{it.refreshRate}?:0f else 0f
        if(rate>60f){
            val attributes=window.attributes
            attributes.preferredRefreshRate=rate
            window.attributes=attributes
        }
        // 开关已开启时确保后台提醒服务在跑（startForegroundService 幂等），进程被杀后自动恢复。
        if(getSharedPreferences("native",MODE_PRIVATE).getBoolean("notify.background",false)){
            NotificationHelper.ensureChannels(this)
            runCatching{startForegroundService(Intent(this,NotificationMonitorService::class.java))}
        }
    }
    override fun onPause(){
        val attributes=window.attributes
        if(attributes.preferredRefreshRate!=0f){attributes.preferredRefreshRate=0f;window.attributes=attributes}
        super.onPause()
    }
}
