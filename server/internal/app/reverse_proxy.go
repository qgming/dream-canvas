package app

import (
	"fmt"
	"net"
	"strings"

	"github.com/gin-gonic/gin"
)

func configureTrustedProxies(router *gin.Engine, value string) error {
	proxies := []string{"127.0.0.1", "::1"}
	var ranges []*net.IPNet
	for _, raw := range strings.Split(value, ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" { continue }
		if !strings.Contains(raw, "/") {
			address := net.ParseIP(raw)
			if address == nil { return fmt.Errorf("无效的可信代理 IP/CIDR：%q", raw) }
			raw = address.String()
			if address.To4() != nil { raw += "/32" } else { raw += "/128" }
		}
		_, prefix, err := net.ParseCIDR(raw)
		if err != nil { return fmt.Errorf("无效的可信代理 IP/CIDR：%q", raw) }
		proxies = append(proxies, raw)
		ranges = append(ranges, prefix)
	}
	if err := router.SetTrustedProxies(proxies); err != nil { return err }
	router.Use(func(c *gin.Context) {
		// Trust the socket peer, never a client-controlled forwarding header.
		address := net.ParseIP(c.RemoteIP())
		trusted := address != nil && address.IsLoopback()
		for _, prefix := range ranges { if prefix.Contains(address) { trusted = true; break } }
		c.Set("trustedProxy", trusted)
		c.Next()
	})
	return nil
}
