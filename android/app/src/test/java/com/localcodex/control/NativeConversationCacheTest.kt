package com.localcodex.control
import org.junit.Assert.*
import org.junit.Test

class NativeConversationCacheTest{
    private fun snapshot(text:String)=NativeConversationSnapshot(listOf(ChatEvent(type="message.delta",text=text)),20,true,"gpt-6-astra")
    @Test fun leastRecentlyViewedConversationIsEvicted(){
        val cache=NativeConversationCache(maxEntries=2);val a=snapshot("A");cache.put("a",a);cache.put("b",snapshot("B"));assertSame(a,cache.get("a"));cache.put("c",snapshot("C"));assertNull(cache.get("b"));assertEquals(2,cache.size);assertEquals(20,cache.get("a")?.turns)
    }
    @Test fun capacityIsBoundedAndOversizedPagesAreNotAdmitted(){
        val cache=NativeConversationCache(maxEntries=8,maxBytes=6000);repeat(10){cache.put("$it",snapshot("x".repeat(700)))};assertTrue(cache.bytes<=6000);assertTrue(cache.size<8);cache.put("large",snapshot("x".repeat(10000)));assertNull(cache.get("large"));assertTrue(cache.bytes<=6000)
    }
    @Test fun serverChangeClearsRetainedSnapshotsAndTheirBudget(){val cache=NativeConversationCache();cache.put("serverA|t",snapshot("A"));cache.clear();assertNull(cache.get("serverA|t"));assertEquals(0L,cache.bytes);assertEquals(0,cache.size)}
}
