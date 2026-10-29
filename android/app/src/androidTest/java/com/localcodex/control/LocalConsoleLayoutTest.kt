package com.localcodex.control

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.material.MaterialTheme
import androidx.compose.material.darkColors
import androidx.compose.material.lightColors
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.*
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.*
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocalConsoleLayoutTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    private fun show(days:Int,dark:Boolean,fontScale:Float):ConsoleStatistics{
        val today=java.time.LocalDate.now()
        val weights=List(days){index->if(index%7==0)0L else 10000L+index*350}
        val weightTotal=weights.sum()
        val activeDays=weights.count{it>0}
        var cumulativeWeight=0L
        var previousTotal=0L
        var activeIndex=0
        val rows=JSONArray().apply{weights.forEachIndexed{index,weight->
            cumulativeWeight+=weight
            val total=cumulativeWeight*50000000/weightTotal
            val records=if(weight==0L)0 else 320/activeDays+(if(activeIndex++<320%activeDays)1 else 0)
            put(JSONObject().put("date",today.minusDays((days-index-1).toLong()).toString()).put("total",total-previousTotal).put("records",records))
            previousTotal=total
        }}
        val model=JSONObject().put("id","gpt-6-astra-2026-09-30-high-context-preview").put("input",30000000).put("output",7600000).put("total",37600000).put("records",240).put("usd",280.0)
        val second=JSONObject().put("id","gpt-6-sol").put("input",10000000).put("output",2400000).put("total",12400000).put("records",80).put("usd",79.99)
        val data=JSONObject().put("source","codex").put("range",if(days>31)"year" else "month").put("updatedAt",java.time.Instant.now().toString())
            .put("since",today.minusDays((days-1).toLong()).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli()).put("until",System.currentTimeMillis())
            .put("totals",JSONObject().put("input",40000000).put("cached",24000000).put("output",10000000).put("reasoning",5000000).put("total",50000000).put("records",320))
            .put("cost",JSONObject().put("usd",359.99).put("priceDate",today.toString()))
            .put("models",JSONArray().put(second).put(model)).put("series",rows)
        val statistics=parseConsoleStatistics(data)
        val state=LocalConsoleUiState(range=if(days>31)"year" else "month",statistics=statistics)
        ui.setContent{
            val colors=if(dark)darkColors(primary=AppColor.DarkPrimary,background=AppColor.DarkBackground,surface=AppColor.DarkSurface,onSurface=AppColor.DarkOnSurface) else lightColors(primary=AppColor.LightPrimary,background=AppColor.LightBackground,surface=AppColor.LightSurface,onSurface=AppColor.LightOnSurface)
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density,fontScale)){
                MaterialTheme(colors=colors){LocalConsoleContent(state,true,{},{},{_,_,_->},{_,_,_->})}
            }
        }
        return statistics
    }

    @Test fun monthCardsAndModelNamesStayReadableWithLargeFont(){
        val statistics=show(30,false,1.3f)
        ui.onNodeWithTag("consoleOverview").assertIsDisplayed()
        ui.onNodeWithText("Token 总量").assertIsDisplayed()
        ui.onNodeWithText("320 条计量记录").assertExists()
        screenshot("native-console-overview-118.png")
        ui.onNodeWithTag("consoleScroll").performScrollToNode(hasTestTag("consoleTrend"))
        ui.onNodeWithTag("consoleDailyChart").performTouchInput{click(center)}
        val selectedDay=statistics.series[15]
        ui.onNodeWithText("${selectedDay.date} · ${consoleCount(selectedDay.total)} Token · ${consoleCount(selectedDay.records)} 条记录").assertExists()
        screenshot("native-console-trend-118.png")
        ui.onNodeWithTag("consoleScroll").performScrollToNode(hasTestTag("consoleModelUsage"))
        val model=ui.onNodeWithText("gpt-6-astra-2026-09-30-high-context-preview").fetchSemanticsNode().boundsInRoot
        val value=ui.onNodeWithText("3.8千万").fetchSemanticsNode().boundsInRoot
        Assert.assertTrue("模型名称不能与数值重叠",model.right<=value.left)
        ui.onNodeWithText("75.2%").assertExists()
        screenshot("native-console-model-usage-118.png")
    }

    @Test fun yearChartAndOverviewRenderInDarkModeWithLargerFont(){
        show(365,true,1.5f)
        ui.onNodeWithText("Token 总量").assertIsDisplayed()
        ui.onNodeWithText("320 条计量记录").assertExists()
        screenshot("native-console-dark-overview-118.png")
        ui.onNodeWithTag("consoleScroll").performScrollToNode(hasTestTag("consoleDailyChart"))
        ui.onNodeWithTag("consoleDailyChart").assertIsDisplayed().performTouchInput{click(center)}
        screenshot("native-console-dark-trend-118.png")
    }

    private fun screenshot(name:String){
        ui.waitForIdle()
        android.os.SystemClock.sleep(500)
        // UiAutomation can return null while the emulator compositor changes surfaces.
        // Capture the tested Compose root instead; retain all layout assertions above.
        val image=ui.onNodeWithTag("consoleScroll").captureToImage().asAndroidBitmap()
        val context=ApplicationProvider.getApplicationContext<Application>()
        java.io.File(context.getExternalFilesDir(null),name).outputStream().use{image.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)}
    }
}
