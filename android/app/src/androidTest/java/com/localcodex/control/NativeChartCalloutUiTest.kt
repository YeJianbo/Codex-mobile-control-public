package com.localcodex.control

import android.graphics.Bitmap
import android.view.inspector.WindowInspector
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.ScrollState
import androidx.compose.material.Text
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

class NativeChartCalloutUiTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun heldTooltipClearsTheFingerAtChartEdgesAndReleasesForScrolling(){
        val data=parseConsoleStatistics(JSONObject().put("source","codex").put("range","month")).copy(
            modelSeries=listOf(100L,20L,100L).mapIndexed{day,total->
                ConsoleModelPoint("2025-01-0${day+1}","","模型 A",total,1)
            })
        ui.setContent{MaterialTheme{Column(Modifier.width(320.dp).verticalScroll(rememberScrollState())){
            Spacer(Modifier.height(180.dp))
            ConsoleModelTrend(data)
            Spacer(Modifier.height(1000.dp))
        }}}
        val chart=ui.onNodeWithTag("consoleDailyChart")
        val initial=chart.fetchSemanticsNode().boundsInWindow
        val density=ui.activity.resources.displayMetrics.density
        for((x,y) in listOf(.03f to .03f,.5f to .5f,.97f to .97f)){
            var finger=Offset.Zero
            chart.performTouchInput{finger=Offset(width*x,height*y);down(finger);advanceEventTime(200)}
            ui.waitUntil(2000){ui.onAllNodesWithTag("chartCallout").fetchSemanticsNodes().isNotEmpty()}
            ui.onNodeWithTag("chartCallout").assertIsDisplayed()
            val popupBounds=ui.onNodeWithTag("chartCallout").fetchSemanticsNode().boundsInWindow
            val popupOrigin=IntArray(2)
            val activityOrigin=IntArray(2)
            ui.runOnIdle{
                WindowInspector.getGlobalWindowViews().single{it.javaClass.simpleName=="PopupLayout"}.getLocationOnScreen(popupOrigin)
                ui.activity.window.decorView.getLocationOnScreen(activityOrigin)
            }
            val popupBottom=popupBounds.bottom+popupOrigin[1]
            val fingerY=initial.top+finger.y+activityOrigin[1]
            println("callout touch=($x,$y) bottom=$popupBottom fingerY=$fingerY clearance=${fingerY-popupBottom}")
            assertTrue("Tooltip must stay above the fingertip with room for the finger",popupBottom<=fingerY-44*density)
            assertTrue("Tooltip must stay inside the screen",popupBounds.left+popupOrigin[0]>=0)
            assertTrue("Tooltip must stay inside the screen",popupBounds.right+popupOrigin[0]<=ui.activity.resources.displayMetrics.widthPixels)
            assertEquals("Holding the chart must not shift the content",initial,chart.fetchSemanticsNode().boundsInWindow)
            if(x==.5f){
                chart.performTouchInput{moveTo(Offset(width*.8f,height*.5f))}
                ui.onNodeWithText("2025-01-03").assertIsDisplayed()
                saveScreen("chart452-held")
            }
            chart.performTouchInput{up()}
            ui.onNodeWithTag("chartCallout").assertDoesNotExist()
        }
        chart.performTouchInput{down(center);moveBy(Offset(0f,-90*density))}
        ui.onNodeWithTag("chartCallout").assertDoesNotExist()
        chart.performTouchInput{up()}
        assertTrue("Vertical dragging must scroll the page",chart.fetchSemanticsNode().boundsInWindow.top<initial.top)
    }

    @Test fun topEdgeCalloutFitsBesideTheFingerIncludingLargeText(){
        val touch=mutableStateOf(Offset.Zero)
        val pressed=mutableStateOf(false)
        val scale=mutableStateOf(1f)
        ui.setContent{MaterialTheme{
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density,scale.value)){
                Box(Modifier.fillMaxWidth().height(180.dp).testTag("edgeChart")
                    .nativeChartPress(Unit,{position,_->touch.value=position;pressed.value=true},{pressed.value=false})){
                    if(pressed.value)ChartCallout(touch){Column(Modifier.padding(horizontal=10.dp,vertical=8.dp)){
                        Text("2026-10-18 09:02",fontSize=10.sp)
                        Text("7d 额度 · 剩余 94%",fontSize=12.sp)
                    }}
                }
            }
        }}
        val chart=ui.onNodeWithTag("edgeChart")
        val density=ui.activity.resources.displayMetrics.density
        for(font in listOf(1f,1.6f)){
            ui.runOnIdle{scale.value=font}
            for(x in listOf(.5f,.03f,.97f)){
                var finger=Offset.Zero
                val bounds=chart.fetchSemanticsNode().boundsInWindow
                chart.performTouchInput{finger=Offset(width*x,height*.02f);down(finger);advanceEventTime(200)}
                ui.waitUntil(2000){ui.onAllNodesWithTag("chartCallout").fetchSemanticsNodes().isNotEmpty()}
                val bubble=ui.onNodeWithTag("chartCallout").assertIsDisplayed().fetchSemanticsNode().boundsInWindow
                val popupOrigin=IntArray(2);val origin=IntArray(2)
                ui.runOnIdle{
                    WindowInspector.getGlobalWindowViews().single{it.javaClass.simpleName=="PopupLayout"}.getLocationOnScreen(popupOrigin)
                    ui.activity.window.decorView.getLocationOnScreen(origin)
                }
                val fingerX=bounds.left+finger.x+origin[0];val fingerY=bounds.top+finger.y+origin[1]
                val left=bubble.left+popupOrigin[0];val right=bubble.right+popupOrigin[0];val bottom=bubble.bottom+popupOrigin[1]
                println("edge453 font=$font x=$x bounds=[$left,${bubble.top+popupOrigin[1]},$right,$bottom] finger=[$fingerX,$fingerY]")
                assertTrue("The callout must clear the finger above or beside it",bottom<=fingerY-44*density||right<=fingerX-44*density||left>=fingerX+44*density)
                assertTrue("The callout must remain inside the window",left>=0&&right<=ui.activity.resources.displayMetrics.widthPixels&&bubble.top+popupOrigin[1]>=0&&bottom<=ui.activity.resources.displayMetrics.heightPixels)
                ui.onNodeWithText("7d 额度 · 剩余 94%").assertIsDisplayed()
                if(x==.5f)saveScreen("chart453-top-$font",ui.onNodeWithTag("chartCallout"))
                chart.performTouchInput{up()}
                ui.onNodeWithTag("chartCallout").assertDoesNotExist()
            }
        }
    }

    @Test fun verticalScrollPublishesNoSelectionButHorizontalDragStartsImmediately(){
        val positions=AtomicInteger()
        val scroll=ScrollState(0)
        ui.setContent{MaterialTheme{Column(Modifier.fillMaxSize().verticalScroll(scroll)){
            Box(Modifier.fillMaxWidth().height(180.dp).testTag("intentChart")
                .nativeChartPress(Unit,{_,_->positions.incrementAndGet()},{ }))
            Spacer(Modifier.height(1000.dp))
        }}}
        val chart=ui.onNodeWithTag("intentChart")
        chart.performTouchInput{down(center);moveBy(Offset(0f,-height*.3f));up()}
        ui.runOnIdle{
            assertEquals("A vertical scroll must never briefly publish chart selection",0,positions.get())
            assertTrue("The parent must still scroll",scroll.value>0)
        }
        chart.performScrollTo().performTouchInput{down(center);moveBy(Offset(width*.2f,0f))}
        ui.runOnIdle{assertTrue("Horizontal dragging must not wait for the hold delay",positions.get()>0)}
        chart.performTouchInput{up()}
    }

    @Test fun horizontalDragKeepsOwnershipAcrossVerticalDriftAndChartEdges(){
        val scroll=ScrollState(0)
        val positions=mutableListOf<Offset>()
        val releases=AtomicInteger()
        ui.setContent{MaterialTheme{Column(Modifier.fillMaxSize().verticalScroll(scroll)){
            Spacer(Modifier.height(80.dp))
            Box(Modifier.fillMaxWidth().height(180.dp).testTag("lockedChart")
                .nativeChartPress(Unit,{position,_->positions.add(position)},{releases.incrementAndGet()}))
            Spacer(Modifier.height(1000.dp))
        }}}
        val chart=ui.onNodeWithTag("lockedChart")
        val chartWidth=chart.fetchSemanticsNode().size.width.toFloat()
        chart.performTouchInput{
            down(Offset(width*.2f,height*.8f))
            moveTo(Offset(width*.3f,height*.8f))
            moveTo(Offset(width*.4f,height*.1f))
            moveTo(Offset(width*.6f,-height*.05f))
            moveTo(Offset(width+20f,-height*.05f))
        }
        ui.runOnIdle{
            assertEquals("Crossing the plot boundary must not clear the selection",0,releases.get())
            assertEquals("A confirmed horizontal drag must not move the page",0,scroll.value)
            assertTrue("The selection must keep moving forward with the finger",positions.zipWithNext().all{(a,b)->b.x>=a.x})
            assertEquals(chartWidth,positions.last().x,.1f)
            assertEquals(0f,positions.last().y,.1f)
        }
        chart.performTouchInput{up()}
        ui.runOnIdle{assertEquals("Release must clear selection once",1,releases.get())}
    }

    @Test fun quotaDragUsesHorizontalTimeAndKeepsTheInitiallySelectedCurve(){
        val points=listOf(QuotaPoint(2000,300,90f),QuotaPoint(4000,300,10f),QuotaPoint(6000,300,95f),
            QuotaPoint(2000,10080,30f),QuotaPoint(4000,10080,30f),QuotaPoint(6000,10080,30f))
        ui.setContent{MaterialTheme{Column(Modifier.fillMaxWidth().padding(top=160.dp)){QuotaTrendChart(points,0,10000,1)}}}
        val chart=ui.onNodeWithTag("quota-trend")
        chart.performTouchInput{down(Offset(width*.2f,height*.05f));advanceEventTime(200)}
        ui.waitUntil(2000){ui.onAllNodesWithTag("quotaSelection").fetchSemanticsNodes().isNotEmpty()}
        ui.onNodeWithText("5h 额度 · 剩余 90%").assertIsDisplayed()
        chart.performTouchInput{moveTo(Offset(width*.6f,height*.95f))}
        ui.onNodeWithText("5h 额度 · 剩余 95%").assertIsDisplayed()
        chart.performTouchInput{up()}
        ui.onNodeWithTag("quotaSelection").assertDoesNotExist()
    }

    @Test fun tokenOverviewSeparatesMetadataAndKeepsItsHeightDuringRefresh(){
        val data=parseConsoleStatistics(JSONObject().put("source","codex").put("range","week")
            .put("since",1791734400000L).put("until",1792252800000L)
            .put("totals",JSONObject().put("total",6090000000L).put("input",6070000000L)
                .put("output",21976000L).put("cached",5910000000L).put("reasoning",8806000L).put("records",35000)))
        val fontScale=mutableStateOf(1f)
        val loading=mutableStateOf(false)
        ui.setContent{MaterialTheme{
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density,fontScale.value)){
                Column(Modifier.width(320.dp).verticalScroll(rememberScrollState())){
                    ConsoleStatisticsContent(LocalConsoleUiState(statistics=data,statisticsLoading=loading.value),true,{_,_,_->},{_,_,_->})
                }
            }
        }}
        for(scale in listOf(1f,1.4f)){
            ui.runOnIdle{fontScale.value=scale;loading.value=false}
            ui.onNodeWithTag("consoleOverview").performScrollTo()
            saveScreen("chart452-summary-$scale",ui.onNodeWithTag("consoleOverview"))
            for(text in listOf("Token 总量","60.9亿","3.5万 条计量记录")){
                val layouts=mutableListOf<TextLayoutResult>()
                ui.onNodeWithText(text,useUnmergedTree=true).performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(layouts)}
                val layout=layouts.single()
                println("summary font=$scale text=$text size=${layout.size} paragraph=${layout.multiParagraph.width}x${layout.multiParagraph.height} overflow=${layout.hasVisualOverflow}")
                // A wrapped Text can retain the parent's paragraph width even
                // though the shaped line and the Text node are much narrower.
                // Check visible line edges, allowing whole-pixel size rounding.
                repeat(layout.lineCount){line->
                    assertTrue("Summary text width must fit at fontScale=$scale: $text",layout.getLineRight(line)<=layout.size.width+1f)
                    assertTrue("Summary text left edge must fit at fontScale=$scale: $text",layout.getLineLeft(line)>=-1f)
                    assertTrue("Summary text height must fit at fontScale=$scale: $text",layout.getLineBottom(line)<=layout.size.height+1f)
                }
                assertFalse(layout.multiParagraph.didExceedMaxLines)
            }
            val title=ui.onNodeWithText("Token 总量",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
            val total=ui.onNodeWithText("60.9亿",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
            val records=ui.onNodeWithText("3.5万 条计量记录",useUnmergedTree=true).fetchSemanticsNode().boundsInRoot
            assertTrue(title.bottom<=total.top)
            assertTrue(total.bottom<records.top)
            val height=ui.onNodeWithTag("consoleOverview").fetchSemanticsNode().size.height
            ui.runOnIdle{loading.value=true}
            assertEquals("Refreshing must not resize the summary",height,ui.onNodeWithTag("consoleOverview").fetchSemanticsNode().size.height)
            ui.onNodeWithText("正在读取…",useUnmergedTree=true).assertExists()
        }
    }

    private fun saveScreen(name:String,node:SemanticsNodeInteraction?=null){
        val bitmap=node?.captureToImage()?.asAndroidBitmap()
            ?:InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        java.io.File(ui.activity.getExternalFilesDir(null),"$name.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
        bitmap.recycle()
    }
}
