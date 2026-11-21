package app

import (
	"crypto/tls"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestProxySessionCookie(test *testing.T) {
	for _, sample := range []struct {
		name, proxies, peer, proto string
		tls, secure bool
	}{
		{"loopback", "", "127.0.0.1:9000", "https", false, true},
		{"ipv6 loopback", "", "[::1]:9000", "https", false, true},
		{"mapped loopback", "", "[::ffff:127.0.0.1]:9000", "https", false, true},
		{"unconfigured bridge", "", "172.18.0.1:9000", "https", false, false},
		{"explicit bridge", "172.18.0.1/32", "172.18.0.1:9000", "https", false, true},
		{"explicit CIDR", "192.0.2.0/24", "192.0.2.4:9000", "https", false, true},
		{"outside CIDR", "192.0.2.0/24", "192.0.3.4:9000", "https", false, false},
		{"proxy IP", "172.18.0.1", "172.18.0.1:9000", "https", false, true},
		{"proxy IPv6", "2001:db8::1/128", "[2001:db8::1]:9000", "https", false, true},
		{"mapped bridge", "172.18.0.1/32", "[::ffff:172.18.0.1]:9000", "https", false, true},
		{"mapped proxy IP", "::ffff:172.18.0.1", "172.18.0.1:9000", "https", false, true},
		{"mapped proxy excludes other IPs", "::ffff:172.18.0.1", "198.51.100.1:9000", "https", false, false},
		{"untrusted peer spoof", "172.18.0.1/32", "198.51.100.1:9000", "https", false, false},
		{"missing protocol", "172.18.0.1/32", "172.18.0.1:9000", "", false, false},
		{"HTTP", "172.18.0.1/32", "172.18.0.1:9000", "http", false, false},
		{"multiple protocols", "172.18.0.1/32", "172.18.0.1:9000", "https, http", false, false},
		{"direct TLS", "", "198.51.100.1:9000", "http", true, true},
	} {
		test.Run(sample.name, func(test *testing.T) {
			router := gin.New()
			if err := configureTrustedProxies(router, sample.proxies); err != nil { test.Fatal(err) }
			router.GET("/session", func(c *gin.Context) {
				c.SetSameSite(http.SameSiteStrictMode)
				c.SetCookie(sessionCookie, "test", 0, "/", "", secureCookie(c), true)
			})
			router.GET("/logout", clearSessionCookie)
			for _, path := range []string{"/session", "/logout"} {
				request := httptest.NewRequest(http.MethodGet, path, nil)
				request.RemoteAddr = sample.peer
				request.Header.Set("X-Forwarded-Proto", sample.proto)
				request.Header.Set("X-Forwarded-For", "127.0.0.1")
				if sample.tls { request.TLS = &tls.ConnectionState{} }
				response := httptest.NewRecorder()
				router.ServeHTTP(response, request)
				cookies := response.Result().Cookies()
				if len(cookies) != 1 || cookies[0].Secure != sample.secure || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
					test.Fatalf("%s: unexpected session cookie: %v", path, cookies)
				}
			}
		})
	}
}

func TestRejectInvalidTrustedProxy(test *testing.T) {
	for _, value := range []string{"not-an-IP", "172.18.0.1/99", "https://proxy.example", "fe80::1%eth0"} {
		if err := configureTrustedProxies(gin.New(), value); err == nil { test.Fatalf("accepted invalid trusted proxy %q", value) }
	}
}
