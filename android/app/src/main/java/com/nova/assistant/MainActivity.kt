package com.nova.assistant

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.ViewGroup
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private lateinit var webView: WebView
    private var pendingWebPermission: PermissionRequest? = null
    private val preferences by lazy { getSharedPreferences("nova", MODE_PRIVATE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(9, 10, 16)
        window.navigationBarColor = Color.rgb(9, 10, 16)
        createLayout()
        val saved = preferences.getString("server_url", "").orEmpty()
        if (saved.isBlank()) promptForServer() else connect(saved)
    }

    private fun createLayout() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(9, 10, 16))
        }
        val toolbar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(14, 5, 10, 5)
            setBackgroundColor(Color.rgb(17, 19, 29))
        }
        val title = TextView(this).apply {
            text = "NOVA"
            textSize = 18f
            setTextColor(Color.rgb(234, 231, 255))
            letterSpacing = .15f
        }
        val serverButton = Button(this).apply {
            text = "SERVER"
            setTextColor(Color.rgb(205, 196, 255))
            setOnClickListener { promptForServer() }
        }
        toolbar.addView(title, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        toolbar.addView(serverButton)

        webView = WebView(this)
        webView.setBackgroundColor(Color.rgb(9, 10, 16))
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = true
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val currentHost = Uri.parse(preferences.getString("server_url", "")).host
                val target = request.url
                if (target.host == currentHost) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, target))
                    true
                } catch (_: Exception) {
                    true
                }
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    val wantsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
                    if (!wantsAudio) {
                        request.deny()
                    } else if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.resources)
                    } else {
                        pendingWebPermission = request
                        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), AUDIO_PERMISSION_REQUEST)
                    }
                }
            }
        }
        root.addView(toolbar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(webView, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        setContentView(root)
    }

    private fun promptForServer() {
        val input = EditText(this).apply {
            setSingleLine(true)
            inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI
            hint = "http://192.168.1.20:8765"
            setText(preferences.getString("server_url", ""))
            setSelection(text.length)
        }
        val padding = (20 * resources.displayMetrics.density).toInt()
        val wrapper = LinearLayout(this).apply {
            setPadding(padding, 0, padding, 0)
            addView(input)
        }
        AlertDialog.Builder(this)
            .setTitle("Connect to NOVA")
            .setMessage("Start NOVA on your laptop, run desktop\\run-nova-lan.bat, then enter the laptop's Wi-Fi address with port 8765.")
            .setView(wrapper)
            .setPositiveButton("Connect") { _, _ -> connect(input.text.toString()) }
            .setNegativeButton("Cancel", null)
            .setNeutralButton("Help") { _, _ -> showHelp() }
            .setCancelable(preferences.getString("server_url", "").orEmpty().isNotBlank())
            .show()
    }

    private fun connect(raw: String) {
        val value = raw.trim().trimEnd('/')
        val uri = Uri.parse(value)
        if ((uri.scheme != "http" && uri.scheme != "https") || uri.host.isNullOrBlank() || uri.port !in 1..65535) {
            Toast.makeText(this, "Enter a server address like http://192.168.1.20:8765", Toast.LENGTH_LONG).show()
            promptForServer()
            return
        }
        preferences.edit().putString("server_url", value).apply()
        webView.loadUrl(value)
    }

    private fun showHelp() {
        AlertDialog.Builder(this)
            .setTitle("Connect your phone")
            .setMessage("On your laptop, start NOVA with desktop\\run-nova-lan.bat. Find its local IPv4 address with ipconfig, then enter http://LAPTOP-IP:8765 here. Keep both devices on the same trusted Wi-Fi network.")
            .setPositiveButton("OK", null)
            .show()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == AUDIO_PERMISSION_REQUEST) {
            val request = pendingWebPermission
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED && request != null) {
                request.grant(request.resources)
            } else {
                request?.deny()
                Toast.makeText(this, "Microphone permission was not granted.", Toast.LENGTH_SHORT).show()
            }
            pendingWebPermission = null
        }
    }

    @Suppress("DEPRECATION")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val AUDIO_PERMISSION_REQUEST = 4102
    }
}
