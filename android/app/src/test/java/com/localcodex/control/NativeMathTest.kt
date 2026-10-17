package com.localcodex.control
import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
class NativeMathTest {
    @Test fun conversionsOnEitherSideOfCodePreserveTheUntouchedText(){
        val code="`\$literal\$`"
        assertEquals("前文 $code 后文 \$\$x\$\$",nativeMathMarkdown("前文 $code 后文 \$x\$"))
        assertEquals("\$\$x\$\$ 后文 $code",nativeMathMarkdown("\$x\$ 后文 $code"))
    }
    @Test fun unchangedLongProseAndLiteralCodeKeepTheirOriginalText(){
        val prose="普通长回复，无需转换。\n".repeat(2000)
        assertSame(prose,nativeMathMarkdown(prose))
        val code="`\$x\$`\n```tex\n\\(x+y\\)\n```"
        assertSame(code,nativeMathMarkdown(code))
        val escaped="转义的 \\\$x，不是公式"
        assertSame(escaped,nativeMathMarkdown(escaped))
    }
    @Test fun convertsSupportedDelimitersAndPreservesCode(){
        assertEquals("公式 \$\$x^2\$\$",nativeMathMarkdown("公式 \$x^2\$"))
        assertEquals("\$\$x+y\$\$",nativeMathMarkdown("\\(x+y\\)"))
        assertEquals("\n\$\$\nx+y\n\$\$\n",nativeMathMarkdown("\\[x+y\\]"))
        assertEquals("`\$x\$`\n```tex\n\$x\$\n```",nativeMathMarkdown("`\$x\$`\n```tex\n\$x\$\n```"))
        assertEquals("\$\$x\$\$",nativeMathMarkdown("\$\$x\$\$"))
    }
}
