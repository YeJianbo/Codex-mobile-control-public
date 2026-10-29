package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/**
 * 0.6.476／0.6.477：聊天额度提醒使用液态玻璃采样，并且同时显示 5 小时与 7 天两个窗口。
 *
 * 玻璃是否真的模糊由 NativeGlassRenderingTest 用像素验证；这里验证接线本身：
 * 提醒必须与消息列表共用同一份聊天采样、关闭后释放，轻量与标准主题不采样。
 */
class NativeQuotaNoticeGlassTest {
    @get:Rule val ui = createAndroidComposeRule<ComponentActivity>()

    private val notice = ModelServiceNotice("quota-low", "额度剩余不多", "7 天 剩余 8%。预计稍后重置。", quotaSnapshot = true)
    // 0.6.477：5h 与 7d 同时低额时两个窗口都要出现。
    private val dualNotice = quotaWindowNotice(listOf(
        NativeQuotaWindow("Codex", 300, 7.0, 2_000),
        NativeQuotaWindow("Codex", 10080, 8.0, 3_000),
    ), 1_000)!!

    private inner class Fixture(start: NativeGlassMode = NativeGlassMode.LIQUID, val shown: ModelServiceNotice = notice) {
        val mode = mutableStateOf(start)
        val dark = mutableStateOf(false)
        val scene = mutableStateOf(Color.Red)
        val visible = mutableStateOf(true)
        val sceneBackdrop = AtomicReference<NativeGlassBackdrop?>()
        val composerBackdrop = AtomicReference<NativeGlassBackdrop?>()
        var view: android.view.View? = null
    }

    private fun render(f: Fixture) {
        ui.setContent {
            val definition = when (f.mode.value) {
                NativeGlassMode.LIQUID -> NativeBuiltinThemes.liquid
                NativeGlassMode.LIGHT -> NativeBuiltinThemes.lightweight
                else -> NativeBuiltinThemes.standard
            }
            val theme = definition.resolve(f.dark.value)
            NativeThemeProvider(theme, theme.palette.material(f.dark.value)) {
                CompositionLocalProvider(
                    LocalNativeGlassMode provides f.mode.value,
                    LocalNativeFloatingChrome provides f.mode.value.floatingChrome,
                ) {
                    val view = LocalView.current
                    SideEffect { f.view = view }
                    Column(Modifier.fillMaxSize().background(theme.palette.chat)) {
                        NativeConversationBody(
                            f.mode.value.floatingChrome,
                            header = { Box(Modifier.fillMaxWidth().height(56.dp)) { Text("会话") } },
                            messages = { _, _ ->
                                val scene = LocalNativeScrollBackdrop.current
                                SideEffect { f.sceneBackdrop.set(scene) }
                                Column(Modifier.fillMaxSize().background(f.scene.value)) {
                                    repeat(24) { Text("第 $it 条消息", Modifier.fillMaxWidth().height(64.dp)) }
                                }
                            },
                            composer = {
                                val dock = LocalNativeGlassBackdrop.current
                                SideEffect { f.composerBackdrop.set(dock) }
                                if (f.visible.value) ModelServiceNoticeBanner(f.shown) { f.visible.value = false }
                                Box(Modifier.fillMaxWidth().height(72.dp).testTag("composerStand").background(theme.palette.surface))
                            },
                        )
                    }
                }
            }
        }
        ui.waitForIdle()
    }

    private fun capture(f: Fixture, label: String) {
        ui.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val ready = android.os.SystemClock.uptimeMillis() + 300
        ui.waitUntil(2000) { android.os.SystemClock.uptimeMillis() >= ready }
        val bitmap = instrumentation.uiAutomation.takeScreenshot() ?: return
        try {
            File(instrumentation.targetContext.getExternalFilesDir(null),
                "quota477-${f.mode.value.stored}-${if (f.dark.value) "dark" else "light"}-$label.png").outputStream().use {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
            }
        } finally {
            bitmap.recycle()
        }
    }

    @Test
    fun liquidNoticeSharesTheChatSampleAndReleasesItWhenDismissed() {
        val f = Fixture()
        render(f)
        ui.onNodeWithTag("modelServiceNotice").assertIsDisplayed()
        ui.onNodeWithText("额度剩余不多").assertIsDisplayed()
        ui.waitUntil(10000) { f.composerBackdrop.get() != null && f.sceneBackdrop.get() != null }
        assertSame("额度提醒必须采样消息列表登记的同一份聊天画面", f.sceneBackdrop.get(), f.composerBackdrop.get())
        val source = f.sceneBackdrop.get()!!
        ui.waitUntil(10000) { source.frame > 0 && source.consumers > 0 }
        capture(f, "liquid-light")

        // 浅色与深色液态玻璃都要挂着采样，不因主题变暗而退化成普通底色。
        ui.runOnUiThread { f.dark.value = true }
        ui.waitForIdle()
        ui.onNodeWithTag("modelServiceNotice").assertIsDisplayed()
        ui.waitUntil(10000) { source.consumers > 0 && source.frame > 0 }
        capture(f, "liquid-dark")

        ui.runOnUiThread { f.dark.value = false }
        ui.waitForIdle()
        ui.onNodeWithContentDescription("关闭模型提醒", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
        ui.waitUntil(10000) { source.consumers == 0 && source.frame == 0 }
        assertTrue("关闭额度提醒后必须释放保留的聊天采样", source.consumers == 0 && source.frame == 0)
        File(ui.activity.filesDir, "quota477-notice-glass-probe.json").writeText(
            JSONObject().put("sharedBackdrop", true).put("consumersReleased", true)
                .put("message", notice.message).toString(2))
    }

    @Test
    fun lightweightAndStandardNoticesKeepTheirOwnBacking() {
        val probe = JSONObject()
        val f = Fixture(NativeGlassMode.LIGHT)
        // setContent 每个测试只能调用一次，主题通过状态切换重组。
        render(f)
        for (style in listOf(NativeGlassMode.LIGHT, NativeGlassMode.OFF)) {
            f.composerBackdrop.set(null)
            f.sceneBackdrop.set(null)
            ui.runOnUiThread { f.mode.value = style }
            ui.waitForIdle()
            ui.onNodeWithTag("modelServiceNotice").assertIsDisplayed()
            // 不采样：提醒只有自己的半透明底色，不接入聊天玻璃链路。
            assertNull("${style.title} 不允许接聊天画面采样", f.composerBackdrop.get())
            capture(f, "${style.stored}-light")
            probe.put(style.stored, JSONObject().put("samples", false))
        }
        ui.onNodeWithContentDescription("关闭模型提醒", useUnmergedTree = true).performClick()
        ui.onNodeWithTag("modelServiceNotice").assertDoesNotExist()
        File(ui.activity.filesDir, "quota477-notice-flat-probe.json").writeText(probe.toString(2))
    }

    @Test
    fun bothQuotaWindowsAreVisibleInTheFloatingNotice() {
        val f = Fixture(NativeGlassMode.LIQUID, dualNotice)
        render(f)
        ui.onNodeWithTag("modelServiceNotice").assertIsDisplayed()
        ui.onNodeWithText("5 小时额度 剩余 7%", substring = true).assertIsDisplayed()
        ui.onNodeWithText("7 天额度 剩余 8%", substring = true).assertIsDisplayed()
        assertTrue(dualNotice.message.contains("5 小时额度") && dualNotice.message.contains("7 天额度"))
        capture(f, "dual-window")
        File(ui.activity.filesDir, "quota477-dual-window-probe.json").writeText(
            JSONObject().put("message", dualNotice.message).put("title", dualNotice.title)
                .put("kind", dualNotice.kind).toString(2))
    }
}
