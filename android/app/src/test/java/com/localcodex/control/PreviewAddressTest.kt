package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class PreviewAddressTest {
    @Test
    fun blankAddressReturnsError() {
        assertTrue(normalizePreviewAddress("").error.isNotBlank())
    }

    @Test
    fun bareLocalhostGetsHttpScheme() {
        assertEquals("http://localhost:5173", normalizePreviewAddress("localhost:5173").url)
    }

    @Test
    fun bareLoopbackWithPathGetsHttpScheme() {
        assertEquals("http://127.0.0.1:5173/app", normalizePreviewAddress("127.0.0.1:5173/app").url)
    }

    @Test
    fun explicitHttpAddressIsKept() {
        assertEquals("http://localhost:5173", normalizePreviewAddress("http://localhost:5173").url)
    }

    @Test
    fun nonLocalAddressIsRejected() {
        assertTrue(normalizePreviewAddress("192.168.31.76:5173").error.isNotBlank())
    }
}
