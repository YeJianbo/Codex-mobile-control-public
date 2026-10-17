package com.localcodex.control

import org.json.JSONObject
import java.util.Locale

internal class LocalConsoleRequestException(val status:Int,message:String):IllegalStateException(message)

data class ConsoleModel(val id:String,val name:String,val context:Long?,val official:Boolean,val enabled:Boolean,val isDefault:Boolean)
data class ConsoleCatalog(val running:Boolean,val automatic:Boolean,val intervalHours:Double?,val lastChecked:String,val lastUpdated:String,val changed:Boolean,val added:List<String>,val error:String)
data class ConsoleService(val requests:Long?,val errors:Long?,val activeRequests:Long?,val startedAt:String,val memoryMB:Long?)
data class ConsoleInfo(val version:String,val updatedAt:String,val model:String,val provider:String,val owned:Boolean,val nativeCatalog:Boolean,val relayOnly:Boolean,val catalog:ConsoleCatalog,val models:List<ConsoleModel>,val service:ConsoleService,val modelError:String)
data class ConsoleTokens(val input:Long?,val cached:Long?,val cacheWrite:Long?,val output:Long?,val reasoning:Long?,val total:Long?,val records:Long?)
data class ConsoleCost(val usd:Double?,val basis:String,val priceDate:String,val unpricedRecords:Long?,val partialRecords:Long?,val actualUsd:Double?=null,val estimatedUsd:Double?=null,val includedRecords:Long?=null)
data class ConsoleActivity(val minutes:Long?,val days:Long?,val sessions:Long?,val newSessions:Long?,val toolCalls:Long?)
data class ConsoleModelUsage(val id:String,val tokens:ConsoleTokens,val usd:Double?,val provider:String="",val includedRecords:Long?=null,val actualUsd:Double?=null,val estimatedUsd:Double?=null,val unpricedRecords:Long?=null)
data class ConsoleDay(val date:String,val total:Long,val input:Long,val output:Long,val records:Long,val activeMinutes:Long?)
data class ConsoleModelPoint(val date:String,val hour:String,val model:String,val total:Long,val records:Long)
data class ConsoleTool(val name:String,val count:Long)
data class ConsoleStatistics(val source:String,val range:String,val updatedAt:String,val since:Long?,val until:Long?,val tokens:ConsoleTokens,val cost:ConsoleCost,val activity:ConsoleActivity?,val models:List<ConsoleModelUsage>,val series:List<ConsoleDay>,val tools:List<ConsoleTool>,val indexing:Boolean,val indexError:String,val available:Boolean,val historyOnly:Boolean,val activityOnlySessions:Long?,val periodBasis:String="",val skippedFiles:Long?=null,val modelSeries:List<ConsoleModelPoint> = emptyList())
data class LocalConsoleUiState(
    val source:String="codex",val range:String="week",val pricing:String="codex",
    val info:ConsoleInfo?=null,val statistics:ConsoleStatistics?=null,
    val infoLoading:Boolean=false,val statisticsLoading:Boolean=false,
    val infoError:String="",val statisticsError:String="",val busyAction:String="",val actionMessage:String=""
)

private fun JSONObject.consoleText(key:String)=if(isNull(key))"" else optString(key)
private fun JSONObject.consoleNumber(key:String):Double?=if(isNull(key))null else optDouble(key,Double.NaN).takeIf{it.isFinite()&&it>=0}
private fun JSONObject.consoleLong(key:String)=consoleNumber(key)?.toLong()
private fun JSONObject.consoleRows(key:String):List<JSONObject>{val array=optJSONArray(key)?:return emptyList();return (0 until array.length()).mapNotNull{array.optJSONObject(it)}}
private fun consoleTokens(row:JSONObject)=ConsoleTokens(row.consoleLong("input"),row.consoleLong("cached"),row.consoleLong("cacheWrite"),row.consoleLong("output"),row.consoleLong("reasoning"),row.consoleLong("total"),row.consoleLong("records"))

internal fun parseConsoleInfo(row:JSONObject):ConsoleInfo {
    val config=row.optJSONObject("config")?:JSONObject();val catalog=row.optJSONObject("catalog")?:JSONObject();val service=row.optJSONObject("service")?:JSONObject()
    val added=catalog.optJSONArray("added")
    return ConsoleInfo(row.consoleText("version"),row.consoleText("updatedAt"),config.consoleText("model"),config.consoleText("provider"),config.optBoolean("owned"),config.optBoolean("nativeCatalog"),config.optBoolean("relayOnly"),
        ConsoleCatalog(catalog.optBoolean("running"),catalog.optBoolean("automatic"),catalog.consoleNumber("intervalHours"),catalog.consoleText("lastChecked"),catalog.consoleText("lastUpdated"),catalog.optBoolean("changed"),(0 until (added?.length()?:0)).map{added!!.optString(it)},catalog.consoleText("error")),
        row.consoleRows("models").map{ConsoleModel(it.consoleText("id"),it.consoleText("name"),it.consoleLong("context"),it.optBoolean("official"),it.optBoolean("enabled"),it.optBoolean("isDefault"))},
        ConsoleService(service.consoleLong("requests"),service.consoleLong("errors"),service.consoleLong("activeRequests"),service.consoleText("startedAt"),service.consoleLong("memoryMB")),row.consoleText("modelError"))
}
internal fun parseConsoleStatistics(row:JSONObject):ConsoleStatistics {
    val cost=row.optJSONObject("cost")?:JSONObject();val activity=row.optJSONObject("activity");val index=row.optJSONObject("index")?:JSONObject();val coverage=row.optJSONObject("coverage")?:JSONObject()
    return ConsoleStatistics(row.consoleText("source"),row.consoleText("range"),row.consoleText("updatedAt"),row.consoleLong("since"),row.consoleLong("until"),consoleTokens(row.optJSONObject("totals")?:JSONObject()),
        ConsoleCost(cost.consoleNumber("usd"),cost.consoleText("basis"),cost.consoleText("priceDate"),cost.consoleLong("unpricedRecords"),cost.consoleLong("partialRecords"),cost.consoleNumber("actualUsd"),cost.consoleNumber("estimatedUsd"),cost.consoleLong("includedRecords")),
        activity?.let{ConsoleActivity(it.consoleLong("minutes"),it.consoleLong("days"),it.consoleLong("sessions"),it.consoleLong("newSessions"),it.consoleLong("toolCalls"))},
        row.consoleRows("models").map{ConsoleModelUsage(it.consoleText("id"),consoleTokens(it),it.consoleNumber("usd"),it.consoleText("provider"),it.consoleLong("includedRecords"),it.consoleNumber("actualUsd"),it.consoleNumber("estimatedUsd"),it.consoleLong("unpricedRecords"))},
        row.consoleRows("series").map{ConsoleDay(it.consoleText("date"),it.consoleLong("total")?:0,it.consoleLong("input")?:0,it.consoleLong("output")?:0,it.consoleLong("records")?:0,it.consoleLong("activeMinutes"))},
        row.consoleRows("tools").map{ConsoleTool(it.consoleText("name"),it.consoleLong("count")?:0)},index.optBoolean("running"),index.consoleText("error"),coverage.optBoolean("available",true),coverage.optBoolean("historyOnly"),coverage.consoleLong("activityOnlySessions"),coverage.consoleText("periodBasis"),coverage.consoleLong("skippedFiles"),
        row.consoleRows("modelSeries").map{ConsoleModelPoint(it.consoleText("date"),it.consoleText("hour"),it.consoleText("model"),it.consoleLong("total")?:0,it.consoleLong("records")?:0)})
}

internal fun consoleDefaultAllowed(info:ConsoleInfo,model:ConsoleModel)=model.enabled&&!model.isDefault&&
    (if(info.relayOnly)!model.official else info.owned||info.nativeCatalog&&model.official)
internal fun consoleMoney(value:Double?)=value?.let{if(it>0&&it<0.000001)"<$0.000001" else String.format(Locale.US,if(it>0&&it<0.01)"$%.6f" else "$%.2f",it)}?:"—"
internal fun consoleCount(value:Long?)=value?.let{nativeTokenCount(it)}?:"—"
