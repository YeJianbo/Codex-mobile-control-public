package com.localcodex.control

private val nativeOwnModelBrands=mapOf("codex" to "gpt","claude" to "claude","antigravity" to "gemini","grok" to "grok","deepseek" to "deepseek","hermes" to "hermes")
private val nativeModelBrandPrefix=Regex("^(gpt|claude|gemini|grok|deepseek|qwen)(?=[-\\s]|\\d|[vr]\\d)",RegexOption.IGNORE_CASE)
private val nativeModelFamilyPrefix=Regex("^(opus|sonnet|haiku|hermes|llama|kimi|glm|mistral)(?=[-\\s]|\\d|$)",RegexOption.IGNORE_CASE)
private val nativeModelWords=Regex("\\b(gpt|claude|gemini|grok|deepseek|qwen|astra|sol|luna|codex|spark|pro|mini|nano|turbo|opus|sonnet|haiku|flash|next|thinking|chat|coder|free|preview|instruct|hermes|llama|kimi|mistral)\\b",RegexOption.IGNORE_CASE)
private val nativeModelWhitespace=Regex("\\s+")
private val nativeModelContextSuffix=Regex("(?<=\\S)\\[")
private val nativeModelWordLabels=mapOf("gpt" to "GPT","deepseek" to "DeepSeek")

internal fun nativeModelDisplayName(model:NativeModel):String {
    val raw=model.id.substringAfter("::")
    var label=model.shortName.ifBlank{model.name}.ifBlank{raw}.trim()
    label=label.removePrefix(nativeAgentName(model.harness)+" · ")
    for(provider in listOf(model.providerName,nativeModelProviderId(model)).filter{it.isNotBlank()}.distinct()){
        for(separator in listOf(" / ","/",": "," · ")){
            val prefix=provider+separator
            if(label.startsWith(prefix,true))label=label.substring(prefix.length).trim()
        }
    }
    return nativeCompactModelName(label,model.harness)
}

// Formatting never changes the model ID or infers its execution route.
internal fun nativeCompactModelName(label:String,harness:String=""):String {
    val namespace=label.substringBefore("::")
    var name=if(label.contains("::")&&namespace in nativeHarnesses)label.substringAfter("::").trim() else label.trim()
    val brand=nativeModelBrandPrefix.find(name)
    if(brand==null&&!nativeModelFamilyPrefix.containsMatchIn(name))return name
    if(brand!=null&&brand.groupValues[1].lowercase()==nativeOwnModelBrands[harness])name=name.substring(brand.value.length).trimStart('-',' ')
    return nativeModelWhitespace.replace(name.replace('-',' ')," ").let{short->
        nativeModelContextSuffix.replace(nativeModelWords.replace(short){nativeModelWordLabels[it.value.lowercase()]?:it.value.lowercase().replaceFirstChar(Char::uppercaseChar)}," [")
    }
}
