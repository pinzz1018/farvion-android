// Dijalankan di CI SETELAH `npx cap add android` dan SEBELUM `npx cap sync`.
// 1) Salin ikon launcher + ikon status bar notifikasi + warna.
// 2) Salin google-services.json.
// 3) Patch AndroidManifest (meta-data FCM, izin mikrofon).
// 4) Patch app/build.gradle (signing rilis dari signing/, versionCode = nomor run CI,
//    versionName = "version" dari https://farvion.my.id/version.json).
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const androidDir = path.join(root, "android");
const appDir = path.join(androidDir, "app");
const resDest = path.join(appDir, "src", "main", "res");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 1) resource
copyDir(path.join(root, "resources", "res"), resDest);
// Ikon template lama format .webp/.xml di mipmap bisa menimpa png kita -> hapus yang bentrok.
for (const d of fs.readdirSync(resDest)) {
  if (!d.startsWith("mipmap-")) continue;
  for (const f of fs.readdirSync(path.join(resDest, d))) {
    if (/^ic_launcher(_round|_foreground)?\.webp$/.test(f)) fs.unlinkSync(path.join(resDest, d, f));
  }
}

// 1b) Splash: hapus splash.png bawaan template Capacitor (semua kerapatan/orientasi) supaya tidak
//     bentrok dengan drawable/splash.xml kita (kanvas krem + logo Farvion).
for (const d of fs.readdirSync(resDest)) {
  if (!d.startsWith("drawable")) continue;
  for (const f of fs.readdirSync(path.join(resDest, d))) {
    if (/^splash\.(png|jpg|webp)$/.test(f)) fs.unlinkSync(path.join(resDest, d, f));
  }
}

// 2) google-services.json
fs.copyFileSync(path.join(root, "google-services.json"), path.join(appDir, "google-services.json"));

// 3) manifest
const manifestPath = path.join(appDir, "src", "main", "AndroidManifest.xml");
let manifest = fs.readFileSync(manifestPath, "utf8");
if (!manifest.includes("default_notification_icon")) {
  manifest = manifest.replace(
    "</application>",
    `    <meta-data android:name="com.google.firebase.messaging.default_notification_icon" android:resource="@drawable/ic_stat_farvion" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_color" android:resource="@color/farvion_notif_color" />
        <meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="farvion_replies" />
    </application>`
  );
}
for (const perm of ["android.permission.RECORD_AUDIO", "android.permission.MODIFY_AUDIO_SETTINGS"]) {
  if (!manifest.includes(perm)) {
    manifest = manifest.replace("</manifest>", `    <uses-permission android:name="${perm}" />\n</manifest>`);
  }
}
fs.writeFileSync(manifestPath, manifest);

// 3b) tema: warna seleksi teks (handle teardrop + aksen) = biru Farvion #3D5AFE.
//     colorAccent / colorControlActivated dipakai WebView & EditText; handle
//     digambar ulang lewat android:textSelectHandle* (vector biru).
const stylesPath = path.join(appDir, "src", "main", "res", "values", "styles.xml");
if (fs.existsSync(stylesPath)) {
  let styles = fs.readFileSync(stylesPath, "utf8");
  const setItem = (xml, styleName, itemName, value) => {
    const styleRe = new RegExp(`(<style\\s+name="${styleName}"[^>]*>)([\\s\\S]*?)(</style>)`);
    const m = xml.match(styleRe);
    if (!m) return xml;
    const itemRe = new RegExp(`<item\\s+name="${itemName.replace(/[.]/g, "\\.")}"[^>]*>[^<]*</item>`);
    let body = m[2];
    const item = `<item name="${itemName}">${value}</item>`;
    body = itemRe.test(body) ? body.replace(itemRe, item) : body + `    ${item}\n`;
    return xml.replace(styleRe, `$1${body}$3`);
  };
  for (const [name, val] of [
    ["colorAccent", "@color/farvion_accent"],
    ["colorControlActivated", "@color/farvion_accent"],
    ["android:textSelectHandleLeft", "@drawable/farvion_select_handle_left"],
    ["android:textSelectHandleRight", "@drawable/farvion_select_handle_right"],
    ["android:textSelectHandle", "@drawable/farvion_select_handle_middle"],
    // Status bar TRANSPARAN (layar penuh, web digambar sampai tepi atas; jarak aman atas
    // diurus web lewat --android-sat). Navigation bar tetap krem Farvion (--color-canvas
    // #FDFBF7). Ikon status bar gelap.
    ["colorPrimaryDark", "@color/farvion_canvas"],
    ["android:statusBarColor", "@android:color/transparent"],
    ["android:navigationBarColor", "@color/farvion_canvas"],
    ["android:windowBackground", "@color/farvion_canvas"],
    ["android:windowLightStatusBar", "true"],
    ["android:windowLightNavigationBar", "true"],
    ["android:enforceStatusBarContrast", "false"],
    ["android:enforceNavigationBarContrast", "false"],
  ]) {
    // (tema splash ditangani terpisah di bawah)
    // AppTheme.NoActionBar punya parent eksplisit (tidak mewarisi AppTheme) dan
    // itulah tema yang dipakai activity saat runtime, jadi dua-duanya dipatch.
    styles = setItem(styles, "AppTheme", name, val);
    styles = setItem(styles, "AppTheme\\.NoActionBar", name, val);
  }
  // Splash sistem Android 12+ (androidx core-splashscreen): latar krem + logo Farvion.
  // Hanya dipatch kalau template memakai Theme.SplashScreen untuk tema launch.
  if (/<style\s+name="AppTheme\.NoActionBarLaunch"[^>]*Theme\.SplashScreen/.test(styles)) {
    for (const [name, val] of [
      ["windowSplashScreenBackground", "@color/farvion_canvas"],
      ["windowSplashScreenAnimatedIcon", "@drawable/farvion_splash_logo"],
    ]) {
      styles = setItem(styles, "AppTheme\\.NoActionBarLaunch", name, val);
    }
  } else {
    console.warn("AppTheme.NoActionBarLaunch bukan Theme.SplashScreen -- logo splash Android 12+ tidak dipatch");
  }
  fs.writeFileSync(stylesPath, styles);
} else {
  console.warn("styles.xml tidak ditemukan -- warna seleksi tidak dipatch");
}

// 3c) MainActivity: matikan haptic feedback bawaan WebView supaya tahan-lama di
//     bagian yang tidak menyeleksi teks tidak menggetarkan HP. (Getaran yang
//     disengaja app lewat navigator.vibrate tidak terpengaruh.)
(function patchMainActivity() {
  const javaRoot = path.join(appDir, "src", "main", "java");
  const found = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (f === "MainActivity.java") found.push(full);
    }
  })(javaRoot);
  if (!found.length) {
    console.warn("MainActivity.java tidak ditemukan -- haptic tidak dipatch");
    return;
  }
  const file = found[0];
  const src = fs.readFileSync(file, "utf8");
  const pkg = (src.match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
  if (!pkg) {
    console.warn("package MainActivity tidak terbaca -- haptic tidak dipatch");
    return;
  }
  fs.writeFileSync(
    file,
    `package ${pkg};

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.provider.DocumentsContract;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

public class MainActivity extends BridgeActivity {
  // Tinggi status bar / cutout atas dalam piksel fisik (diisi listener insets).
  private volatile int topInsetPx = 0;
  private volatile int bottomInsetPx = 0;
  // Dipakai pengaman layar penuh: true selama keyboard terbuka (WebView memang menyusut setinggi keyboard).
  private volatile boolean imeOpenNow = false;
  private int guardAttempts = 0;
  private long guardWindowStart = 0;

  // Dibaca web lewat window.FarvionInsets.getTop() -> piksel CSS.
  public class FarvionInsets {
    @JavascriptInterface
    public String getTop() {
      float density = getResources().getDisplayMetrics().density;
      return String.valueOf(topInsetPx / (density <= 0 ? 1f : density));
    }
    @JavascriptInterface
    public String getBottom() {
      float density = getResources().getDisplayMetrics().density;
      return String.valueOf(bottomInsetPx / (density <= 0 ? 1f : density));
    }
  }

  // Pemilih file (<input type=file> tanpa accept gambar/video, mis. tombol "File" di sheet
  // "Tambahkan ke obrolan") dibuka langsung di folder Download, bukan tab "Terbaru".
  private static class DownloadsParams extends WebChromeClient.FileChooserParams {
    private final WebChromeClient.FileChooserParams p;
    DownloadsParams(WebChromeClient.FileChooserParams p) { this.p = p; }
    @Override public int getMode() { return p.getMode(); }
    @Override public String[] getAcceptTypes() { return p.getAcceptTypes(); }
    @Override public boolean isCaptureEnabled() { return p.isCaptureEnabled(); }
    @Override public CharSequence getTitle() { return p.getTitle(); }
    @Override public String getFilenameHint() { return p.getFilenameHint(); }
    @Override public Intent createIntent() {
      Intent base = p.createIntent();
      String[] types = p.getAcceptTypes();
      if (types != null) {
        for (String t : types) {
          if (t != null && (t.startsWith("image/") || t.startsWith("video/"))) return base;
        }
      }
      Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      i.addCategory(Intent.CATEGORY_OPENABLE);
      i.setType(base.getType() != null ? base.getType() : "*/*");
      String[] mimes = base.getStringArrayExtra(Intent.EXTRA_MIME_TYPES);
      if (mimes != null) i.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
      if (p.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
        i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
      }
      if (Build.VERSION.SDK_INT >= 26) {
        i.putExtra(DocumentsContract.EXTRA_INITIAL_URI,
            Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload"));
      }
      return i;
    }
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    // Dipasang di onCreate (sebelum halaman pertama selesai dimuat) supaya web bisa
    // membaca window.FarvionInsets sejak <head>.
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().addJavascriptInterface(new FarvionInsets(), "FarvionInsets");
      // Matikan efek overscroll/meregang bawaan Android (12+): efek itu menarik seluruh tampilan
      // WebView, termasuk kotak ketik yang position:fixed, saat obrolan ditarik lewat ujungnya.
      getBridge().getWebView().setOverScrollMode(View.OVER_SCROLL_NEVER);
      getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> cb, FileChooserParams params) {
          return super.onShowFileChooser(webView, cb, new DownloadsParams(params));
        }
      });
      // Di HP RAM kecil (mis. HyperOS/MIUI) Android bisa mematikan proses renderer WebView
      // saat app di latar belakang (tab browser dalam-app, kamera, dst). Tanpa penanganan,
      // WebView mati: layar beku, semua tombol tidak merespons, atau app crash lalu mulai
      // dari awal ("relog"). Di sini kita buat ulang activity (WebView baru) lalu muat halaman lagi.
      getBridge().getWebView().setWebViewClient(new BridgeWebViewClient(getBridge()) {
        @Override
        @SuppressLint("NewApi")
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
          runOnUiThread(() -> recreate());
          return true;
        }
      });
    }

    // Layar penuh: app digambar sampai belakang status bar (transparan). Juga dipanggil ulang
    // di onResume/onWindowFocusChanged (lihat applyEdgeToEdge di bawah).
    applyEdgeToEdge();

    View content = findViewById(android.R.id.content);
    ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
      Insets bars = insets.getInsets(
          WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
      // Atas dibiarkan 0 (web yang memberi jarak lewat --android-sat); bawah/kiri/kanan
      // tetap dijaga native, termasuk saat keyboard muncul.
      // Bawah: web digambar sampai tepi layar (supaya overlay/sheet menutup sampai bawah, tanpa
      // garis krem native). Bar gesture dikirim ke web sebagai --android-sab; saat keyboard
      // terbuka, native tetap memberi padding setinggi keyboard dan sab = 0.
      boolean imeOpen = ime.bottom > bars.bottom;
      imeOpenNow = imeOpen;
      v.setPadding(bars.left, 0, bars.right, imeOpen ? ime.bottom : 0);
      topInsetPx = bars.top;
      bottomInsetPx = imeOpen ? 0 : bars.bottom;
      if (getBridge() != null && getBridge().getWebView() != null) {
        final float density = getResources().getDisplayMetrics().density;
        final float css = bars.top / (density <= 0 ? 1f : density);
        getBridge().getWebView().post(() ->
            getBridge().getWebView().evaluateJavascript(
                "window.__setAndroidSat&&window.__setAndroidSat(" + css + ");"
                + "window.__setAndroidSab&&window.__setAndroidSab(" + (bottomInsetPx / (density <= 0 ? 1f : density)) + ")", null));
      }
      return WindowInsetsCompat.CONSUMED;
    });
    ViewCompat.requestApplyInsets(content);

    // Pengaman: tiap tata letak berubah, pastikan WebView benar-benar menempel ke tepi atas dan
    // bawah layar (kecuali saat keyboard terbuka). Kalau tidak, pasang ulang mode layar penuh.
    getWindow().getDecorView().getViewTreeObserver().addOnGlobalLayoutListener(this::guardEdgeToEdge);
  }

  // (2026-10) Pengaman bagian krem: kalau karena sebab apa pun (kembali dari kamera/pemilih file,
  // notifikasi, rotasi, dst.) WebView tidak lagi menempel ke tepi atas/bawah layar, pasang ulang
  // mode layar penuh. Dibatasi 6 percobaan per 2 detik supaya tidak memicu tata letak berulang.
  private void guardEdgeToEdge() {
    if (getBridge() == null || getBridge().getWebView() == null) return;
    if (imeOpenNow) return;
    final WebView wv = getBridge().getWebView();
    final View decor = getWindow().getDecorView();
    if (wv.getHeight() <= 0 || decor.getHeight() <= 0) return;
    int[] loc = new int[2];
    wv.getLocationInWindow(loc);
    boolean inset = loc[1] > 0 || (loc[1] + wv.getHeight()) < decor.getHeight();
    if (!inset) {
      guardAttempts = 0;
      return;
    }
    long now = SystemClock.uptimeMillis();
    if (now - guardWindowStart > 2000) {
      guardWindowStart = now;
      guardAttempts = 0;
    }
    if (guardAttempts >= 6) return;
    guardAttempts++;
    decor.post(this::reapplyEdgeToEdge);
  }

  // (2026-10) FIX bagian krem di atas (status bar) dan bawah (bar gesture) yang tidak tertutup
  // overlay gelap setelah user kembali dari pemilih file / foto / kamera. Penyebab: setelah
  // activity lain (pemilih file, kamera) menutup, jendela app bisa kembali ke mode "konten di
  // dalam bar sistem" sehingga WebView menyusut setinggi status bar + bar gesture dan sisanya
  // menampilkan warna latar krem. Mode layar penuh sekarang dipasang ulang setiap app kembali ke
  // depan / mendapat fokus, lalu insets dikirim ulang ke web (--android-sat / --android-sab).
  private void applyEdgeToEdge() {
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.TRANSPARENT);
    if (Build.VERSION.SDK_INT >= 29) getWindow().setNavigationBarContrastEnforced(false);
    WindowInsetsControllerCompat ctl =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    ctl.setAppearanceLightStatusBars(true);
    ctl.setAppearanceLightNavigationBars(true);
  }

  private void reapplyEdgeToEdge() {
    applyEdgeToEdge();
    View content = findViewById(android.R.id.content);
    if (content != null) ViewCompat.requestApplyInsets(content);
  }

  @Override
  public void onResume() {
    super.onResume();
    reapplyEdgeToEdge();
  }

  @Override
  public void onWindowFocusChanged(boolean hasFocus) {
    super.onWindowFocusChanged(hasFocus);
    if (hasFocus) reapplyEdgeToEdge();
  }

  @Override
  public void onStart() {
    super.onStart();
    if (getBridge() != null && getBridge().getWebView() != null) {
      getBridge().getWebView().setHapticFeedbackEnabled(false);
    }
  }
}
`
  );
})();

// 3d) FarvionWebView: terima gambar dari keyboard Android (Gboard "Papan klip", stiker, GIF).
//     Tanpa ini Gboard menolak dengan toast "Farvion tidak mendukung penempelan gambar di sini",
//     karena WebView tidak mengaku bisa menerima konten gambar. Kelas ini mengiklankan MIME gambar
//     lewat EditorInfo lalu meneruskan gambarnya ke web (window.__farvionPasteImage di js/app.js).
//     Dipasang HATI-HATI: layout WebView bawaan Capacitor dibaca langsung dari node_modules dan
//     hanya ditimpa kalau bentuknya dikenali. Kalau tidak, build tetap jalan (tanpa fitur ini).
(function patchPasteImageWebView() {
  try {
    const javaRoot = path.join(appDir, "src", "main", "java");
    let mainFile = null;
    (function walk(dir) {
      if (mainFile || !fs.existsSync(dir)) return;
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (f === "MainActivity.java") { mainFile = full; return; }
      }
    })(javaRoot);
    if (!mainFile) throw new Error("MainActivity.java tidak ditemukan");
    const pkg = (fs.readFileSync(mainFile, "utf8").match(/^\s*package\s+([\w.]+)\s*;/m) || [])[1];
    if (!pkg) throw new Error("package MainActivity tidak terbaca");

    const libRes = path.join(root, "node_modules", "@capacitor", "android", "capacitor", "src", "main", "res", "layout");
    if (!fs.existsSync(libRes)) throw new Error("folder layout Capacitor tidak ditemukan: " + libRes);
    let layoutName = null;
    let layoutSrc = null;
    for (const f of fs.readdirSync(libRes)) {
      if (!f.endsWith(".xml")) continue;
      const txt = fs.readFileSync(path.join(libRes, f), "utf8");
      if (/android:id="@\+id\/webview"/.test(txt)) { layoutName = f; layoutSrc = txt; break; }
    }
    if (!layoutSrc) throw new Error("layout dengan id webview tidak ditemukan");

    let baseImport = "";
    let baseClass = "";
    let tag = "";
    if (/<com\.getcapacitor\.CapacitorWebView\b/.test(layoutSrc)) {
      const cwv = path.join(root, "node_modules", "@capacitor", "android", "capacitor", "src", "main", "java", "com", "getcapacitor", "CapacitorWebView.java");
      if (!fs.existsSync(cwv)) throw new Error("CapacitorWebView.java tidak ditemukan");
      baseImport = "import com.getcapacitor.CapacitorWebView;";
      baseClass = "CapacitorWebView";
      tag = "com.getcapacitor.CapacitorWebView";
    } else if (/<WebView\b/.test(layoutSrc)) {
      baseImport = "import android.webkit.WebView;";
      baseClass = "WebView";
      tag = "WebView";
    } else {
      throw new Error("tag WebView di layout tidak dikenali");
    }

    const patchedLayout = layoutSrc
      .replace(new RegExp("<" + tag.replace(/\./g, "\\.") + "\\b", "g"), "<" + pkg + ".FarvionWebView")
      .replace(new RegExp("</" + tag.replace(/\./g, "\\.") + ">", "g"), "</" + pkg + ".FarvionWebView>");
    if (patchedLayout === layoutSrc) throw new Error("layout tidak berubah setelah patch");

    const java = `package __PKG__;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.util.AttributeSet;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import androidx.core.view.inputmethod.EditorInfoCompat;
import androidx.core.view.inputmethod.InputConnectionCompat;
import androidx.core.view.inputmethod.InputContentInfoCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import org.json.JSONObject;
__BASE_IMPORT__

public class FarvionWebView extends __BASE_CLASS__ {
  private static final long MAX_BYTES = 10L * 1024 * 1024; // sama dengan MAX_ATTACHMENT_SIZE di app.js

  public FarvionWebView(Context context, AttributeSet attrs) {
    super(context, attrs);
    // Jalur cadangan tempel gambar: web memanggil window.FarvionClipboard.hasImage()/readImage()
    // untuk membaca papan klip sistem langsung (tidak bergantung pada keyboard).
    addJavascriptInterface(new ClipboardBridge(context), "FarvionClipboard");
  }

  @Override
  public InputConnection onCreateInputConnection(EditorInfo outAttrs) {
    InputConnection ic = super.onCreateInputConnection(outAttrs);
    if (ic == null || outAttrs == null) return ic;
    EditorInfoCompat.setContentMimeTypes(outAttrs, new String[] {
        "image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"
    });
    return InputConnectionCompat.createWrapper(ic, outAttrs,
        (info, flags, opts) -> handleCommit(info, flags));
  }

  private boolean handleCommit(final InputContentInfoCompat info, int flags) {
    if (Build.VERSION.SDK_INT >= 25
        && (flags & InputConnectionCompat.INPUT_CONTENT_GRANT_READ_URI_PERMISSION) != 0) {
      try {
        info.requestPermission();
      } catch (Exception e) {
        return false;
      }
    }
    final Uri uri = info.getContentUri();
    final String mime = info.getDescription().getMimeTypeCount() > 0
        ? info.getDescription().getMimeType(0) : "image/png";
    new Thread(() -> {
      String b64 = "";
      try {
        InputStream in = getContext().getContentResolver().openInputStream(uri);
        if (in != null) {
          ByteArrayOutputStream out = new ByteArrayOutputStream();
          byte[] buf = new byte[16384];
          long total = 0;
          int n;
          boolean tooBig = false;
          while ((n = in.read(buf)) > 0) {
            total += n;
            if (total > MAX_BYTES) { tooBig = true; break; }
            out.write(buf, 0, n);
          }
          in.close();
          if (!tooBig) b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        }
      } catch (Exception e) {
        b64 = "";
      } finally {
        if (Build.VERSION.SDK_INT >= 25) {
          try { info.releasePermission(); } catch (Exception ignored) {}
        }
      }
      final String safeMime = mime.replace("'", "");
      final String js = "window.__farvionPasteImage&&window.__farvionPasteImage('" + safeMime + "','" + b64 + "')";
      post(() -> evaluateJavascript(js, null));
    }).start();
    return true;
  }

  /** Jembatan baca papan klip sistem (hanya gambar) untuk window.FarvionClipboard. */
  private static class ClipboardBridge {
    private final Context ctx;

    ClipboardBridge(Context c) {
      this.ctx = c.getApplicationContext();
    }

    @JavascriptInterface
    public boolean hasImage() {
      try {
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip()) return false;
        ClipDescription d = cm.getPrimaryClipDescription();
        return d != null && d.hasMimeType("image/*");
      } catch (Exception e) {
        return false;
      }
    }

    /** JSON {"mime":..., "b64":...}; string kosong kalau tidak ada gambar / terlalu besar. */
    @JavascriptInterface
    public String readImage() {
      try {
        ClipboardManager cm = (ClipboardManager) ctx.getSystemService(Context.CLIPBOARD_SERVICE);
        if (cm == null || !cm.hasPrimaryClip()) return "";
        ClipData clip = cm.getPrimaryClip();
        if (clip == null || clip.getItemCount() == 0) return "";
        Uri uri = clip.getItemAt(0).getUri();
        if (uri == null) return "";
        String mime = ctx.getContentResolver().getType(uri);
        if (mime == null || !mime.startsWith("image/")) {
          ClipDescription d = clip.getDescription();
          mime = d.getMimeTypeCount() > 0 ? d.getMimeType(0) : "image/png";
        }
        InputStream in = ctx.getContentResolver().openInputStream(uri);
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        long total = 0;
        int n;
        while ((n = in.read(buf)) > 0) {
          total += n;
          if (total > MAX_BYTES) {
            in.close();
            return "";
          }
          out.write(buf, 0, n);
        }
        in.close();
        JSONObject o = new JSONObject();
        o.put("mime", mime);
        o.put("b64", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        return o.toString();
      } catch (Exception e) {
        return "";
      }
    }
  }
}
`.replace("__PKG__", pkg).replace("__BASE_IMPORT__", baseImport).replace("__BASE_CLASS__", baseClass);

    fs.writeFileSync(path.join(path.dirname(mainFile), "FarvionWebView.java"), java);
    const layoutDest = path.join(resDest, "layout");
    fs.mkdirSync(layoutDest, { recursive: true });
    fs.writeFileSync(path.join(layoutDest, layoutName), patchedLayout);
    console.log("FarvionWebView terpasang (" + layoutName + ", basis " + baseClass + ") -- tempel gambar dari keyboard aktif");
  } catch (e) {
    console.warn("Tempel gambar dari keyboard TIDAK dipasang (build tetap lanjut): " + (e && e.message));
  }
})();

// 4) gradle
const gradlePath = path.join(appDir, "build.gradle");
let g = fs.readFileSync(gradlePath, "utf8");
if (!g.includes("farvionSigning")) {
  const props = `def farvionSigning = new Properties()
farvionSigning.load(new FileInputStream(rootProject.file("../signing/keystore.properties")))

`;
  g = g.replace(/^android\s*\{/m, props + "android {");
  g = g.replace(
    /buildTypes\s*\{/,
    `signingConfigs {
        release {
            storeFile rootProject.file("../signing/farvion-release.keystore")
            storePassword farvionSigning['storePassword']
            keyAlias farvionSigning['keyAlias']
            keyPassword farvionSigning['keyPassword']
        }
    }
    buildTypes {`
  );
  g = g.replace(/(buildTypes\s*\{\s*release\s*\{)/, "$1\n            signingConfig signingConfigs.release");
}
const run = parseInt(process.env.GITHUB_RUN_NUMBER || "1", 10);

// versionName = "version" di https://farvion.my.id/version.json (sumber kebenaran
// versi Farvion). versionCode TETAP nomor run CI supaya selalu naik (Android
// menolak update kalau versionCode turun).
function fetchWebVersion() {
  const { execFileSync } = require("child_process");
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      const out = execFileSync(
        "curl",
        ["-fsSL", "--max-time", "20", "https://farvion.my.id/version.json?t=" + Date.now()],
        { encoding: "utf8" }
      );
      const v = String(JSON.parse(out).version || "").trim();
      if (/^\d+\.\d+\.\d+$/.test(v)) return v;
      throw new Error("format version tidak valid: " + v);
    } catch (e) {
      lastErr = e;
      console.warn("prepare-android: ambil version.json gagal (percobaan " + i + "/3): " + e.message);
    }
  }
  console.error("GAGAL: tidak bisa baca version.json dari farvion.my.id. " + lastErr.message);
  process.exit(1);
}
const webVersion = fetchWebVersion();
g = g.replace(/versionCode\s+\d+/, `versionCode ${run}`);
g = g.replace(/versionName\s+"[^"]*"/, `versionName "${webVersion}"`);
fs.writeFileSync(gradlePath, g);

if (!/signingConfig signingConfigs\.release/.test(g)) {
  console.error("GAGAL: patch signing di build.gradle tidak terpasang (format template berubah).");
  process.exit(1);
}
console.log("prepare-android: selesai (versionName " + webVersion + ", versionCode " + run + ")");
