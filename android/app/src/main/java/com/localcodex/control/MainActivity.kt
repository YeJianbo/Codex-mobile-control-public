package com.localcodex.control

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.view.WindowCompat
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider

internal fun consumeNativeNotificationThread(intent:Intent?):String {
    val id=intent?.getStringExtra("notificationThreadId").orEmpty()
    intent?.removeExtra("notificationThreadId")
    return id
}

// 外部配对链接确认弹出前立即清掉 intent.data：旋转/重建会重投递同一 intent，
// 不清掉就会重复处理。仅 pair 链接会清；线程通知等其他深链的 data 原样保留。
internal fun consumeNativePairLink(intent:Intent?):NativePairLink? {
    val uri=intent?.data?:return null
    val link=parseNativePairLink(uri.toString())?:return null
    intent.data=null
    return link
}

// 外部链接必须经用户确认后才 connect；确认前不触碰已保存的连接资料和当前会话。
class NativePairPromptModel:ViewModel() {
    internal var pending by mutableStateOf<NativePairLink?>(null)
        private set
    var restoreAutoConnect by mutableStateOf(false)
        private set
    fun hasPending():Boolean=pending!=null
    internal fun offer(link:NativePairLink,restore:Boolean){pending=link;restoreAutoConnect=restore}
    fun confirm(model:NativeViewModel){
        val link=pending?:return
        pending=null;restoreAutoConnect=false
        model.connect(link.address,code=link.code,publicUrl=link.publicUrl,certificateSha256=link.certificateSha256)
    }
    fun dismiss(model:NativeViewModel){
        pending=null
        val restore=restoreAutoConnect
        restoreAutoConnect=false
        if(restore&&!model.state.connected&&!model.state.connecting)model.autoConnect()
    }
}

class MainActivity : ComponentActivity() {
    private lateinit var model:NativeViewModel
    private lateinit var pairPrompt:NativePairPromptModel
    override fun onCreate(savedInstanceState:Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window,false)
        window.statusBarColor=android.graphics.Color.TRANSPARENT
        window.navigationBarColor=android.graphics.Color.TRANSPARENT
        model=ViewModelProvider(this).get(NativeViewModel::class.java)
        pairPrompt=ViewModelProvider(this).get(NativePairPromptModel::class.java)
        val link=consumeNativePairLink(intent)
        if(link!=null)pairPrompt.offer(link,restore=!model.state.connected&&!model.state.connecting)
        else if(!model.state.connected&&!model.state.connecting&&!pairPrompt.hasPending())model.autoConnect()
        model.openNotificationThread(consumeNativeNotificationThread(intent))
        setContent { NativeApp(model,pairPrompt) }
    }
    override fun onNewIntent(intent:Intent?){
        super.onNewIntent(intent);setIntent(intent)
        consumeNativePairLink(intent)?.let{pairPrompt.offer(it,restore=!model.state.connected&&!model.state.connecting)}
        model.openNotificationThread(consumeNativeNotificationThread(intent))
    }
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
