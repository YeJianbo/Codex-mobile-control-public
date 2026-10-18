package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeModelIdentityTest {
    @Test fun onlyTheHarnessOwnBrandIsAbbreviated(){
        assertEquals("6.1 Sol",nativeModelDisplayName(NativeModel("gpt-6.1-sol","GPT-6.1-Sol",emptyList(),"")))
        assertEquals("Grok 4.6",nativeModelDisplayName(NativeModel("claude::grok-4.6","Claude Code · grok-4.6",emptyList(),"")))
        assertEquals("DeepSeek v4.1 Flash",nativeModelDisplayName(NativeModel("opencode::openrouter/deepseek-v4.1-flash","OpenCode · openrouter/deepseek-v4.1-flash",emptyList(),"",providerId="openrouter")))
        assertEquals("Claude Opus 4.8",nativeCompactModelName("claude-opus-4.8"))
        assertEquals("team/route::custom · model",nativeCompactModelName("team/route::custom · model"))
    }

    @Test fun relayProviderIsNotAHarness(){
        assertEquals("codex",nativeAgent("relay::gpt-6.1-sol"))
        assertEquals("claude",nativeAgent("claude::grok-4.6"))
        val model=NativeModel("relay::gpt-6.1-sol","GPT-6.1-Sol",emptyList(),"",harness="codex")
        assertEquals("6.1 Sol",nativeModelDisplayName(model))
        assertTrue(nativeBackendAvailable("codex",listOf(model),emptyList()))
    }

    @Test fun unknownCatalogDoesNotInventCapabilities(){
        val models=nativeModelCatalogOrDefaults(emptyList())
        assertTrue(models.all{!it.available&&it.efforts.isEmpty()&&it.defaultEffort.isEmpty()})
        assertFalse(nativeBackendAvailable("claude",models,emptyList()))
    }
}
