package ide

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRunner_FallbackExecution(t *testing.T) {
	runner := NewRunner()

	code := `Print "Hello World"
Dim count = "42"
Print count
MsgBox "Test Message"`

	outputChan := make(chan OutputLine, 20)
	ctx := context.Background()

	go func() {
		defer close(outputChan)
		result := runner.Run(ctx, code, outputChan)
		if result.ExitCode != 0 {
			t.Errorf("expected exit code 0, got %d", result.ExitCode)
		}
	}()

	var received []string
	for line := range outputChan {
		received = append(received, line.Text)
	}

	foundHello := false
	found42 := false
	foundMsg := false

	for _, text := range received {
		if text == "Hello World" {
			foundHello = true
		}
		if text == "42" {
			found42 = true
		}
		if strings.Contains(text, "Test Message") {
			foundMsg = true
		}
	}

	if !foundHello {
		t.Errorf("expected output 'Hello World', got %v", received)
	}
	if !found42 {
		t.Errorf("expected output '42', got %v", received)
	}
	if !foundMsg {
		t.Errorf("expected output containing 'Test Message', got %v", received)
	}
}

func TestRunner_StopExecution(t *testing.T) {
	runner := NewRunner()

	// Long script
	code := `Print "Line 1"
Print "Line 2"
Print "Line 3"`

	outputChan := make(chan OutputLine, 20)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	go func() {
		defer close(outputChan)
		runner.Run(ctx, code, outputChan)
	}()

	time.Sleep(5 * time.Millisecond)
	stopped := runner.Stop()
	if !stopped {
		t.Log("Execution finished before stop or stop returned false")
	}

	for range outputChan {
	}
}

func TestServer_SaveAndOpen(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "vbx_test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	server := NewServer(tempDir)
	mux := http.ServeMux{}
	server.RegisterHandlers(&mux)

	testFilePath := filepath.Join(tempDir, "test.vbx")
	saveBody := strings.NewReader(`{"filePath":"` + testFilePath + `", "code":"Print \"Test Save\""}`)

	req := httptest.NewRequest(http.MethodPost, "/api/save", saveBody)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 on save, got %d", w.Code)
	}

	// Test Open
	openReq := httptest.NewRequest(http.MethodGet, "/api/open?filePath="+testFilePath, nil)
	openW := httptest.NewRecorder()

	mux.ServeHTTP(openW, openReq)

	if openW.Code != http.StatusOK {
		t.Fatalf("expected status 200 on open, got %d", openW.Code)
	}

	if !strings.Contains(openW.Body.String(), "Test Save") {
		t.Errorf("expected file content to contain 'Test Save', got %s", openW.Body.String())
	}
}
