package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"syscall"

	"dream-canvas/server/internal/app"
	"golang.org/x/term"
)

func main() {
	data := flag.String("data", "data", "持久数据目录")
	listen := flag.String("listen", "127.0.0.1:8080", "HTTP 监听地址")
	web := flag.String("web", "../web/dist", "前端静态目录")
	trustedProxies := flag.String("trusted-proxies", os.Getenv("DREAM_CANVAS_TRUSTED_PROXIES"), "额外可信反向代理 IP/CIDR，逗号分隔；默认仅信任回环来源")
	initAdmin := flag.String("init-admin", "", "初始化管理员用户名，仅允许空数据库")
	flag.Parse()
	root, err := filepath.Abs(*data)
	if err != nil { log.Fatal(err) }
	service, err := app.Open(root)
	if err != nil { log.Fatal(err) }
	defer service.Close()
	if *initAdmin != "" {
		fmt.Fprint(os.Stderr, "管理员密码：")
		password, err := term.ReadPassword(int(syscall.Stdin))
		fmt.Fprintln(os.Stderr)
		if err != nil { log.Fatal(err) }
		if err := service.Initialize(*initAdmin, string(password)); err != nil { log.Fatal(err) }
		fmt.Println("管理员已创建")
		return
	}
	fmt.Printf("梦想画布：http://%s\n持久目录：%s\n", *listen, root)
	log.Fatal(http.ListenAndServe(*listen, service.Router(*web, *trustedProxies)))
}
