package com.localcodex.control

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeDisplayFormatTest {
    @Test fun showsWindowsDriveAndShareWithoutExtendedPrefix() {
        assertEquals("F:\\Code\\v2board", nativeDisplayPath("\\\\?\\F:\\Code\\v2board"))
        assertEquals("\\\\server\\share", nativeDisplayPath("\\\\?\\UNC\\server\\share"))
        assertEquals("F:\\Code\\v2board", nativeDisplayPath("F:\\Code\\v2board"))
    }

    @Test fun keepsTokenCountsReadableAtUsageScale() {
        assertEquals("1200", nativeTokenCount(1_200))
        assertEquals("10.5万", nativeTokenCount(104_757))
        assertEquals("25.8万", nativeTokenCount(258_400))
        assertEquals("123.5万", nativeTokenCount(1_234_567))
        assertEquals("3760万", nativeTokenCount(37_600_000))
        assertEquals("17.2亿", nativeTokenCount(1_716_876_430))
    }
    @Test fun contextAlwaysUsesThousands(){
        assertEquals("0K",nativeContextCount(0))
        assertEquals("0.001K",nativeContextCount(1))
        assertEquals("30.9K",nativeContextCount(30_920))
        assertEquals("380K",nativeContextCount(380_000))
        assertEquals("1000K",nativeContextCount(1_000_000))
    }
    @Test fun commandTitlesHideTheLauncherPathButKeepDescriptiveNames(){
        assertEquals("运行命令",nativeToolTitle("\"C:\\Users\\user\\.cache\\runtime\\pwsh.exe\" -Command Get-Content file"))
        assertEquals("检查连接",nativeToolTitle("检查连接"))
    }
}
