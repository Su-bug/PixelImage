package main

import (
	"embed"
	"io/fs"
	"net"
	"net/http"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2"
)

//go:embed all:ui
var uiFS embed.FS

func messageBox(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(text)
	user32 := syscall.NewLazyDLL("user32.dll")
	proc := user32.NewProc("MessageBoxW")
	proc.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), 0x10)
}

func main() {
	web, err := fs.Sub(uiFS, "ui")
	if err != nil {
		messageBox("像素马赛克生成器", "内置页面加载失败")
		return
	}

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		messageBox("像素马赛克生成器", "无法启动本地服务")
		return
	}
	defer ln.Close()

	go http.Serve(ln, http.FileServer(http.FS(web)))

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		WindowOptions: webview2.WindowOptions{
			Title:  "像素马赛克生成器",
			Width:  1280,
			Height: 860,
			Center: true,
		},
	})
	if w == nil {
		messageBox("像素马赛克生成器", "需要 Microsoft Edge WebView2 运行时。\nWin10/11 一般已自带，也可到微软官网安装。")
		return
	}
	defer w.Destroy()

	w.SetSize(1280, 860, webview2.HintNone)
	w.Navigate("http://" + ln.Addr().String() + "/index.html")
	w.Run()
}
