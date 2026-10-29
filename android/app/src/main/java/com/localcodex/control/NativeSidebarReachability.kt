package com.localcodex.control

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** The list gives downward overscroll to this region; upward drags restore it first. */
@Stable
internal class NativeSidebarReachabilityState(private val distance: Float) {
    var offset by mutableFloatStateOf(0f)
        private set
    private var motion: Job? = null
    private var dragged = false
    private var expanded = false

    fun dragBy(delta: Float): Float {
        if (delta == 0f || delta < 0f && offset == 0f) return 0f
        motion?.cancel()
        motion = null
        dragged = true
        val previous = offset
        offset = (previous + delta * if (delta > 0f) .72f else 1f).coerceIn(0f, distance)
        // Consume the pull rather than letting the list stretch a second time.
        return if (delta > 0f) delta else offset - previous
    }

    fun settle(scope: CoroutineScope, velocity: Float, velocityThreshold: Float): Boolean {
        if (!dragged) return false
        dragged = false
        // Stay down after release so the user can actually tap the header.
        // Separate thresholds prevent tiny movements from toggling the resting state.
        expanded = when {
            velocity < -velocityThreshold -> false
            velocity > velocityThreshold -> true
            else -> offset >= distance * if (expanded) .7f else .3f
        }
        motion?.cancel()
        motion = scope.launch {
            Animatable(offset).animateTo(
                if (expanded) distance else 0f,
                spring(dampingRatio = 1f, stiffness = 420f),
                initialVelocity = velocity.coerceIn(-velocityThreshold, velocityThreshold)
            ) { offset = value.coerceIn(0f, distance) }
        }
        return true
    }

    fun reset() {
        motion?.cancel()
        motion = null
        dragged = false
        expanded = false
        offset = 0f
    }
}

@Composable
internal fun NativeSidebarReachability(
    enabled: Boolean,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    BoxWithConstraints(modifier.clipToBounds()) {
        // Leave room for both header rows and a useful list, including short windows.
        val distance = with(density) {
            (maxHeight * .36f).coerceAtMost(240.dp)
                .coerceAtMost((maxHeight - 200.dp).coerceAtLeast(0.dp)).toPx()
        }
        val velocityThreshold = with(density) { 900.dp.toPx() }
        val state = remember(distance) { NativeSidebarReachabilityState(distance) }
        DisposableEffect(state) { onDispose { state.reset() } }
        LaunchedEffect(enabled, state) { if (!enabled) state.reset() }
        val connection = remember(state, enabled, velocityThreshold) {
            object : NestedScrollConnection {
                override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                    if (!enabled || distance <= 0f || source != NestedScrollSource.UserInput || available.y >= 0f) return Offset.Zero
                    return Offset(0f, state.dragBy(available.y))
                }

                override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                    if (!enabled || distance <= 0f || source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
                    return Offset(0f, state.dragBy(available.y))
                }

                override suspend fun onPreFling(available: Velocity): Velocity =
                    if (enabled && state.settle(scope, available.y, velocityThreshold)) Velocity(0f, available.y) else Velocity.Zero
            }
        }
        Column(Modifier.fillMaxSize().nestedScroll(connection).layout { measurable, constraints ->
            // Read the animation in measurement, keeping the sidebar content out of
            // per-frame composition. Reduce the viewport instead of covering its last rows.
            val top = state.offset.roundToInt().coerceIn(0, constraints.maxHeight)
            val height = constraints.maxHeight - top
            val child = measurable.measure(constraints.copy(minHeight = height, maxHeight = height))
            layout(constraints.maxWidth, constraints.maxHeight) { child.placeRelative(0, top) }
        }, content = content)
    }
}
