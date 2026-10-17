package com.localcodex.control

internal enum class ModelServiceIssue { QUOTA, CAPACITY }

data class ModelServiceNotice(val kind:String,val title:String,val message:String,val threadId:String="",val quotaSnapshot:Boolean=false)

internal fun modelServiceIssue(message:String):ModelServiceIssue? {
    val text=message.lowercase()
    return when {
        Regex("usage[_ -]limit[_ -](reached|exceeded)|insufficient[_ -]quota|quota[_ -](exceeded|exhausted)|exceeded.{0,30}(quota|usage limit)|hit.{0,30}usage limit|usage limit.{0,30}(reached|exceeded)|额度.{0,12}(用完|耗尽|不足)|配额.{0,12}(耗尽|不足|超出)").containsMatchIn(text)->ModelServiceIssue.QUOTA
        Regex("no capacity available|capacity.{0,30}(exhausted|unavailable)|insufficient capacity|overloaded[_ -]error|model.{0,30}overloaded|容量.{0,12}(不足|耗尽)|模型.{0,12}繁忙").containsMatchIn(text)->ModelServiceIssue.CAPACITY
        else->null
    }
}

internal fun modelServiceNotice(issue:ModelServiceIssue,threadId:String="",resetAt:Long?=null)=when(issue){
    ModelServiceIssue.QUOTA->ModelServiceNotice("quota","额度已用完",resetAt?.takeIf{it>0}?.let{
        "预计 "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(java.util.Date(it*1000))+" 恢复，请稍后再试。"
    }?:"请等待额度恢复，或切换到有可用额度的助手后再试。",threadId)
    ModelServiceIssue.CAPACITY->ModelServiceNotice("capacity","模型暂时没有可用容量","请稍后重试，或切换其他模型。",threadId)
}

internal data class NativeQuotaWindow(val name:String,val durationMins:Long,val remainingPercent:Double?,val resetsAt:Long?)

internal const val LOW_QUOTA_PERCENT=10.0

internal fun quotaWindowNotice(windows:List<NativeQuotaWindow>,nowSeconds:Long):ModelServiceNotice? {
    val low=windows.filter{it.remainingPercent?.let{value->value.isFinite()&&value<=LOW_QUOTA_PERCENT}==true&&(it.resetsAt==null||it.resetsAt>nowSeconds)}
    if(low.isEmpty())return null
    val exhausted=low.filter{it.remainingPercent!!<=0}
    if(exhausted.isNotEmpty())return modelServiceNotice(ModelServiceIssue.QUOTA,resetAt=exhausted.mapNotNull{it.resetsAt}.maxOrNull()).copy(quotaSnapshot=true)
    val tightest=low.minBy{it.remainingPercent!!}
    val window=when{
        tightest.durationMins>=1440&&tightest.durationMins%1440==0L->"${tightest.durationMins/1440} 天额度"
        tightest.durationMins>=60&&tightest.durationMins%60==0L->"${tightest.durationMins/60} 小时额度"
        tightest.durationMins>0->"${tightest.durationMins} 分钟额度"
        else->"账号额度"
    }
    val remaining=java.text.DecimalFormat("0.#").format(tightest.remainingPercent)
    val reset=tightest.resetsAt?.let{"预计 "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(java.util.Date(it*1000))+" 恢复。"}.orEmpty()
    return ModelServiceNotice("quota-low","额度剩余不多","$window 剩余 $remaining%。$reset",quotaSnapshot=true)
}

/** 同一轮的重复错误只提醒一次；历史回放不触发提醒。 */
internal class ModelServiceNoticeTracker {
    private val rounds=linkedMapOf<String,MutableSet<ModelServiceIssue>>()
    private val seen=linkedSetOf<String>()
    private val quotaWarnings=mutableMapOf<String,Set<String>>()

    fun accept(event:ChatEvent):ModelServiceNotice? {
        if(event.replayed)return null
        if(event.eventId.isNotBlank()&&!seen.add(event.eventId))return null
        if(seen.size>400)seen.remove(seen.first())
        val thread=event.threadId.ifBlank{event.requestId}
        if(event.type in setOf("turn.started","user.message")||(event.type=="thread.started"&&event.status=="running"))rounds.remove(thread)
        if(event.type!="error")return null
        val issue=modelServiceIssue(event.text+"\n"+event.detail)?:return null
        val kinds=rounds.getOrPut(thread){mutableSetOf()}
        if(rounds.size>100)rounds.remove(rounds.keys.first())
        return if(kinds.add(issue))modelServiceNotice(issue,event.threadId) else null
    }

    fun quota(harness:String,windows:List<NativeQuotaWindow>,stale:Boolean,nowSeconds:Long):ModelServiceNotice? {
        if(stale||windows.isEmpty())return null
        val known=windows.filter{it.remainingPercent?.isFinite()==true}
        if(known.isEmpty())return null
        val low=known.filter{it.remainingPercent!!<=LOW_QUOTA_PERCENT&&(it.resetsAt==null||it.resetsAt>nowSeconds)}
        val keys=low.map{"${it.name}:${it.durationMins}:${it.resetsAt}:${if(it.remainingPercent!!<=0)"empty" else "low"}"}.toSet()
        val previous=quotaWarnings[harness].orEmpty()
        val unknown=windows.filter{it.remainingPercent?.isFinite()!=true}.map{"${it.name}:${it.durationMins}:"}
        quotaWarnings[harness]=keys+previous.filter{key->unknown.any{key.startsWith(it)}}
        return if((keys-previous).isNotEmpty())quotaWindowNotice(windows,nowSeconds) else null
    }
}
