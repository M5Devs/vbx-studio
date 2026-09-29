package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"vbx-studio/pkg/ide"
)

func main() {
	portFlag := flag.Int("port", 0, "Port to run web server on (0 for automatic free port)")
	noBrowser := flag.Bool("no-browser", false, "Do not auto-open application in browser")
	flag.Parse()

	// Locate frontend directory
	frontendDir := "frontend"
	if _, err := os.Stat(frontendDir); os.IsNotExist(err) {
		// Fallback to searching relative to executable or current directory
		execPath, err := os.Executable()
		if err == nil {
			frontendDir = filepath.Join(filepath.Dir(execPath), "frontend")
		}
	}

	server := ide.NewServer(frontendDir)
	mux := http.NewServeMux()
	server.RegisterHandlers(mux)

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *portFlag))
	if err != nil {
		log.Fatalf("Failed to start listener: %v", err)
	}

	addr := listener.Addr().String()
	url := fmt.Sprintf("http://%s", addr)

	fmt.Println("====================================================")
	fmt.Println("                VBX STUDIO v1.0                     ")
	fmt.Println("  Visual Basic X - Cyberpunk Modern IDE Shell       ")
	fmt.Println("====================================================")
	fmt.Printf("Server listening at %s\n", url)

	if !*noBrowser {
		go openBrowser(url)
	}

	if err := http.Serve(listener, mux); err != nil {
		log.Fatalf("Server stopped with error: %v", err)
	}
}

func openBrowser(url string) {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "windows":
		cmd = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", url}
	case "darwin":
		cmd = "open"
		args = []string{url}
	default: // linux, bsd, etc.
		if _, err := exec.LookPath("google-chrome"); err == nil {
			cmd = "google-chrome"
			args = []string{"--app=" + url}
		} else if _, err := exec.LookPath("chromium"); err == nil {
			cmd = "chromium"
			args = []string{"--app=" + url}
		} else {
			cmd = "xdg-open"
			args = []string{url}
		}
	}

	_ = exec.Command(cmd, args...).Start()
}
