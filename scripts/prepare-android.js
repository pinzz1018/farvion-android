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
