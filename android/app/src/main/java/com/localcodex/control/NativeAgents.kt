package com.localcodex.control

fun nativeAgent(model:String):String=model.substringBefore("::","codex").takeIf{it in nativeHarnesses}?:"codex"
internal val nativeHarnesses=listOf("codex","claude","antigravity","grok","deepseek","hermes","opencode")
fun nativeModelCatalogOrDefaults(models:List<NativeModel>):List<NativeModel> = models.ifEmpty {
    nativeHarnesses.map { agent ->
        NativeModel(if(agent=="codex")"" else "$agent::default","默认模型",emptyList(),"",available=false,unavailableReason="尚未获取模型目录，请重新检查连接")
    }
}
fun nativeThreadAgent(id:String):String=id.substringBefore('-').takeIf{it in nativeHarnesses}?:"codex"
fun nativeAgentName(agent:String):String=when(agent){"claude"->"Claude Code";"antigravity"->"Antigravity";"grok"->"Grok Build";"deepseek"->"DeepSeek Harness";"hermes"->"Hermes";"opencode"->"OpenCode";else->"Codex"}

internal fun nativeModelProviderId(model:NativeModel):String=model.providerId.ifBlank{
    if(model.harness=="opencode")model.id.substringAfter("::").substringBefore('/',"") else ""
}
internal fun nativeModelRouteHints(models:List<NativeModel>):Map<String,String> = models
    .distinctBy{it.id}.groupBy{Triple(it.harness,nativeModelProviderId(it),nativeModelDisplayName(it).lowercase())}
    .values.filter{it.size>1}.flatMap{rows->rows.map{it.id to it.id.substringAfter("::").substringAfterLast('/')}}.toMap()
internal data class NativeModelGroup(val id:String,val name:String,val models:List<NativeModel>)
internal fun nativeModelGroups(models:List<NativeModel>):List<NativeModelGroup>{
    if(models.none{it.harness=="opencode"})return if(models.isEmpty())emptyList() else listOf(NativeModelGroup("","",models))
    return models.groupBy{nativeModelProviderId(it)}.map{(provider,rows)->
        val legacyName=rows.firstOrNull()?.takeIf{it.id.substringAfter("::").contains('/')}?.name?.substringAfter(" · ")?.takeIf{it.contains('/')}?.substringBefore('/')
        NativeModelGroup(provider,rows.firstNotNullOfOrNull{it.providerName.takeIf{it.isNotBlank()}}?:legacyName?:provider.ifBlank{"默认模型"},rows)
    }
}
internal fun nativeOpenCodeSelection(models:List<NativeModel>,preferred:String,previous:List<NativeModel> = emptyList()):NativeModel? {
    if(!preferred.startsWith("opencode::"))return models.firstOrNull{it.id=="opencode::default"&&it.available}
    return models.find{it.id==preferred}?: (previous.find{it.id==preferred}?:NativeModel(preferred,preferred.substringAfter("::"),emptyList(),"",shortName=preferred.substringAfter("::").substringAfter('/')))
        .copy(available=false,unavailableReason="所选 OpenCode 模型已不在当前可用目录，请重新选择")
}
internal fun nativeModelsWithSelection(models:List<NativeModel>,selected:NativeModel?):List<NativeModel> =
    if(selected!=null&&selected.id.startsWith("opencode::")&&models.none{it.id==selected.id})models+selected else models
internal fun nativeModelSelectionError(agent:String,id:String,models:List<NativeModel>):String = when{
    agent!="opencode"->""
    id.isBlank()->"请选择 OpenCode 模型"
    models.any{it.id==id&&it.available}->""
    else->models.find{it.id==id}?.unavailableReason?.takeIf{it.isNotBlank()}?:"所选 OpenCode 模型已不在当前可用目录，请重新选择"
}

internal fun nativeReadOnlyThreadId(id:String)=id.startsWith("cloud-snapshot:")||id.startsWith("cloud:")
internal fun nativeTaskDefaultEffort(id:String,fallback:String)=if(id.contains("astra"))"medium" else if(id.contains("sol"))"high" else fallback

private val nativeEffortOrder=listOf("default","__default","off","none","minimal","low","medium","high","xhigh","max","ultra")
internal fun nativeOrderedEfforts(efforts:List<String>)=efforts.distinct().sortedBy{nativeEffortOrder.indexOf(it).takeIf{rank->rank>=0}?:Int.MAX_VALUE}

internal fun nativeBackendAvailable(agent:String,models:List<NativeModel>,backends:List<NativeBackend>):Boolean=
    backends.find{it.agent==agent}?.available?:models.any{it.harness==agent&&it.available}
internal fun nativeBackendReason(agent:String,models:List<NativeModel>,backends:List<NativeBackend>):String=
    backends.find{it.agent==agent}?.reason?.takeIf{it.isNotBlank()}?:models.find{it.harness==agent&&!it.available}?.unavailableReason?.takeIf{it.isNotBlank()}?:if(nativeBackendAvailable(agent,models,backends))"" else "未检测到可用 CLI"
internal fun nativePlanAvailable(agent:String,backends:List<NativeBackend>):Boolean=
    backends.find{it.agent==agent}?.supportsPlanMode?: (agent in setOf("codex","claude","antigravity"))
internal fun nativeSnapshotStatus(status:String)=when(status){"running"->"进行中";"completed"->"已完成";"error"->"错误";"interrupted"->"已中断";else->"未知"}
