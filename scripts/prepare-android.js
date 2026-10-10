// Dijalankan di CI SETELAH `npx cap add android` dan SEBELUM `npx cap sync`.
// 1) Salin ikon launcher + ikon status bar notifikasi + warna.
// 2) Salin google-services.json.
// 3) Patch AndroidManifest (meta-data FCM, izin mikrofon).
// 4) Patch app/build.gradle (signing rilis dari signing/, versionCode/versionName).
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
    // AppTheme.NoActionBar punya parent eksplisit (tidak mewarisi AppTheme) dan
    // itulah tema yang dipakai activity saat runtime, jadi dua-duanya dipatch.
    styles = setItem(styles, "AppTheme", name, val);
    styles = setItem(styles, "AppTheme\\.NoActionBar", name, val);
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

import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.view.View;
import android.webkit.JavascriptInterface;
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

public class MainActivity extends BridgeActivity {
  // Tinggi status bar / cutout atas dalam piksel fisik (diisi listener insets).
  private volatile int topInsetPx = 0;

  // Dibaca web lewat window.FarvionInsets.getTop() -> piksel CSS.
  public class FarvionInsets {
    @JavascriptInterface
    public String getTop() {
      float density = getResources().getDisplayMetrics().density;
      return String.valueOf(topInsetPx / (density <= 0 ? 1f : density));
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
      getBridge().getWebView().setWebChromeClient(new BridgeWebChromeClient(getBridge()) {
        @Override
        public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> cb, FileChooserParams params) {
          return super.onShowFileChooser(webView, cb, new DownloadsParams(params));
        }
      });
    }

    // Layar penuh: app digambar sampai belakang status bar (transparan).
    WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
    getWindow().setStatusBarColor(Color.TRANSPARENT);
    getWindow().setNavigationBarColor(Color.parseColor("#FDFBF7"));
    WindowInsetsControllerCompat ctl =
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
    ctl.setAppearanceLightStatusBars(true);
    ctl.setAppearanceLightNavigationBars(true);

    View content = findViewById(android.R.id.content);
    ViewCompat.setOnApplyWindowInsetsListener(content, (v, insets) -> {
      Insets bars = insets.getInsets(
          WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
      Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
      // Atas dibiarkan 0 (web yang memberi jarak lewat --android-sat); bawah/kiri/kanan
      // tetap dijaga native, termasuk saat keyboard muncul.
      v.setPadding(bars.left, 0, bars.right, Math.max(bars.bottom, ime.bottom));
      topInsetPx = bars.top;
      if (getBridge() != null && getBridge().getWebView() != null) {
        final float density = getResources().getDisplayMetrics().density;
        final float css = bars.top / (density <= 0 ? 1f : density);
        getBridge().getWebView().post(() ->
            getBridge().getWebView().evaluateJavascript(
                "window.__setAndroidSat&&window.__setAndroidSat(" + css + ")", null));
      }
      return WindowInsetsCompat.CONSUMED;
    });
    ViewCompat.requestApplyInsets(content);
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
g = g.replace(/versionCode\s+\d+/, `versionCode ${run}`);
g = g.replace(/versionName\s+"[^"]*"/, `versionName "2.4.${run}"`);
fs.writeFileSync(gradlePath, g);

if (!/signingConfig signingConfigs\.release/.test(g)) {
  console.error("GAGAL: patch signing di build.gradle tidak terpasang (format template berubah).");
  process.exit(1);
}
console.log("prepare-android: selesai (versionCode " + run + ")");
