package com.localcodex.control

import org.json.JSONArray
import org.json.JSONObject

internal fun mergeSidebarDelta(previous:JSONObject?,response:JSONObject):JSONObject {
    if(!response.optBoolean("sidebarDelta"))return response
    require(previous!=null&&previous.optString("sidebarRevision")==response.optString("sidebarBase")){"侧栏版本不匹配，请刷新"}
    val result=JSONObject(previous.toString())
    for(name in listOf("threads","projects","allowedProjects")){
        val old=previous.optJSONArray(name)?:continue
        fun key(row:JSONObject)=if(name=="threads")row.getString("id") else JSONArray(listOf(row.getString("id"),row.optString("path"))).toString()
        fun wireKey(value:String)=if(name=="threads")value else JSONArray(value).toString()
        val rows=linkedMapOf<String,JSONObject>()
        for(i in 0 until old.length())old.getJSONObject(i).let{rows[key(it)]=it}
        response.optJSONObject("removed")?.optJSONArray(name)?.let{removed->for(i in 0 until removed.length())rows.remove(wireKey(removed.getString(i)))}
        response.optJSONObject("changed")?.optJSONArray(name)?.let{changed->for(i in 0 until changed.length())changed.getJSONObject(i).let{rows[key(it)]=it}}
        val order=response.optJSONObject("order")?.optJSONArray(name)
        val sorted=if(order==null)rows.values.toList() else (0 until order.length()).map{checkNotNull(rows[wireKey(order.getString(it))])}
        result.put(name,JSONArray(sorted))
    }
    response.keys().forEach{key->if(key !in setOf("sidebarDelta","sidebarBase","changed","removed","order"))result.put(key,response.get(key))}
    return result
}
