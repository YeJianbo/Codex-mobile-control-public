package com.localcodex.control

import org.json.JSONArray
import org.json.JSONObject

internal data class NativeSidebarSnapshot(
    val threads:List<ThreadRecord>,val projects:List<Project>,val allowedProjects:List<Project>,
    val moreThreads:Boolean,val moreProjects:Boolean,val threadLimit:Int=10,val projectLimit:Int=5,
){
    fun encode():String {
        fun projectRows(rows:List<Project>)=JSONArray(rows.take(50).map{
            JSONObject().put("id",it.id).put("name",it.name).put("path",it.path).put("trusted",it.trusted)
        })
        val rows=threads.take(100).map{thread->
            // Cached titles remain useful offline; running/goal state must come from the server.
            JSONObject().put("id",thread.id).put("title",thread.title).put("projectPath",thread.projectPath)
                .put("updatedAt",thread.updatedAt).put("pinnedIndex",thread.pinnedIndex)
                .put("source",thread.source).put("readOnly",thread.readOnly)
                .put("snapshotUpdatedAt",thread.snapshotUpdatedAt).put("snapshotStatus",thread.snapshotStatus)
                .put("snapshotStale",thread.snapshotStale).put("snapshotContentKind",thread.snapshotContentKind)
                .also{row->thread.subagent?.let{row.put("subagent",JSONObject().put("parentThreadId",it.parentThreadId)
                    .put("nickname",it.nickname).put("role",it.role).put("task",it.task))}}
        }
        return JSONObject().put("threads",JSONArray(rows)).put("projects",projectRows(projects))
            .put("allowedProjects",projectRows(allowedProjects)).put("moreThreads",moreThreads||threads.size>100)
            .put("moreProjects",moreProjects||projects.size>50).put("threadLimit",threadLimit.coerceAtMost(100)).put("projectLimit",projectLimit.coerceAtMost(50)).toString()
    }
    companion object {
        fun decode(raw:String):NativeSidebarSnapshot {
            val value=JSONObject(raw)
            fun projects(key:String):List<Project>{val rows=value.getJSONArray(key);return (0 until rows.length()).map{
                val row=rows.getJSONObject(it);Project(row.getString("id"),row.getString("name"),row.getString("path"),row.optBoolean("trusted"))
            }}
            val rows=value.getJSONArray("threads")
            return NativeSidebarSnapshot((0 until rows.length()).map{rows.getJSONObject(it).toThreadRecord()},
                projects("projects"),projects("allowedProjects"),value.optBoolean("moreThreads"),value.optBoolean("moreProjects"),value.optInt("threadLimit",10),value.optInt("projectLimit",5))
        }
    }
}
