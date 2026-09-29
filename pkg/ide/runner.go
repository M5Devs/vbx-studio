package ide

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// OutputLine represents a line of stdout/stderr from execution
type OutputLine struct {
	Stream string `json:"stream"` // "stdout", "stderr", "system"
	Text   string `json:"text"`
	Time   string `json:"time"`
}

// ExecutionResult represents the final status of a run
type ExecutionResult struct {
	ExitCode int     `json:"exitCode"`
	Duration string  `json:"duration"`
	Error    string  `json:"error,omitempty"`
}

// Runner manages execution of VBX code
type Runner struct {
	mu        sync.Mutex
	cancel    context.CancelFunc
	isRunning bool
}

// NewRunner creates a new Runner instance
func NewRunner() *Runner {
	return &Runner{}
}

// IsRunning returns whether code is currently being executed
func (r *Runner) IsRunning() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.isRunning
}

// Stop terminates the active execution if any
func (r *Runner) Stop() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.cancel != nil {
		r.cancel()
		r.isRunning = false
		return true
	}
	return false
}

// Run executes the given code buffer
func (r *Runner) Run(ctx context.Context, code string, outputChan chan<- OutputLine) ExecutionResult {
	r.mu.Lock()
	runCtx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.isRunning = true
	r.mu.Unlock()

	defer func() {
		r.mu.Lock()
		r.isRunning = false
		r.cancel = nil
		r.mu.Unlock()
	}()

	startTime := time.Now()

	// Write temp file
	tempDir := os.TempDir()
	tempFile := filepath.Join(tempDir, "temp_studio.vbx")
	if err := os.WriteFile(tempFile, []byte(code), 0644); err != nil {
		outputChan <- OutputLine{
			Stream: "stderr",
			Text:   fmt.Sprintf("[Error] Failed to write temp file: %v", err),
			Time:   time.Now().Format("15:04:05"),
		}
		return ExecutionResult{ExitCode: 1, Duration: time.Since(startTime).String(), Error: err.Error()}
	}

	outputChan <- OutputLine{
		Stream: "system",
		Text:   fmt.Sprintf("[VBX Studio] Executing code from %s...", tempFile),
		Time:   time.Now().Format("15:04:05"),
	}

	// Check if `vbx` executable exists on PATH
	vbxPath, err := exec.LookPath("vbx")
	if err == nil {
		return r.runExternalVBX(runCtx, vbxPath, tempFile, startTime, outputChan)
	}

	// Fallback internal VBX runner
	outputChan <- OutputLine{
		Stream: "system",
		Text:   "[VBX Studio] 'vbx' binary not found on PATH. Using built-in VBX Execution Engine v1.0",
		Time:   time.Now().Format("15:04:05"),
	}
	return r.runFallbackVBX(runCtx, code, startTime, outputChan)
}

func (r *Runner) runExternalVBX(ctx context.Context, binaryPath, filePath string, startTime time.Time, outputChan chan<- OutputLine) ExecutionResult {
	cmd := exec.CommandContext(ctx, binaryPath, "run", filePath)

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return ExecutionResult{ExitCode: 1, Duration: time.Since(startTime).String(), Error: err.Error()}
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return ExecutionResult{ExitCode: 1, Duration: time.Since(startTime).String(), Error: err.Error()}
	}

	if err := cmd.Start(); err != nil {
		outputChan <- OutputLine{
			Stream: "stderr",
			Text:   fmt.Sprintf("[Error] Failed to start process: %v", err),
			Time:   time.Now().Format("15:04:05"),
		}
		return ExecutionResult{ExitCode: 1, Duration: time.Since(startTime).String(), Error: err.Error()}
	}

	var wg sync.WaitGroup
	wg.Add(2)

	readPipe := func(reader io.Reader, streamName string) {
		defer wg.Done()
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			outputChan <- OutputLine{
				Stream: streamName,
				Text:   scanner.Text(),
				Time:   time.Now().Format("15:04:05"),
			}
		}
	}

	go readPipe(stdout, "stdout")
	go readPipe(stderr, "stderr")

	wg.Wait()
	err = cmd.Wait()

	duration := time.Since(startTime).String()
	exitCode := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		} else {
			exitCode = 1
		}
	}

	outputChan <- OutputLine{
		Stream: "system",
		Text:   fmt.Sprintf("[VBX Studio] Process exited with code %d (Duration: %s)", exitCode, duration),
		Time:   time.Now().Format("15:04:05"),
	}

	return ExecutionResult{
		ExitCode: exitCode,
		Duration: duration,
	}
}

// Fallback interpreter for executing core VBX scripts when external vbx binary is absent
func (r *Runner) runFallbackVBX(ctx context.Context, code string, startTime time.Time, outputChan chan<- OutputLine) ExecutionResult {
	lines := strings.Split(code, "\n")
	vars := make(map[string]interface{})

	for lineNo, rawLine := range lines {
		select {
		case <-ctx.Done():
			outputChan <- OutputLine{
				Stream: "stderr",
				Text:   "[VBX Studio] Execution aborted by user.",
				Time:   time.Now().Format("15:04:05"),
			}
			return ExecutionResult{ExitCode: 130, Duration: time.Since(startTime).String(), Error: "Interrupted"}
		default:
		}

		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "'") || strings.HasPrefix(line, "Rem") {
			continue // skip empty lines & comments
		}

		// Handle Print statement
		if strings.HasPrefix(line, "Print ") || strings.HasPrefix(line, "print ") {
			expr := strings.TrimSpace(line[6:])
			val := evaluateExpr(expr, vars)
			outputChan <- OutputLine{
				Stream: "stdout",
				Text:   fmt.Sprintf("%v", val),
				Time:   time.Now().Format("15:04:05"),
			}
			time.Sleep(10 * time.Millisecond) // slight simulation delay
			continue
		}

		// Handle MsgBox statement
		if strings.HasPrefix(line, "MsgBox ") || strings.HasPrefix(line, "msgbox ") {
			expr := strings.TrimSpace(line[7:])
			val := evaluateExpr(expr, vars)
			outputChan <- OutputLine{
				Stream: "stdout",
				Text:   fmt.Sprintf("[Dialog MsgBox] %v", val),
				Time:   time.Now().Format("15:04:05"),
			}
			continue
		}

		// Handle Dim / Variable assignment: Dim x = 10 or x = "hello"
		if strings.HasPrefix(line, "Dim ") || strings.HasPrefix(line, "dim ") {
			decl := strings.TrimSpace(line[4:])
			if idx := strings.Index(decl, "="); idx != -1 {
				varName := strings.TrimSpace(decl[:idx])
				expr := strings.TrimSpace(decl[idx+1:])
				vars[varName] = evaluateExpr(expr, vars)
			} else {
				// Dim x
				vars[strings.TrimSpace(decl)] = ""
			}
			continue
		}

		// Direct assignment: var = expr
		if idx := strings.Index(line, "="); idx != -1 && !strings.HasPrefix(line, "If") {
			varName := strings.TrimSpace(line[:idx])
			expr := strings.TrimSpace(line[idx+1:])
			vars[varName] = evaluateExpr(expr, vars)
			continue
		}

		outputChan <- OutputLine{
			Stream: "stderr",
			Text:   fmt.Sprintf("Line %d: Syntax or unknown statement: %s", lineNo+1, line),
			Time:   time.Now().Format("15:04:05"),
		}
	}

	duration := time.Since(startTime).String()
	outputChan <- OutputLine{
		Stream: "system",
		Text:   fmt.Sprintf("[VBX Studio] Execution finished successfully (Duration: %s)", duration),
		Time:   time.Now().Format("15:04:05"),
	}

	return ExecutionResult{
		ExitCode: 0,
		Duration: duration,
	}
}

func evaluateExpr(expr string, vars map[string]interface{}) interface{} {
	expr = strings.TrimSpace(expr)

	// String literal
	if (strings.HasPrefix(expr, "\"") && strings.HasSuffix(expr, "\"")) ||
		(strings.HasPrefix(expr, "'") && strings.HasSuffix(expr, "'")) {
		if len(expr) >= 2 {
			return expr[1 : len(expr)-1]
		}
		return ""
	}

	// Number literal
	if val, err := strconv.ParseFloat(expr, 64); err == nil {
		return val
	}

	// Variable lookup
	if val, exists := vars[expr]; exists {
		return val
	}

	// Simple string concatenation or addition
	if strings.Contains(expr, "&") {
		parts := strings.Split(expr, "&")
		var result string
		for _, p := range parts {
			v := evaluateExpr(strings.TrimSpace(p), vars)
			result += fmt.Sprintf("%v", v)
		}
		return result
	}

	// Basic string regex unquote check
	strRegex := regexp.MustCompile(`^"([^"]*)"$`)
	if matches := strRegex.FindStringSubmatch(expr); len(matches) > 1 {
		return matches[1]
	}

	return expr
}
