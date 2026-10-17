package com.localcodex.control

import android.os.Looper
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.MaterialTheme
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicBoolean

class NativeTrendInteractionProfileTest {
    @get:Rule val ui=createAndroidComposeRule<ComponentActivity>()

    @Test fun dataFocusAndSizeChangesRefreshTheCurve(){
        val initial=parseConsoleStatistics(JSONObject().put("source","codex").put("range","month")).copy(
            modelSeries=listOf(100L,20L,100L).flatMapIndexed{day,total->listOf(
                ConsoleModelPoint("2025-01-0${day+1}","","刷新模型 A",total,1),
                ConsoleModelPoint("2025-01-0${day+1}","","刷新模型 B",60,1),
            )})
        val data=mutableStateOf(initial)
        val width=mutableStateOf(300.dp)
        ui.setContent{MaterialTheme{Column(Modifier.width(width.value)){ConsoleModelTrend(data.value)}}}
        val chart=ui.onNodeWithTag("consoleDailyChart")
        val original=chart.captureToImage().asAndroidBitmap()
        ui.runOnIdle{data.value=initial.copy(modelSeries=initial.modelSeries.map{if(it.model=="刷新模型 A")it.copy(total=120-it.total) else it})}
        val refreshed=chart.captureToImage().asAndroidBitmap()
        assertFalse("New data must redraw the curve",original.sameAs(refreshed))
        chart.performTouchInput{down(center)}
        ui.onNodeWithText("2025-01-02").assertIsDisplayed()
        ui.onNode(hasText("100") and hasAnyAncestor(hasTestTag("chartCallout"))).assertIsDisplayed()
        chart.performTouchInput{up()}
        ui.onNodeWithText("2025-01-02").assertDoesNotExist()
        ui.onNodeWithText("刷新模型 A").performClick()
        val focused=chart.captureToImage().asAndroidBitmap()
        assertFalse("Model focus must update the curve styling",refreshed.sameAs(focused))
        ui.runOnIdle{width.value=240.dp}
        val resized=chart.captureToImage().asAndroidBitmap()
        assertTrue("Width change must resize the drawing",resized.width<focused.width)
        chart.performTouchInput{down(center)}
        ui.onNodeWithText("2025-01-02").assertIsDisplayed()
        ui.onNode(hasText("100") and hasAnyAncestor(hasTestTag("chartCallout"))).assertIsDisplayed()
        chart.performTouchInput{up()}
        ui.onNodeWithText("2025-01-02").assertDoesNotExist()
    }

    @Test fun profileAnnualCurveDragging(){
        val args=InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("profile")=="trend")
        val first=LocalDate.of(2025,1,1)
        val points=JSONArray()
        repeat(24){model->repeat(365){day->
            points.put(JSONObject().put("date",first.plusDays(day.toLong()).toString()).put("model","曲线模型 $model")
                .put("total",1000L+model*37+(day*73L)%10000).put("records",1))
        }}
        val data=parseConsoleStatistics(JSONObject().put("source","all").put("range","year").put("modelSeries",points))
        ui.setContent{MaterialTheme{Column(Modifier.verticalScroll(rememberScrollState())){ConsoleModelTrend(data)}}}
        val chart=ui.onNodeWithTag("consoleDailyChart")
        chart.performScrollTo()
        ui.waitForIdle()
        val stacks=CopyOnWriteArrayList<List<String>>()
        val sampling=AtomicBoolean(true)
        val main=Looper.getMainLooper().thread
        val sampler=Thread({while(sampling.get()){
            stacks.add(main.stackTrace.map{it.className+"."+it.methodName})
            Thread.sleep(2)
        }},"trend-drag-sample")
        sampler.start()
        try{
            chart.performTouchInput{down(Offset(width*.25f,centerY))}
            ui.onNodeWithText(first.plusDays(91).toString()).assertIsDisplayed()
            repeat(30){index->
                chart.performTouchInput{moveTo(Offset(width*(.25f+.5f*(index+1)/30),centerY))}
                ui.waitForIdle()
            }
            ui.onNodeWithText(first.plusDays(273).toString()).assertIsDisplayed()
            chart.performTouchInput{up()}
            ui.onNodeWithText(first.plusDays(273).toString()).assertDoesNotExist()
        }finally{
            sampling.set(false);sampler.join()
        }
        val bitmap=chart.captureToImage().asAndroidBitmap()
        val reference=java.io.File(ui.activity.getExternalFilesDir(null),"trend-chart-before.png")
        java.io.File(ui.activity.getExternalFilesDir(null),"trend-chart-${args.getString("phase")}.png").outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)}
        if(args.getString("phase")=="after"){
            assertTrue("Cached paths must preserve the chart rendering",bitmap.sameAs(BitmapFactory.decodeFile(reference.path)))
        }
        val result=JSONObject().put("phase",args.getString("phase")).put("models",24).put("days",365).put("moves",30)
            .put("samples",stacks.size).put("cubicToSamples",stacks.count{stack->stack.any{it.endsWith(".cubicTo")}})
            .put("trendSamples",stacks.count{stack->stack.any{it.contains("LocalConsoleTrendKt")}})
            .put("pathStacks",JSONArray(stacks.filter{stack->stack.any{it.endsWith(".cubicTo")}}.distinct().take(5).map{JSONArray(it)}))
        java.io.File(ui.activity.getExternalFilesDir(null),"trend-${args.getString("phase")}.json").writeText(result.toString())
    }
}
