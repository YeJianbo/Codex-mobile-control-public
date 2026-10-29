package com.localcodex.control

import android.content.Context
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.material.LocalContentColor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import okhttp3.mockwebserver.*
import okio.Buffer
import org.json.JSONObject
import org.junit.*
import org.junit.Assert.*
import java.io.File
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

class NativeAppUpdateTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    private lateinit var context:Context
    private lateinit var server:MockWebServer
    private lateinit var scope:CoroutineScope
    private lateinit var controller:NativeAppUpdateController
    private lateinit var apk:ByteArray
    @Volatile private var badHash=false
    @Volatile private var slow=false
    private var installIntent:Intent?=null
    @Before fun setup(){
        context=ApplicationProvider.getApplicationContext()
        context.getSharedPreferences("app-updates",0).edit().clear().commit()
        File(context.cacheDir,"outputs/app-update").listFiles()?.forEach{it.delete()}
        apk=File(InstrumentationRegistry.getArguments().getString("updateApk")?:error("Missing fixture APK")).readBytes()
        server=MockWebServer()
        server.dispatcher=object:Dispatcher(){
            override fun dispatch(request:RecordedRequest):MockResponse=when(request.requestUrl!!.encodedPath){
                "/downloads/android.json"->MockResponse().setHeader("Content-Type","application/json").setBody(JSONObject()
                    .put("packageName","com.localcodex.control").put("versionName",BuildConfig.VERSION_NAME).put("versionCode",BuildConfig.VERSION_CODE)
                    .put("size",apk.size).put("sha256",if(badHash)"0".repeat(64) else MessageDigest.getInstance("SHA-256").digest(apk).joinToString(""){"%02x".format(it)})
                    .put("notes","应用内检查、下载和安装更新").toString())
                "/downloads/android.apk"->MockResponse().setHeader("Content-Type","application/vnd.android.package-archive")
                    .setBody(Buffer().write(apk)).throttleBody(32768,if(slow)150 else 5,TimeUnit.MILLISECONDS)
                else->MockResponse().setResponseCode(404)
            }
        }
        server.start()
        scope=CoroutineScope(SupervisorJob()+Dispatchers.Main.immediate)
        val gateway=GatewayClient(server.url("/").toString().trimEnd('/'),"fixture")
        controller=NativeAppUpdateController(context,scope,{gateway},
            currentCode=BuildConfig.VERSION_CODE.toLong()-1,packageName="com.localcodex.control")
        ui.setContent{
            val theme=NativeBuiltinThemes.liquid.resolve(false);val colors=theme.palette.material(false)
            NativeThemeProvider(theme,colors){CompositionLocalProvider(LocalContentColor provides colors.onSurface){
                NativeAppUpdateContent(controller.state,controller.currentCode,"0.6.467",{},{controller.check()},controller::download,
                    controller::cancel,{controller.install{installIntent=nativeAppInstallIntent(context,it)}},controller::automatic)
            }}
        }
    }
    @After fun cleanup(){if(::scope.isInitialized)scope.cancel();if(::server.isInitialized)server.shutdown()}
    private fun check(){ui.runOnIdle{controller.check()};ui.waitUntil(10000){!controller.state.checking&&controller.state.release!=null}}
    @Test fun updateDownloadsInsideTheAppAndCreatesAReadableInstallIntent(){
        check()
        ui.onNodeWithText("发现新版本").assertIsDisplayed()
        ui.onNodeWithText("下载并安装").performClick()
        ui.waitUntil(10000){controller.state.ready!=null&&!controller.state.verifying}
        assertEquals(apk.size.toLong(),controller.state.downloaded)
        ui.onNodeWithText("安装更新").performClick()
        ui.waitUntil(10000){installIntent!=null}
        val intent=installIntent!!
        assertEquals("application/vnd.android.package-archive",intent.type)
        assertEquals("content",intent.data!!.scheme)
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION!=0)
        assertArrayEquals(apk,context.contentResolver.openInputStream(intent.data!!)!!.use{it.readBytes()})
    }
    @Test fun cacheDirectoryReclaimedAfterStartupIsRecreatedOnDownload(){
        check()
        File(context.cacheDir,"outputs/app-update").deleteRecursively()
        ui.runOnIdle{controller.download()}
        ui.waitUntil(10000){controller.state.ready!=null||controller.state.error.isNotBlank()}
        assertEquals("",controller.state.error)
        assertNotNull(controller.state.ready)
    }
    @Test fun changedPackageIsNotOfferedForInstallationAndCanBeRetried(){
        badHash=true;check()
        ui.runOnIdle{controller.download()}
        ui.waitUntil(10000){controller.state.error.isNotBlank()&&!controller.state.downloading&&!controller.state.verifying}
        assertNull(controller.state.ready)
        assertFalse(controller.state.requestInstall)
        assertTrue(File(context.cacheDir,"outputs/app-update").listFiles().orEmpty().none{it.name.endsWith(".part")})
        badHash=false;check()
        ui.runOnIdle{controller.download()}
        ui.waitUntil(10000){controller.state.ready!=null&&!controller.state.verifying}
        assertEquals("",controller.state.error)
    }
    @Test fun cancellingDownloadLeavesNoPartialPackageOrInstallRequest(){
        slow=true;check()
        ui.runOnIdle{controller.download()}
        ui.waitUntil(10000){controller.state.downloading&&controller.state.downloaded>0}
        ui.runOnIdle{controller.cancel()}
        ui.waitUntil(5000){File(context.cacheDir,"outputs/app-update").listFiles().orEmpty().none{it.name.endsWith(".part")}}
        assertNull(controller.state.ready);assertFalse(controller.state.requestInstall)
        slow=false
        ui.runOnIdle{controller.download()}
        ui.waitUntil(10000){controller.state.ready!=null&&!controller.state.verifying}
    }
}
