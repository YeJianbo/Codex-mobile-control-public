package com.localcodex.control

internal data class NativeCommand(val name:String,val description:String)
internal val nativeCommands=listOf(
    NativeCommand("help","查看命令和使用说明"),
    NativeCommand("status","查看当前会话、目录、模型和连接"),
    NativeCommand("usage","查看本会话用量与上下文"),
    NativeCommand("model","选择模型和思考强度"),
    NativeCommand("effort","直接调整思考强度"),
    NativeCommand("permissions","调整会话权限"),
    NativeCommand("new","新建会话，沿用当前项目"),
    NativeCommand("compact","压缩当前会话上下文"),
    NativeCommand("goal","设置或编辑当前会话目标"),
    NativeCommand("pin","置顶或取消置顶当前会话"),
    NativeCommand("plan","下一条消息使用计划模式"),
    NativeCommand("fast","切换快速模式，可能增加用量")
)
internal fun nativeCommandMatches(draft:String):List<NativeCommand> {
    if(!draft.startsWith('/')||draft.any{it.isWhitespace()})return emptyList()
    return nativeCommands.filter{it.name.startsWith(draft.drop(1),ignoreCase=true)}
}
internal fun nativeExactCommand(draft:String)=nativeCommands.firstOrNull{"/${it.name}"==draft.trim().lowercase()}
private val goalWithObjective=Regex("^/goal\\s+([\\s\\S]+)$",RegexOption.IGNORE_CASE)
internal fun nativeGoalObjective(draft:String):String?=goalWithObjective.matchEntire(draft.trim())?.groupValues?.get(1)?.trim()?.takeIf{it.isNotEmpty()}
