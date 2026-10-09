// Dijalankan di CI SETELAH `npx cap add android` dan SEBELUM `npx cap sync`.
// 1) Salin ikon launcher + ikon status bar notifikasi + warna.
// 2) Salin google-services.json.
// 3) Patch AndroidManifest (meta-data FCM, izin mikrofon).
// 4) Patch app/build.gradle (signing rilis dari signing/, versionCode/versionName).
// 5) Patch res/values/styles.xml (warna aksen tema = biru Farvion: handle seleksi teks, kursor).
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

// 5) tema: warna aksen biru Farvion.
// Template Capacitor punya AppTheme.NoActionBar dengan parent eksplisit (Theme.AppCompat.DayNight.NoActionBar),
// jadi item di AppTheme TIDAK diwariskan. Tanpa ini, aksen jatuh ke teal bawaan AppCompat (handle seleksi hijau).
const stylesPath = path.join(resDest, "values", "styles.xml");
let st = fs.readFileSync(stylesPath, "utf8");
if (!st.includes("farvion_accent")) {
  const items =
    `\n        <item name="colorAccent">@color/farvion_accent</item>` +
    `\n        <item name="colorControlActivated">@color/farvion_accent</item>` +
    `\n        <item name="android:colorControlActivated">@color/farvion_accent</item>` +
    `\n        <item name="android:textColorHighlight">@color/farvion_selection_highlight</item>`;
  // Hapus colorAccent bawaan template supaya tidak dobel (item ganda dalam satu style).
  st = st.replace(/\s*<item name="colorAccent">[^<]*<\/item>/g, "");
  let patched = 0;
  // Sisipkan ke AppTheme dan AppTheme.NoActionBar (yang dipakai BridgeActivity setelah splash).
  st = st.replace(/(<style\s+name="AppTheme(?:\.NoActionBar)?"[^>]*>)/g, (m) => {
    patched++;
    return m + items;
  });
  if (patched < 2) {
    console.error("GAGAL: styles.xml tidak berisi AppTheme dan AppTheme.NoActionBar (format template berubah).");
    process.exit(1);
  }
  fs.writeFileSync(stylesPath, st);
}

if (!/signingConfig signingConfigs\.release/.test(g)) {
  console.error("GAGAL: patch signing di build.gradle tidak terpasang (format template berubah).");
  process.exit(1);
}
console.log("prepare-android: selesai (versionCode " + run + ")");
