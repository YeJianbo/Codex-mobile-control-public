package com.localcodex.control

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class PublicConnectionLiveTest {
    @Test fun publicPairingAndLanFallbackUseRealAndroidClient() {
        val configFile=File("/data/local/tmp/codex-public-live.json")
        assumeTrue("Live test requires a temporary pairing configuration",configFile.exists())
        val config=JSONObject(configFile.readText())
        val remote=config.getString("publicUrl")
        val password=config.getString("password")
        val initial=GatewayClient(remote,"",remotePassword=password,useDeviceCertificate=true)
        assertTrue("Public health",initial.health().ok)
        val paired=initial.claimPairing(config.getString("code"),"Android live connection check")
        val app=ApplicationProvider.getApplicationContext<Application>()
        File(app.cacheDir,"public-live-device-id").writeText(paired.deviceId)
        val api=GatewayClient(remote,paired.token,remotePassword=password,useDeviceCertificate=true)
        assertTrue("Projects",api.listProjects().isNotEmpty())
        api.nativeModels()
        runBlocking { withTimeout(15000) { assertEquals("connection.opened",api.events().first().type) } }
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        lateinit var vm:NativeViewModel
        instrumentation.runOnMainSync {
            vm=NativeViewModel(app)
            vm.connect("https://10.0.2.2:1",paired.token,publicUrl=remote,remotePassword=password,certificateSha256="")
        }
        try {
            val deadline=System.currentTimeMillis()+30000
            var connected=false
            while(System.currentTimeMillis()<deadline&&!connected){
                instrumentation.runOnMainSync { connected=vm.state.connected&&vm.state.projects.isNotEmpty() }
                if(!connected)Thread.sleep(100)
            }
            instrumentation.runOnMainSync {
                assertTrue("LAN fallback: ${vm.state.error}",vm.state.connected)
                assertEquals(remote,vm.state.activeAddress)
                assertTrue("Public project list loaded",vm.state.projects.isNotEmpty())
                vm.testPublicConnection(remote,password)
            }
            val testDeadline=System.currentTimeMillis()+30000
            var testing=true
            while(System.currentTimeMillis()<testDeadline&&testing){
                Thread.sleep(100)
                instrumentation.runOnMainSync{testing=vm.state.publicTestRunning}
            }
            instrumentation.runOnMainSync{
                assertFalse("Public diagnostic must finish",vm.state.publicTestRunning)
                assertTrue(vm.state.publicTestMessage,vm.state.publicTestPassed)
                assertTrue("Diagnostic must preserve active connection",vm.state.connected)
                assertEquals(remote,vm.state.activeAddress)
            }
        } finally { instrumentation.runOnMainSync { vm.disconnect() } }
    }
}
