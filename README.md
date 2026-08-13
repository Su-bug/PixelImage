# 像素马赛克生成器

纯前端工具：上传图片 → 指定宽×高 → 特征保留像素化 → 导出 PNG。

## 给别人看（按体积从小到大）

| 方式 | 大约体积 | 别人怎么用 |
|------|----------|------------|
| `dist/pixel-mosaic-web.zip` | 约 100KB～300KB | 解压后用浏览器打开 `index.html` |
| GitHub Pages / 任意静态托管 | 同上 | 发一个网址；手机浏览器可「添加到主屏幕」变成 PWA |
| `dist/PixelMosaic.exe` | 约 8～12MB | Windows 10/11 双击（用系统自带 WebView2，不塞 Chromium） |
| Android APK | 约 2～5MB | 安装后离线用 |

不要用 Electron：同样功能会到 100MB+。

本机一键出 zip + exe：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pack.ps1
```

## Windows 包

- 代码：`native/windows`（Go + WebView2）
- 产物：`dist/PixelMosaic.exe`（单文件）
- 系统要求：Win10/11，一般已带 Edge WebView2；没有则安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)

## Android 包

本机若还没有 Android SDK / JDK 17，不能直接出 APK。步骤：

1. 安装 [Android Studio](https://developer.android.com/studio)（自带 JDK 17）
2. 先运行 `scripts\pack.ps1`（会把网页资源同步进 `native/android/app/src/main/assets/www`）
3. Android Studio 打开 `native/android`
4. `Build > Generate Signed Bundle / APK` → 选 APK → release  
   或命令行（在 Android Studio 自带的 JDK 17 下）：

```text
native\android\gradlew.bat assembleRelease
```

签名 APK 在 `native/android/app/build/outputs/apk/release/`。

导出的 PNG 会进系统「下载」目录。

## 网页开发

直接打开 `index.html` 即可。若要 PWA 离线缓存，需用本地静态服务（`file://` 下 Service Worker 不生效），例如：

```powershell
npx --yes serve -p 5173 .
```

然后浏览器打开 `http://localhost:5173`。

## Git

仓库已初始化。常用：

```powershell
git status
git add -A
git commit -m "说明这次改了什么"
```

推到 GitHub 后，在仓库 Settings → Pages 选主分支即可在线给别人打开。
