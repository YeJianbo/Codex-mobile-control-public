package com.localcodex.control
import org.junit.Test
import org.junit.Assert.assertEquals
class NativeMathTest {
    @Test fun convertsSupportedDelimitersAndPreservesCode(){
        assertEquals("公式 \$\$x^2\$\$",nativeMathMarkdown("公式 \$x^2\$"))
        assertEquals("\$\$x+y\$\$",nativeMathMarkdown("\\(x+y\\)"))
        assertEquals("\n\$\$\nx+y\n\$\$\n",nativeMathMarkdown("\\[x+y\\]"))
        assertEquals("`\$x\$`\n```tex\n\$x\$\n```",nativeMathMarkdown("`\$x\$`\n```tex\n\$x\$\n```"))
        assertEquals("\$\$x\$\$",nativeMathMarkdown("\$\$x\$\$"))
    }
}
