package com.localcodex.control

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri

internal fun nativeOpenBrowser(context:Context,url:String){
    val intent=Intent(Intent.ACTION_VIEW,Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    // Resolve a neutral web address so a site's deep-link app cannot replace the user's browser.
    val browser=context.packageManager.resolveActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://example.org/")).addCategory(Intent.CATEGORY_BROWSABLE),PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo
    if(browser!=null&&browser.packageName!="android"&&browser.exported)intent.setPackage(browser.packageName)
    context.startActivity(intent)
}
