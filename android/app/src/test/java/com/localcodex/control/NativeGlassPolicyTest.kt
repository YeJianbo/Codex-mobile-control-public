package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeGlassPolicyTest {
    @Test fun selectionOnlyFallsBackWhenPlatformCannotRenderBlur(){
        assertEquals(NativeGlassMode.LIGHT,NativeGlassMode.from("soft"))
        assertEquals(NativeGlassMode.LIGHT,nativeGlassPolicy(NativeGlassMode.from("soft"),false))
    }
    @Test fun standardAppearanceAndSavedSelectionRemainReversible(){
        for(mode in NativeGlassMode.entries)assertEquals(mode,NativeGlassMode.from(mode.stored))
        assertEquals(NativeGlassMode.OFF,NativeGlassMode.from(null))
        assertEquals(NativeGlassMode.OFF,NativeGlassMode.from("unknown"))
        assertEquals(NativeGlassMode.OFF,nativeGlassPolicy(NativeGlassMode.OFF,false))
        assertEquals(NativeGlassMode.LIGHT,nativeGlassPolicy(NativeGlassMode.LIGHT,true))
        assertEquals(NativeGlassMode.LIQUID,nativeGlassPolicy(NativeGlassMode.LIQUID,true))
        assertEquals(NativeGlassMode.LIGHT,nativeGlassPolicy(NativeGlassMode.LIQUID,false))
    }
}
