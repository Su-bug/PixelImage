# Pixel Mosaic · 像素马赛克生成器

纯前端的图片转像素画工具：上传图片 → 像素化 → 手动修格子 → 导出 PNG。  
处理全部在浏览器本地完成，不上传服务器。

## 功能

- **像素块模式**：按块大小（1–32）和输出最长边实时预览，接近常见在线像素工具的交互
- **指定宽×高**：适合做精灵图 / 固定尺寸素材
- **色盘**：自动 2–256 色，或 Game Boy / Pico-8 / 1-bit；可选 Floyd–Steinberg 抖动
- **采样**：分块平均、特征保留、K-Centroid、中值
- **手改像素**：滴管 / 画笔 / 填充 / 橡皮，撤销重做，改完再导出
- **双份导出**：真实像素尺寸 PNG + 最近邻放大预览 PNG
- **PWA**：通过本地静态服务打开后可「添加到主屏幕」

## 快速开始

无需安装依赖，用浏览器打开根目录的 `index.html` 即可。

若要启用 Service Worker（离线缓存），请用静态服务而不是 `file://`：

```bash
npx --yes serve -p 5173 .
```

然后访问 <http://localhost:5173>。

### 使用建议

| 目标 | 建议设置 |
|------|----------|
| 人像 / 想看清五官 | 像素块 3–6，颜色 64–128，最长边 400 |
| 更强复古感 | 像素块 8–16，颜色 16–32 |
| 游戏精灵图 | 切到「指定宽×高」，如 64×64 |

重新点「生成」会覆盖手改结果，建议先调参数，再修格子，最后导出。

## 目录结构

```text
.
├── index.html              # 页面
├── styles.css
├── app.js                  # 上传 / 预览 / 手改 / 导出
├── pixelate.js             # 像素化与色盘算法
├── manifest.webmanifest    # PWA
├── sw.js
├── icons/                  # 应用图标
├── scripts/pack.ps1        # 打 web zip + Windows exe，并同步原生壳资源
└── native/
    ├── windows/            # Go + WebView2 桌面壳
    └── android/            # Android WebView 壳
```

## 打包与分发

体积优先，不用 Electron。

| 产物 | 体积量级 | 说明 |
|------|----------|------|
| 网页文件 / zip | 很小 | 解压后打开 `index.html`，或挂到任意静态托管 |
| `PixelMosaic.exe` | 约 7–12 MB | Win10/11，依赖系统 WebView2 |
| Android APK | 约 2–5 MB | 需本机 Android Studio / JDK 17 |

Windows 一键打包（需已安装 [Go](https://go.dev/)）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\pack.ps1
```

会生成：

- `dist/pixel-mosaic-web.zip`
- `dist/PixelMosaic.exe`
- 并把网页资源同步到 `native/windows/ui` 与 Android `assets/www`

若缺少 WebView2，可安装 [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。

### Android APK

1. 先运行上面的 `scripts\pack.ps1`
2. 用 [Android Studio](https://developer.android.com/studio)（JDK 17）打开 `native/android`
3. `Build > Generate Signed Bundle / APK`，选 release APK

应用内导出的 PNG 会保存到系统「下载」目录。

## GitHub Pages

推送到 GitHub 后，在仓库 **Settings → Pages** 中：

1. Source 选部署分支（如 `main` / `master`）
2. 目录选 `/ (root)`
3. 保存后即可用 `https://<user>.github.io/<repo>/` 在线使用

## 开发说明

- 核心算法在 `pixelate.js`，UI 与编辑器在 `app.js`
- `dist/` 与各平台同步出来的网页副本已加入 `.gitignore`，不要提交构建产物
- 字体通过 Google Fonts 加载；离线时会回退到系统等宽字体，不影响功能

## License

MIT
