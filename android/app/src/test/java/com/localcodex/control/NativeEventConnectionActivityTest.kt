package com.localcodex.control

import org.junit.Assert.*
import org.junit.Test

class NativeEventConnectionActivityTest {
    @Test fun onlyAnInboundFrameMakesAConnectionRecentAndSilenceExpires(){
        var now=100L;val activity=NativeEventConnectionActivity{now};val connection=Any()
        activity.begin(connection);assertFalse(activity.hasRecentTraffic(20000))
        activity.received(connection);assertTrue(activity.hasRecentTraffic(20000))
        now+=20000;assertTrue(activity.hasRecentTraffic(20000))
        now++;assertFalse(activity.hasRecentTraffic(20000))
        activity.received(connection);assertTrue(activity.hasRecentTraffic(20000))
    }

    @Test fun replacedConnectionsCannotRefreshOrClearTheirSuccessor(){
        var now=100L;val activity=NativeEventConnectionActivity{now};val old=Any();val next=Any()
        activity.begin(old);activity.received(old)
        activity.begin(next);assertFalse(activity.hasRecentTraffic(20000))
        activity.received(old);assertFalse(activity.hasRecentTraffic(20000))
        activity.received(next);activity.close(old);assertTrue(activity.hasRecentTraffic(20000))
        now+=20001;activity.received(old);assertFalse(activity.hasRecentTraffic(20000))
    }

    @Test fun closedConnectionAndBackwardTimeCannotKeepAnOldSocketRecent(){
        var now=100L;val activity=NativeEventConnectionActivity{now};val connection=Any()
        activity.begin(connection);activity.received(connection);now--
        assertFalse(activity.hasRecentTraffic(20000))
        now=101;assertTrue(activity.hasRecentTraffic(20000))
        activity.close(connection);activity.received(connection);assertFalse(activity.hasRecentTraffic(20000))
    }
}
