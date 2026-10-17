package com.localcodex.control

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.material.MaterialTheme
import androidx.compose.material.Text
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.junit.*
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class NativeDrawerMotionTest{
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()
    @Test fun pushedChatReversesContinuouslyAndKeepsAnimationOutOfContentComposition(){
        lateinit var drawer:NativeDrawerState
        lateinit var scope:CoroutineScope
        val compositions=AtomicInteger()
        val hiddenClicks=AtomicInteger()
        ui.mainClock.autoAdvance=false
        ui.setContent{
            drawer=rememberNativeDrawerState();scope=rememberCoroutineScope()
            MaterialTheme{NativeAdaptiveDrawer(false,false,drawer,true,Color(0xffeeeeee),Color.White,32.dp,Color.Black.copy(alpha=.06f),
                drawerContent={Box(Modifier.fillMaxSize().clickable{hiddenClicks.incrementAndGet()}){Text("会话列表")}}){compositions.incrementAndGet();Box(Modifier.fillMaxSize().testTag("motionContent")){Text("聊天内容")}}}
        }
        fun left()=ui.onNodeWithTag("drawerChat",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot.left
        ui.waitForIdle()
        fun cornerIsRounded()=ui.onNodeWithTag("drawerChat",useUnmergedTree=true).captureToImage().toPixelMap()[1,1].red<.97f
        Assert.assertTrue("未滑动时卡片就应有圆角",cornerIsRounded())
        ui.onNodeWithTag("drawerChat").performTouchInput{click(center)}
        ui.onNodeWithTag("drawerChat").performTouchInput{click(Offset(2f,2f))}
        Assert.assertEquals("关闭时不能点到被遮住的会话",0,hiddenClicks.get())
        val baseline=compositions.get()
        ui.runOnUiThread{scope.launch{drawer.open()}}
        ui.waitForIdle()
        ui.mainClock.advanceTimeBy(16);ui.waitForIdle()
        Assert.assertTrue("滑动第一帧应保留完整圆角",cornerIsRounded())
        ui.mainClock.advanceTimeBy(96);ui.waitForIdle()
        val midway=left()
        Assert.assertTrue(midway>0f)
        ui.runOnUiThread{scope.launch{drawer.close()}}
        ui.waitForIdle()
        ui.mainClock.advanceTimeBy(160);ui.waitForIdle()
        Assert.assertTrue("反向关闭应从当前位置收回",left()<midway)
        ui.mainClock.advanceTimeBy(800);ui.waitForIdle()
        Assert.assertEquals(0f,left(),1f)
        Assert.assertTrue("动画帧不应重复重组聊天正文",compositions.get()<=baseline+2)
        ui.runOnUiThread{scope.launch{drawer.open()}}
        ui.mainClock.advanceTimeBy(800);ui.waitForIdle()
        Assert.assertTrue(drawer.isOpen)
        ui.onNodeWithTag("drawerDismiss").performClick()
        ui.mainClock.advanceTimeBy(800);ui.waitForIdle()
        Assert.assertFalse(drawer.isOpen)
        ui.onNodeWithTag("drawerChat").performTouchInput{swipeRight()}
        ui.mainClock.advanceTimeBy(800);ui.waitForIdle()
        Assert.assertTrue("横向拖动应能打开侧栏",drawer.isOpen)
        ui.onNodeWithTag("drawerSidebar").performTouchInput{swipeLeft()}
        ui.mainClock.advanceTimeBy(800);ui.waitForIdle()
        Assert.assertFalse("反向拖动应能收起侧栏",drawer.isOpen)
        ui.runOnUiThread{scope.launch{drawer.open()}}
        ui.mainClock.advanceTimeBy(96);ui.waitForIdle()
        Assert.assertTrue(drawer.isAnimating)
        ui.onNodeWithTag("drawerChat").performTouchInput{down(Offset(4f,center.y))}
        ui.mainClock.advanceTimeBy(16);ui.waitForIdle()
        val grabbed=drawer.progress
        ui.mainClock.advanceTimeBy(96);ui.waitForIdle()
        Assert.assertEquals("手指按下就应接管正在进行的动画",grabbed,drawer.progress,.001f)
        ui.onNodeWithTag("drawerChat").performTouchInput{moveBy(Offset(-5f,0f));up()}
        ui.mainClock.advanceTimeBy(800);ui.waitForIdle()
        Assert.assertFalse(drawer.isAnimating)
        if(drawer.isOpen){ui.onNodeWithTag("drawerDismiss").performClick();ui.mainClock.advanceTimeBy(800);ui.waitForIdle()}
        ui.onNodeWithTag("drawerChat").performTouchInput{swipeRight()}
        ui.mainClock.advanceTimeBy(800);ui.waitForIdle()
        Assert.assertTrue("接管动画后后续拖动协程仍应可用",drawer.isOpen)
    }
}
