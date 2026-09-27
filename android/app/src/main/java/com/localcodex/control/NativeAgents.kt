package com.localcodex.control

fun nativeAgent(model:String):String=model.substringBefore("::","codex")
fun nativeThreadAgent(id:String):String=id.substringBefore('-').takeIf{it in listOf("claude","antigravity","grok")}?:"codex"
fun nativeAgentName(agent:String):String=when(agent){"claude"->"Claude Code";"antigravity"->"Antigravity";"grok"->"Grok Build";else->"Codex"}
