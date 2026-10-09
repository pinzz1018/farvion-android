# Farvion Android (Capacitor)

APK pembungkus untuk Farvion. Isi app dimuat **live dari https://farvion.my.id** (update web otomatis masuk, tidak perlu build ulang APK). Push notifikasi pakai FCM native, login Google pakai dialog akun Google native.

Package ID: `id.my.farvion` · Nama app: **Farvion**

## Langkah (urut)

1. **Deploy web v2.4.0 ke Netlify dulu** (zip `farvion-v2_3_6.zip` yang sudah berisi perubahan push/login native). APK memuat web live, jadi kode barunya harus sudah online.
2. **Firebase Console** → project `farvion-beta` → Project settings → Your apps → **Add app → Android**:
   - Package name: `id.my.farvion`
   - Isi sidik jari (Add fingerprint), dua-duanya:
     - SHA-1: `47:B4:FB:C5:34:A9:41:09:9F:4B:E7:80:14:49:A9:EC:E7:91:E5:0B`
     - SHA-256: `58:07:8D:C0:81:0E:D5:DA:8F:4A:3B:BE:AA:6E:05:EE:B3:D4:9D:EA:C2:8B:4D:9D:5F:75:D3:21:0B:AD:80:B9`
   - Unduh **google-services.json** (unduh SETELAH sidik jari ditambahkan), taruh di **root folder ini** (sejajar `package.json`).
3. **Buat repo GitHub PRIVATE** (wajib private, karena folder `signing/` berisi keystore) lalu push seluruh isi folder ini, termasuk folder `.github`:
   ```
   git init && git add -A && git commit -m "Farvion Android"
   git branch -M main
   git remote add origin https://github.com/USERNAME/farvion-android.git
   git push -u origin main
   ```
4. Tab **Actions** → **Build Farvion APK** → **Run workflow** (push ke `main` juga otomatis memulai build). Tunggu sekitar 5-10 menit.
5. Buka tab **Releases** di repo → unduh **Farvion.apk** → install (izinkan "install dari sumber tidak dikenal").

## Penting

- **Backup folder `signing/`.** Semua update APK harus ditandatangani keystore yang sama. Kalau keystore diganti, app lama harus di-uninstall dulu, dan SHA-1 baru harus didaftarkan lagi di Firebase.
- Login Google gagal dengan error 10 / "developer error" = SHA-1 belum terdaftar di Firebase, atau google-services.json lama (belum berisi sidik jari). Tambahkan sidik jari lalu unduh ulang google-services.json dan build ulang.
- Izin notifikasi Android 13+ muncul lewat modal Farvion setelah balasan pertama; bisa juga dinyalakan dari Pengaturan > Notifikasi.
- Pastikan Firebase Cloud Messaging API (V1) aktif untuk project (sudah dipakai web push, biasanya sudah aktif).
- Belum ditangani: unduh file hasil generate (blob download) di dalam WebView. Kalau ada fitur unduh yang tidak bereaksi di APK, kabari supaya ditambah plugin Filesystem/Share.
