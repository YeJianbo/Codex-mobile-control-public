package com.localcodex.control

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import okhttp3.Request
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import javax.security.auth.x500.X500Principal

object DeviceCertificate {
    private const val alias="codex-control-device"

    private fun keyStore():KeyStore=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
    fun certificateBase64():String {
        var store=keyStore()
        if(!store.containsAlias(alias)){
            val generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC,"AndroidKeyStore")
            generator.initialize(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setCertificateSubject(X500Principal("CN=Codex Control Android"))
                .build())
            generator.generateKeyPair()
            store=keyStore()
        }
        return Base64.encodeToString(store.getCertificate(alias).encoded,Base64.NO_WRAP)
    }

    fun sign(request:Request):Request {
        certificateBase64()
        val time=System.currentTimeMillis().toString()
        val nonce=UUID.randomUUID().toString()
        val target=request.url.encodedPath+request.url.encodedQuery?.let{"?$it"}.orEmpty()
        val message="${request.method.uppercase()}\n$target\n$time\n$nonce"
        val privateKey=keyStore().getKey(alias,null) as java.security.PrivateKey
        val signature=Signature.getInstance("SHA256withECDSA").apply{initSign(privateKey);update(message.toByteArray(Charsets.UTF_8))}.sign()
        return request.newBuilder().header("X-Device-Time",time).header("X-Device-Nonce",nonce)
            .header("X-Device-Signature",Base64.encodeToString(signature,Base64.NO_WRAP)).build()
    }
}
