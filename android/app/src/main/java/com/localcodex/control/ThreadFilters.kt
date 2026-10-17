package com.localcodex.control

fun subagentLabel(thread:ThreadRecord):String = thread.subagent?.let { "子代理 · ${it.nickname.ifBlank{it.role.ifBlank{it.task.ifBlank{"未命名"}}}}" } ?: nativeDisplayThreadTitle(thread.title,"")

fun subagentRunning(thread:ThreadRecord):Boolean = thread.status in setOf("running","starting") || thread.goal?.status=="active"

fun conversationRunningAgents(threads:List<ThreadRecord>,threadId:String):List<ThreadRecord> {
    val children=threads.filter{it.subagent!=null}.groupBy{it.subagent!!.parentThreadId}
    val pending=java.util.ArrayDeque<String>();pending.add(threadId)
    val descendants=mutableSetOf(threadId)
    while(pending.isNotEmpty())children[pending.removeFirst()].orEmpty().forEach{child->
        if(descendants.add(child.id))pending.add(child.id)
    }
    descendants.remove(threadId)
    return threads.distinctBy{it.id}.filter{it.id in descendants&&subagentRunning(it)}
}

fun sidebarInactiveAgents(threads:List<ThreadRecord>,query:String="",filter:NativeThreadFilter=NativeThreadFilter.ALL):List<ThreadRecord> {
    if(filter==NativeThreadFilter.RUNNING)return emptyList()
    val parents=threads.associateBy{it.id}
    return threads.distinctBy{it.id}.filter{thread->
        thread.subagent!=null&&!subagentRunning(thread)&&(filter!=NativeThreadFilter.UNREAD||thread.unread)&&
            (query.isBlank()||listOf(subagentLabel(thread),thread.subagent.role,thread.subagent.task,thread.title,thread.projectPath,parents[thread.subagent.parentThreadId]?.title.orEmpty()).any{it.contains(query.trim(),true)})
    }
}

fun conversationParent(threads:List<ThreadRecord>,threadId:String):ThreadRecord? {
    val current=threads.find{it.id==threadId}?:return null
    val parentId=current.subagent?.parentThreadId?.takeIf{it.isNotBlank()&&it!=threadId}?:return null
    return threads.find{it.id==parentId}?:ThreadRecord(parentId,title="上级会话",projectPath=current.projectPath)
}

fun conversationLineage(threads:List<ThreadRecord>,threadId:String):List<ThreadRecord> {
    val rows=threads.associateBy{it.id};val result=mutableListOf<ThreadRecord>();val seen=mutableSetOf<String>()
    var row=rows[threadId]
    while(row!=null&&seen.add(row.id)){result.add(row);row=rows[row.subagent?.parentThreadId]}
    return result
}

enum class NativeThreadFilter(val wire:String,val label:String){ALL("all","全部"),RUNNING("running","进行中"),UNREAD("unread","未读")}

fun threadFamilyMatchesFilter(thread:ThreadRecord,children:Map<String,List<ThreadRecord>>,filter:NativeThreadFilter):Boolean {
    if(filter==NativeThreadFilter.ALL)return true
    val pending=java.util.ArrayDeque<ThreadRecord>();pending.add(thread)
    val seen=mutableSetOf<String>()
    while(pending.isNotEmpty()){
        val row=pending.removeLast()
        if(!seen.add(row.id))continue
        if(if(filter==NativeThreadFilter.RUNNING)row.status=="running" else row.unread&&row.status!="running")return true
        children[row.id].orEmpty().forEach{pending.add(it)}
    }
    return false
}
fun threadFamilyRunning(thread:ThreadRecord,children:Map<String,List<ThreadRecord>>):Boolean=threadFamilyMatchesFilter(thread,children,NativeThreadFilter.RUNNING)

fun sidebarThreadRoots(threads:List<ThreadRecord>,query:String="",filter:NativeThreadFilter=NativeThreadFilter.ALL):List<ThreadRecord> {
    val children=threads.filter{it.subagent?.parentThreadId?.isNotBlank()==true}.groupBy{it.subagent!!.parentThreadId}
    return threads.filter { it.subagent==null && threadFamilyMatchesFilter(it,children,filter) && (query.isBlank() || listOf(it.title,it.projectPath,it.goal?.objective.orEmpty()).any { text->text.contains(query.trim(),true) }) }
}

fun threadProjectLabel(thread: ThreadRecord, projects: List<Project>): String {
    val project = projects.firstOrNull { it.path == thread.projectPath }
    return when {
        project != null -> "${project.name} · ${project.path}"
        thread.projectPath.isNotBlank() -> thread.projectPath
        else -> "未绑定项目"
    }
}

fun threadMatchesQuery(thread: ThreadRecord, projects: List<Project>, query: String): Boolean {
    val normalized = query.trim().lowercase()
    if (normalized.isBlank()) {
        return true
    }
    return thread.title.lowercase().contains(normalized) ||
        thread.id.lowercase().contains(normalized) ||
        thread.status.lowercase().contains(normalized) ||
        thread.updatedAt.lowercase().contains(normalized) ||
        thread.projectPath.lowercase().contains(normalized) ||
        threadProjectLabel(thread, projects).lowercase().contains(normalized)
}

fun threadsForProject(threads: List<ThreadRecord>, project: Project?): List<ThreadRecord> {
    if (project == null) {
        return emptyList()
    }
    return threads.filter { it.projectPath == project.path }
}
