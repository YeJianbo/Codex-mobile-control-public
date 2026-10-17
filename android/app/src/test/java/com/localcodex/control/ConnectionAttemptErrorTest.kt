package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class ConnectionAttemptErrorTest {
    @Test fun missingPublicConfigurationExplainsWhyFallbackIsSkipped() {
        assertTrue(connectionAttemptError("timeout",false,"","").contains("尚未填写公网地址"))
        assertTrue(connectionAttemptError("timeout",false,"https://example.com","").contains("请填写公网独立密码"))
    }
    @Test fun failureIdentifiesTheAttemptWithoutExposingCredentials() {
        val message=connectionAttemptError("timeout",true,"https://example.com","private-password")
        assertEquals("公网连接失败：timeout",message)
        assertFalse(message.contains("private-password"))
        assertTrue(connectionAttemptError("timeout",false,"https://example.com","private-password").contains("正在尝试公网"))
    }
}
