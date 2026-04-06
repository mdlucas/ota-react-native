package com.reactnativeota

import android.content.Context
import android.content.Intent
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import okhttp3.OkHttpClient
import okhttp3.Request

class NativeOtaModule(reactContext: ReactApplicationContext) :
    NativeOtaSpec(reactContext) {

  private val client = OkHttpClient()

  override fun downloadAndVerifyBundle(
      url: String,
      expectedSha256Hex: String,
      promise: Promise,
  ) {
    try {
      val request = Request.Builder().url(url).build()
      val response = client.newCall(request).execute()
      if (!response.isSuccessful) {
        promise.reject("E_OTA_DOWNLOAD", "HTTP ${response.code}")
        return
      }
      val body = response.body ?: run {
        promise.reject("E_OTA_DOWNLOAD", "empty body")
        return
      }

      val digest = MessageDigest.getInstance("SHA-256")
      val otaDir = File(reactApplicationContext.filesDir, "ota")
      if (!otaDir.exists()) otaDir.mkdirs()
      val outFile = File(otaDir, "pending.bundle")
      val tmp = File(otaDir, "pending.bundle.tmp")
      body.byteStream().use { input ->
        FileOutputStream(tmp).use { output ->
          val buffer = ByteArray(8192)
          var read: Int
          while (input.read(buffer).also { read = it } != -1) {
            digest.update(buffer, 0, read)
            output.write(buffer, 0, read)
          }
        }
      }
      val hashBytes = digest.digest()
      val actualHex = hashBytes.joinToString("") { "%02x".format(it) }
      if (!actualHex.equals(expectedSha256Hex.lowercase(), ignoreCase = true)) {
        tmp.delete()
        promise.reject("E_OTA_HASH", "sha256 mismatch")
        return
      }
      if (outFile.exists()) outFile.delete()
      if (!tmp.renameTo(outFile)) {
        promise.reject("E_OTA_IO", "rename failed")
        return
      }
      promise.resolve(outFile.absolutePath)
    } catch (e: Exception) {
      promise.reject("E_OTA_DOWNLOAD", e.message, e)
    }
  }

  override fun getPendingBundlePath(promise: Promise) {
    val path = prefs(reactApplicationContext).getString(KEY_PENDING, null)
    if (path.isNullOrBlank()) {
      promise.resolve("")
      return
    }
    if (!File(path).exists()) {
      promise.resolve("")
      return
    }
    promise.resolve(path)
  }

  override fun setPendingBundlePath(path: String, promise: Promise) {
    prefs(reactApplicationContext).edit().putString(KEY_PENDING, path).apply()
    promise.resolve(null)
  }

  override fun clearPendingBundle(promise: Promise) {
    prefs(reactApplicationContext).edit().remove(KEY_PENDING).apply()
    promise.resolve(null)
  }

  override fun restartApp(promise: Promise) {
    try {
      val ctx = reactApplicationContext
      val activity = ctx.currentActivity
      val pkg = ctx.packageName
      val launchIntent =
          ctx.packageManager.getLaunchIntentForPackage(pkg)?.apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
          }
      if (launchIntent != null) {
        if (activity != null) {
          activity.finishAffinity()
        }
        ctx.startActivity(launchIntent)
        Runtime.getRuntime().exit(0)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("E_OTA_RESTART", e.message, e)
    }
  }

  companion object {
    const val PREFS = "RNOtaPrefs"
    const val KEY_PENDING = "pending_bundle_path"

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun readPendingPath(ctx: Context): String? {
      val path = prefs(ctx).getString(KEY_PENDING, null) ?: return null
      return if (File(path).exists()) path else null
    }
  }
}
