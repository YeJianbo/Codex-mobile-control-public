package com.localcodex.control

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

internal data class NativeAppRelease(val version:String,val code:Long,val size:Long,val sha256:String,val notes:String){
    companion object {
        fun parse(json:JSONObject,packageName:String):NativeAppRelease {
            require(json.getString("packageName")==packageName){"更新包不属于当前应用"}
            val release=NativeAppRelease(json.getString("versionName"),json.getLong("versionCode"),json.getLong("size"),json.getString("sha256").lowercase(),json.optString("notes"))
            require(release.code>0&&release.size in 1..100L*1024*1024&&release.sha256.matches(Regex("[a-f0-9]{64}"))){"更新信息不完整"}
            return release
        }
    }
}
internal data class NativeAppUpdateState(
    val release:NativeAppRelease?=null,val checking:Boolean=false,val downloading:Boolean=false,val verifying:Boolean=false,
    val downloaded:Long=0,val total:Long=0,val ready:File?=null,val autoCheck:Boolean=true,val error:String="",val checkedAt:Long=0,
    val requestInstall:Boolean=false,
)

/** Update work belongs to the app, so leaving Settings does not cancel a download. */
internal class NativeAppUpdateController(
    private val context:Context,private val scope:CoroutineScope,private val connection:()->GatewayClient?,
    internal val currentCode:Long=BuildConfig.VERSION_CODE.toLong(),private val packageName:String=context.packageName,
){
    private val prefs=context.getSharedPreferences("app-updates",0)
    private val directory=File(context.cacheDir,"outputs/app-update")
    private var job:Job?=null
    private var downloadSerial=0
    private var lastAutomaticAttempt=0L
    var state by mutableStateOf(NativeAppUpdateState(autoCheck=prefs.getBoolean("automatic",true)));private set
    init {
        val cached=runCatching{NativeAppRelease.parse(JSONObject(prefs.getString("release","").orEmpty()),packageName)}.getOrNull()
        state=state.copy(release=cached,checkedAt=prefs.getLong("checkedAt",0))
        directory.listFiles()?.filter{it.name.endsWith(".part")||it.name.removeSuffix(".apk").toLongOrNull()?.let{code->code<=currentCode}==true}?.forEach{it.delete()}
    }
    private suspend fun latest(api:GatewayClient):NativeAppRelease{
        val json=api.nativeJsonAsync("GET","/downloads/android.json")
        val release=NativeAppRelease.parse(json,packageName)
        val now=System.currentTimeMillis()
        prefs.edit().putString("release",json.toString()).putLong("checkedAt",now).apply()
        state=state.copy(release=release,checkedAt=now)
        return release
    }
    fun automatic(enabled:Boolean){prefs.edit().putBoolean("automatic",enabled).apply();state=state.copy(autoCheck=enabled);if(enabled)check(true)}
    fun check(automatic:Boolean=false){
        if(job?.isCompleted==false)return
        val now=System.currentTimeMillis()
        if(automatic&&(!state.autoCheck||now-maxOf(state.checkedAt,lastAutomaticAttempt)<6*60*60*1000L))return
        val api=connection()?:run{if(!automatic)state=state.copy(error="连接电脑后检查更新");return}
        if(automatic)lastAutomaticAttempt=now
        state=state.copy(checking=true,error="")
        job=scope.launch{
            try{
                val release=latest(api)
                val ready=File(directory,"${release.code}.apk").takeIf{it.isFile&&it.length()==release.size}
                state=state.copy(ready=ready)
            }catch(e:CancellationException){throw e}catch(e:Exception){if(!automatic)state=state.copy(error=e.message.orEmpty().ifBlank{"检查更新失败"})}
            finally{state=state.copy(checking=false)}
        }
    }
    fun download(){
        if(job?.isCompleted==false)return
        val api=connection()?:run{state=state.copy(error="连接电脑后下载更新");return}
        state=state.copy(downloading=true,downloaded=0,total=0,ready=null,error="",requestInstall=false)
        val serial=++downloadSerial
        job=scope.launch{
            try{
                // A cached discovery is only for display; downloading always uses
                // the currently published manifest, even within the auto-check window.
                var release=latest(api)
                if(release.code<=currentCode)return@launch
                var activeAttempt=-1
                for(attempt in 0..1){
                    activeAttempt=attempt
                    val partial=File(directory,"${release.code}-$serial-$attempt.part")
                    state=state.copy(downloading=true,verifying=false,downloaded=0,total=release.size)
                    try{
                        api.nativeDownload("/downloads/android.apk",partial,maxBytes=release.size){done,_->
                            scope.launch{if(serial==downloadSerial&&attempt==activeAttempt&&state.downloading)state=state.copy(downloaded=done)}
                        }
                        state=state.copy(downloading=false,verifying=true)
                        withContext(Dispatchers.IO){validate(partial,release)}
                        val ready=File(directory,"${release.code}.apk")
                        check(withContext(Dispatchers.IO){partial.renameTo(ready)}){"无法保存更新包"}
                        directory.listFiles()?.filter{it!=ready}?.forEach{it.delete()}
                        state=state.copy(ready=ready,downloaded=release.size,requestInstall=true)
                        return@launch
                    }catch(e:CancellationException){throw e}catch(e:Exception){
                        if(attempt==0){
                            val refreshed=try{latest(api)}catch(cancelled:CancellationException){throw cancelled}catch(_:Exception){throw e}
                            // Retry only when publication changed. The same bad package
                            // must still fail its size, hash, version or signature check.
                            if(refreshed.code>currentCode&&(refreshed.code!=release.code||refreshed.sha256!=release.sha256||refreshed.size!=release.size)){
                                release=refreshed
                                continue
                            }
                        }
                        throw e
                    }finally{partial.delete()}
                }
            }catch(e:CancellationException){throw e}catch(e:Exception){state=state.copy(error=if(e is java.io.FileNotFoundException)"无法写入更新包，请重试下载" else e.message.orEmpty().ifBlank{"下载失败，请重试"})}
            finally{state=state.copy(downloading=false,verifying=false)}
        }
    }
    fun cancel(){downloadSerial++;job?.cancel();state=state.copy(checking=false,downloading=false,verifying=false,requestInstall=false)}
    fun consumeInstallRequest(){state=state.copy(requestInstall=false)}
    fun install(open:(File)->Unit){
        if(job?.isActive==true)return
        val file=state.ready?:return;val release=state.release?:return
        state=state.copy(verifying=true,error="")
        job=scope.launch{
            try{withContext(Dispatchers.IO){validate(file,release)};open(file)}
            catch(e:CancellationException){throw e}catch(e:Exception){file.delete();state=state.copy(ready=null,error=e.message.orEmpty().ifBlank{"无法安装更新"})}
            finally{state=state.copy(verifying=false)}
        }
    }
    @Suppress("DEPRECATION")
    private fun validate(file:File,release:NativeAppRelease){
        require(file.length()==release.size){"更新包下载不完整，请重试"}
        val digest=MessageDigest.getInstance("SHA-256")
        file.inputStream().use{input->val buffer=ByteArray(32768);while(true){val read=input.read(buffer);if(read<0)break;digest.update(buffer,0,read)}}
        require(digest.digest().joinToString(""){"%02x".format(it)}==release.sha256){"更新包已变更，请重新检查更新"}
        val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val archive=context.packageManager.getPackageArchiveInfo(file.absolutePath,flags)?:error("无法读取更新安装包")
        val installed=context.packageManager.getPackageInfo(context.packageName,flags)
        require(archive.packageName==packageName){"更新包不属于当前应用"}
        val code=if(Build.VERSION.SDK_INT>=28)archive.longVersionCode else archive.versionCode.toLong()
        require(code==release.code&&code>currentCode){"更新版本已变化，请重新检查更新"}
        fun signatures(info:android.content.pm.PackageInfo)=if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners?.map{it.toCharsString()}.orEmpty() else info.signatures?.map{it.toCharsString()}.orEmpty()
        val signedBy=signatures(installed)
        require(signedBy.isNotEmpty()&&signatures(archive).toSet()==signedBy.toSet()){"更新签名与当前应用不一致"}
    }
}
