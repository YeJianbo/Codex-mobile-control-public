package com.localcodex.control

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject

class ConnectionStore(context: Context) {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)
    private val sidebarWrites=Mutex()

    fun route():ConnectionRoute=runCatching{ConnectionRoute.valueOf(prefs.getString("route","AUTO")!!)}.getOrDefault(ConnectionRoute.AUTO)
    fun saveRoute(route:ConnectionRoute){prefs.edit().putString("route",route.name).apply()}

    fun baseUrl(): String = prefs.getString("baseUrl", "") ?: ""

    private fun sidebarKey(baseUrl:String,agent:String,fingerprint:String)="sidebar:"+JSONArray(listOf(baseUrl.trimEnd('/'),agent,fingerprint.lowercase())).toString()
    internal fun sidebar(baseUrl:String,agent:String,fingerprint:String):NativeSidebarSnapshot?=runCatching{
        prefs.getString(sidebarKey(baseUrl,agent,fingerprint),null)?.let{NativeSidebarSnapshot.decode(it)}
    }.getOrNull()
    internal suspend fun saveSidebar(baseUrl:String,agent:String,fingerprint:String,snapshot:NativeSidebarSnapshot){
        if(baseUrl.isBlank())return
        val key=sidebarKey(baseUrl,agent,fingerprint);val ownerToken=token()
        sidebarWrites.withLock {
            if(token()!=ownerToken)return@withLock
            val encoded=withContext(Dispatchers.Default){snapshot.encode()}
            // Credential changes clear sidebar snapshots; an older encoder must not restore them.
            if(token()==ownerToken&&prefs.getString(key,null)!=encoded)prefs.edit().putString(key,encoded).apply()
        }
    }

    fun models(baseUrl: String): List<NativeModel> = runCatching {
        val rows = JSONArray(prefs.getString("models:${baseUrl.trimEnd('/')}", "[]"))
        (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val efforts = row.getJSONArray("efforts")
            NativeModel(row.getString("id"), row.getString("name"),
                (0 until efforts.length()).map { efforts.getString(it) }, row.getString("defaultEffort"),row.optBoolean("available",true),row.optString("unavailableReason"),row.optString("providerId"),row.optString("providerName"),row.optString("shortName"))
        }
    }.getOrDefault(emptyList())

    fun saveModels(baseUrl: String, models: List<NativeModel>) {
        if (models.isEmpty()) return
        writeModels(baseUrl,encodeModels(models))
    }

    internal suspend fun saveModelsAsync(baseUrl:String,models:List<NativeModel>,isCurrent:()->Boolean):Boolean {
        if(models.isEmpty())return isCurrent()
        val encoded=withContext(Dispatchers.Default){encodeModels(models)}
        // Resume on the caller's context before checking ownership or writing preferences.
        if(!isCurrent())return false
        writeModels(baseUrl,encoded)
        return true
    }

    private fun encodeModels(models:List<NativeModel>):String {
        val rows = JSONArray(models.map { JSONObject().put("id", it.id).put("name", it.name)
            .put("efforts", JSONArray(it.efforts)).put("defaultEffort", it.defaultEffort).put("available",it.available).put("unavailableReason",it.unavailableReason)
            .put("providerId",it.providerId).put("providerName",it.providerName).put("shortName",it.shortName) })
        return rows.toString()
    }

    private fun writeModels(baseUrl:String,encoded:String){
        val key="models:${baseUrl.trimEnd('/')}"
        if(prefs.getString(key,null)!=encoded)prefs.edit().putString(key,encoded).apply()
    }

    fun token(): String = prefs.getString("token", "") ?: ""
    fun publicUrl(): String = prefs.getString("publicUrl", "") ?: ""
    fun remotePassword(): String = prefs.getString("remotePassword", "") ?: ""
    fun certificateSha256(): String = prefs.getString("certificateSha256", "") ?: ""
    fun saveRemote(publicUrl:String,remotePassword:String,certificateSha256:String){
        prefs.edit().putString("publicUrl",publicUrl).putString("remotePassword",remotePassword)
            .putString("certificateSha256",certificateSha256).apply()
    }

    fun trustSelfSigned(): Boolean = prefs.getBoolean("trustSelfSigned", false)

    fun chatDraft(): String = prefs.getString("chatDraft", "") ?: ""

    fun chatDraft(key: String): String {
        val scoped = prefs.getString(chatDraftPrefKey(key), null)
        if (scoped != null) {
            return scoped
        }
        return if (key == "global") chatDraft() else ""
    }

    fun save(baseUrl: String, token: String, trustSelfSigned: Boolean = trustSelfSigned()) {
        if(token!=this.token())prefs.edit().also{edit->prefs.all.keys.filter{it.startsWith("sidebar:")}.forEach{edit.remove(it)}}.apply()
        prefs.edit()
            .putString("baseUrl", baseUrl)
            .putString("token", token)
            .putBoolean("trustSelfSigned", trustSelfSigned)
            .apply()
    }

    internal fun saveProfile(baseUrl:String,token:String,publicUrl:String,remotePassword:String,certificateSha256:String,route:ConnectionRoute){
        val edit=prefs.edit()
        if(token!=this.token())prefs.all.keys.filter{it.startsWith("sidebar:")}.forEach{edit.remove(it)}
        edit.putString("baseUrl",baseUrl).putString("token",token)
            .putString("publicUrl",publicUrl).putString("remotePassword",remotePassword)
            .putString("certificateSha256",certificateSha256).putString("route",route.name).apply()
    }

    fun saveChatDraft(value: String) {
        prefs.edit()
            .putString("chatDraft", value)
            .apply()
    }

    fun saveChatDraft(key: String, value: String) {
        prefs.edit()
            .putString(chatDraftPrefKey(key), value)
            .apply()
    }

    fun clearChatDraft() {
        saveChatDraft("")
    }

    fun clearChatDraft(key: String) {
        saveChatDraft(key, "")
        if (key == "global") {
            clearChatDraft()
        }
    }

    private fun chatDraftPrefKey(key: String): String = "chatDraft:$key"
    internal fun migrateNativeChatDrafts(address:String,fingerprint:String){
        val legacy=prefs.all.filterKeys{it.startsWith("chatDraft:native:")}
        if(legacy.isEmpty())return
        val edit=prefs.edit()
        for((oldKey,value) in legacy){
            val key=oldKey.removePrefix("chatDraft:")
            val scoped=chatDraftPrefKey(JSONArray(listOf(address.trimEnd('/'),fingerprint.lowercase(),key)).toString())
            if(!prefs.contains(scoped))edit.putString(scoped,value as? String?:"")
            edit.remove(oldKey)
        }
        edit.apply()
    }


    internal fun attachmentDraft(key:String):Pair<List<NativeImage>,List<NativeUploadedFile>> = runCatching {
        val value=JSONObject(prefs.getString("attachmentDraft:$key","{}")!!)
        val images=value.optJSONArray("images")?:JSONArray()
        val files=value.optJSONArray("files")?:JSONArray()
        (0 until images.length()).map{images.getJSONObject(it).let{row->NativeImage(row.getString("id"),row.optString("name"))}} to
            (0 until files.length()).map{files.getJSONObject(it).let{row->NativeUploadedFile(row.getString("id"),row.optString("name"),row.optString("mime"),row.optLong("size"))}}
    }.getOrDefault(emptyList<NativeImage>() to emptyList())
    internal fun uploadOwner():String=prefs.getString("uploadOwner",null)?:java.util.UUID.randomUUID().toString().also{prefs.edit().putString("uploadOwner",it).apply()}
    internal fun uploadDraftRefs(address:String,fingerprint:String):List<JSONObject> = prefs.all.keys.filter{it.startsWith("attachmentDraft:")}.flatMap{key->
        runCatching{
            val scope=JSONArray(key.removePrefix("attachmentDraft:"))
            if(scope.optString(0)!=address.trimEnd('/')||scope.optString(1)!=fingerprint.lowercase())emptyList()
            else attachmentDraft(key.removePrefix("attachmentDraft:")).let{(images,files)->
                images.map{JSONObject().put("kind","image").put("id",it.id)}+files.map{JSONObject().put("kind","file").put("id",it.id)}
            }
        }.getOrDefault(emptyList())
    }

    internal fun saveAttachmentDraft(key:String,images:List<NativeImage>,files:List<NativeUploadedFile>){
        val edit=prefs.edit()
        if(images.isEmpty()&&files.isEmpty())edit.remove("attachmentDraft:$key")
        else edit.putString("attachmentDraft:$key",JSONObject()
            .put("images",JSONArray(images.map{JSONObject().put("id",it.id).put("name",it.name)}))
            .put("files",JSONArray(files.map{JSONObject().put("id",it.id).put("name",it.name).put("mime",it.mime).put("size",it.size)})).toString())
        edit.apply()
    }
    internal fun queueDraftApplied(key:String,id:String)=prefs.getBoolean("queueDraftApplied:$key:$id",false)
    internal fun applyQueueDraft(key:String,item:NativeQueued,text:String,images:List<NativeImage>,files:List<NativeUploadedFile>):Triple<String,List<NativeImage>,List<NativeUploadedFile>>{
        if(queueDraftApplied(key,item.id))return Triple(text,images,files)
        val restoredImages=(item.images+images).distinctBy{it.id}
        val restoredFiles=(item.uploads+files).distinctBy{it.id}
        require(restoredFiles.size<=8){"文件附件已满，请先移除部分文件再继续编辑"}
        val restoredText=listOf(item.text,text).filter{it.isNotBlank()}.joinToString("\n\n")
        // One preferences update keeps the copy and its applied marker together.
        prefs.edit().putString(chatDraftPrefKey(key),restoredText)
            .putString("attachmentDraft:$key",JSONObject()
                .put("images",JSONArray(restoredImages.map{JSONObject().put("id",it.id).put("name",it.name)}))
                .put("files",JSONArray(restoredFiles.map{JSONObject().put("id",it.id).put("name",it.name).put("mime",it.mime).put("size",it.size)})).toString())
            .putBoolean("queueDraftApplied:$key:${item.id}",true).apply()
        return Triple(restoredText,restoredImages,restoredFiles)
    }
    internal fun flushDrafts(){check(prefs.edit().commit()){"草稿未能保存，请继续恢复；电脑上的原消息仍保留"}}
    internal fun finishQueueDraft(key:String,id:String){prefs.edit().remove("queueDraftApplied:$key:$id").apply()}
    internal fun pruneQueueDraftMarkers(key:String,retained:Set<String>){
        val prefix="queueDraftApplied:$key:"
        val expired=prefs.all.keys.filter{it.startsWith(prefix)&&it.removePrefix(prefix) !in retained}
        if(expired.isNotEmpty())prefs.edit().also{edit->expired.forEach(edit::remove)}.apply()
    }
}
