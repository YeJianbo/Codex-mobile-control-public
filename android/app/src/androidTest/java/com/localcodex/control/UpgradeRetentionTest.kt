package com.localcodex.control
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assume.assumeTrue
import org.junit.Assert.*
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
class UpgradeRetentionTest {
 private val context get()=ApplicationProvider.getApplicationContext<Context>()
 private fun mode(expected:String){assumeTrue(context.packageName=="com.localcodex.control.subagents.remotecheck");assumeTrue(InstrumentationRegistry.getArguments().getString("upgradeMode")==expected)}
 private fun hash(file:File)=MessageDigest.getInstance("SHA-256").digest(file.readBytes()).joinToString(""){"%02x".format(it)}
 @Test fun seedOnlyTheOldIsolatedApplication(){
  mode("seed");assertEquals("0.6.134",context.packageManager.getPackageInfo(context.packageName,0).versionName)
  val store=ConnectionStore(context);store.save("http://127.0.0.1:1","synthetic-upgrade-token");store.saveChatDraft("codex:synthetic","Synthetic unsent draft")
  context.getSharedPreferences("native",0).edit().putString("harness","agy").putString("thread:synthetic:model","gpt-6.1-sol").putString("thread:synthetic:effort","high").commit()
  context.getSharedPreferences("appearance",0).edit().putString("theme","dark").commit()
  context.getSharedPreferences("connection",0).edit().putBoolean("upgrade-sentinel",true).commit()
  File(context.filesDir,"iteration-upgrade-sentinel").writeBytes(ByteArray(1024){(it%97).toByte()})
  val hashes=JSONObject();listOf("native","appearance","connection").forEach{hashes.put(it,hash(File(context.applicationInfo.dataDir,"shared_prefs/$it.xml")))}
  File(context.filesDir,"iteration-upgrade-hashes.json").writeText(hashes.toString())
 }
 @Test fun actualInPlaceUpgradeKeepsPairingDraftModelAndUserData(){
  mode("verify");assertEquals(BuildConfig.VERSION_NAME,context.packageManager.getPackageInfo(context.packageName,0).versionName)
  val hashes=JSONObject(File(context.filesDir,"iteration-upgrade-hashes.json").readText())
  listOf("native","appearance","connection").forEach{assertEquals(it,hashes.getString(it),hash(File(context.applicationInfo.dataDir,"shared_prefs/$it.xml")))}
  assertArrayEquals(ByteArray(1024){(it%97).toByte()},File(context.filesDir,"iteration-upgrade-sentinel").readBytes())
  val store=ConnectionStore(context);assertEquals("synthetic-upgrade-token",store.token());assertEquals("Synthetic unsent draft",store.chatDraft("codex:synthetic"))
  val native=context.getSharedPreferences("native",0);assertEquals("agy",native.getString("harness",null));assertEquals("gpt-6.1-sol",native.getString("thread:synthetic:model",null));assertEquals("high",native.getString("thread:synthetic:effort",null))
 }
}
