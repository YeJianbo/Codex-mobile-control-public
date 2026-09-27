package com.localcodex.control

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativePairLinkTest {
    @Test fun scannerReadsComputerAddressAndCertificate() {
        val certificate="A".repeat(64)
        val link=parseNativePairLink(
            "codex-control://pair?baseUrl=https%3A%2F%2F192.168.1.8%3A38457&code=ABC123&certSha256=$certificate&publicUrl=https%3A%2F%2Fphone.example.test"
        )
        assertNotNull(link)
        assertEquals("https://192.168.1.8:38457",link!!.address)
        assertEquals("ABC123",link.code)
        assertEquals(certificate,link.certificateSha256)
        assertEquals("https://phone.example.test",link.publicUrl)
    }

    @Test fun scannerRejectsUntrustedOrIncompleteCode() {
        assertNull(parseNativePairLink("https://example.com"))
        assertNull(parseNativePairLink("codex-control://pair?baseUrl=http%3A%2F%2F192.168.1.8&code=ABC123&certSha256=${"A".repeat(64)}"))
        assertNull(parseNativePairLink("codex-control://pair?baseUrl=https%3A%2F%2F192.168.1.8&code=ABC123"))
    }
}
