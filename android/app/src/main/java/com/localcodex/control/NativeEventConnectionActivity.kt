package com.localcodex.control

/** Only frames received by this connection can justify keeping it on foreground return. */
internal class NativeEventConnectionActivity(private val now:()->Long) {
    private var owner:Any?=null
    private var receivedAt:Long?=null

    @Synchronized fun begin(connection:Any){owner=connection;receivedAt=null}
    @Synchronized fun received(connection:Any){if(owner===connection)receivedAt=now()}
    @Synchronized fun close(connection:Any){if(owner===connection){owner=null;receivedAt=null}}
    @Synchronized fun hasRecentTraffic(maxAgeMillis:Long):Boolean {
        val at=receivedAt?:return false
        return owner!=null&&now()-at in 0..maxAgeMillis
    }
}
