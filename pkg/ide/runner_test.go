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

func TestServer_ProjectSaveAndOpen(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "vbx_project_test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	server := NewServer(tempDir)
	mux := http.NewServeMux()
	server.RegisterHandlers(mux)

	testFilePath := filepath.Join(tempDir, "Project1.vbxp")
	projectJSON := `{
		"version": "1.0",
		"projectName": "Project1",
		"form": {
			"name": "Form1",
			"caption": "Form1",
			"width": 600,
			"height": 400,
			"backColor": "#0b0f19"
		},
		"controls": [
			{
				"id": "Button1",
				"type": "Button",
				"caption": "Button1",
				"left": 48,
				"top": 48,
				"width": 100,
				"height": 32,
				"visible": true,
				"enabled": true
			}
		],
		"code": "Print \"Hello World\"\n"
	}`

	savePayload := `{"filePath":"` + strings.ReplaceAll(testFilePath, "\\", "\\\\") + `", "project":` + projectJSON + `}`

	req := httptest.NewRequest(http.MethodPost, "/api/project/save", strings.NewReader(savePayload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 on project save, got %d: %s", w.Code, w.Body.String())
	}

	// Test Open
	openReq := httptest.NewRequest(http.MethodGet, "/api/project/open?filePath="+testFilePath, nil)
	openW := httptest.NewRecorder()

	mux.ServeHTTP(openW, openReq)

	if openW.Code != http.StatusOK {
		t.Fatalf("expected status 200 on project open, got %d: %s", openW.Code, openW.Body.String())
	}

	bodyStr := openW.Body.String()
	if !strings.Contains(bodyStr, "Hello World") {
		t.Errorf("expected project code to contain 'Hello World', got %s", bodyStr)
	}
	if !strings.Contains(bodyStr, "Button1") {
		t.Errorf("expected project controls to contain 'Button1', got %s", bodyStr)
	}
}


func TestServer_ProjectSanitization(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "vbx_sanitization_test")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	server := NewServer(tempDir)
	mux := http.NewServeMux()
	server.RegisterHandlers(mux)

	// Test saving with .vbxp.json path -> must sanitize to .vbxp
	rawFilePath := filepath.Join(tempDir, "Project1.vbxp.json")
	projectJSON := `{"version":"1.0","projectName":"Project1","form":{"name":"Form1","caption":"Form1","width":600,"height":400},"controls":[],"code":""}`
	savePayload := `{"filePath":"` + strings.ReplaceAll(rawFilePath, "\\", "\\\\") + `", "project":` + projectJSON + `}`

	req := httptest.NewRequest(http.MethodPost, "/api/project/save", strings.NewReader(savePayload))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected status 200 on project save, got %d: %s", w.Code, w.Body.String())
	}

	sanitizedPath := filepath.Join(tempDir, "Project1.vbxp")
	if _, err := os.Stat(sanitizedPath); os.IsNotExist(err) {
		t.Errorf("expected sanitized project file to exist at %s", sanitizedPath)
	}
}
