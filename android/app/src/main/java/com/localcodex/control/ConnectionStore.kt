package com.localcodex.control

import android.content.Context

class ConnectionStore(context: Context) {
    private val prefs = context.getSharedPreferences("connection", Context.MODE_PRIVATE)

    fun baseUrl(): String = prefs.getString("baseUrl", "") ?: ""

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
        prefs.edit()
            .putString("baseUrl", baseUrl)
            .putString("token", token)
            .putBoolean("trustSelfSigned", trustSelfSigned)
            .apply()
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
}
