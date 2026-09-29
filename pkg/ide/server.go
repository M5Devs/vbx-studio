package ide

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)

type Server struct {
	runner         *Runner
	staticDir      string
	mu             sync.Mutex
	activeSseChans []chan OutputLine
}

func NewServer(staticDir string) *Server {
	return &Server{
		runner:         NewRunner(),
		staticDir:      staticDir,
		activeSseChans: make([]chan OutputLine, 0),
	}
}

func (s *Server) RegisterHandlers(mux *http.ServeMux) {
	mux.HandleFunc("/api/run", s.handleRun)
	mux.HandleFunc("/api/stop", s.handleStop)
	mux.HandleFunc("/api/save", s.handleSave)
	mux.HandleFunc("/api/open", s.handleOpen)
	mux.HandleFunc("/api/events", s.handleEvents)

	// Static file server
	fileServer := http.FileServer(http.Dir(s.staticDir))
	mux.Handle("/", fileServer)
}

func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if s.runner.IsRunning() {
		http.Error(w, "An execution is already in progress", http.StatusConflict)
		return
	}

	outputChan := make(chan OutputLine, 100)

	// Broadcast output lines to SSE subscribers
	go func() {
		for line := range outputChan {
			s.mu.Lock()
			chans := append([]chan OutputLine{}, s.activeSseChans...)
			s.mu.Unlock()

			for _, ch := range chans {
				select {
				case ch <- line:
				default:
				}
			}
		}
	}()

	go func() {
		defer close(outputChan)
		s.runner.Run(r.Context(), req.Code, outputChan)
	}()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "started"})
}

func (s *Server) handleStop(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	stopped := s.runner.Stop()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"stopped": stopped})
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		FilePath string `json:"filePath"`
		Code     string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.FilePath == "" {
		req.FilePath = "main.vbx"
	}

	if err := os.WriteFile(req.FilePath, []byte(req.Code), 0644); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save file: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":   "success",
		"filePath": req.FilePath,
	})
}

func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	filePath := r.URL.Query().Get("filePath")
	if filePath == "" {
		filePath = "main.vbx"
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read file: %v", err), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"filePath": filePath,
		"code":     string(content),
	})
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported!", http.StatusInternalServerError)
		return
	}

	sseChan := make(chan OutputLine, 50)

	s.mu.Lock()
	s.activeSseChans = append(s.activeSseChans, sseChan)
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		for i, ch := range s.activeSseChans {
			if ch == sseChan {
				s.activeSseChans = append(s.activeSseChans[:i], s.activeSseChans[i+1:]...)
				break
			}
		}
		s.mu.Unlock()
		close(sseChan)
	}()

	notify := r.Context().Done()

	for {
		select {
		case <-notify:
			return
		case line := <-sseChan:
			data, _ := json.Marshal(line)
			fmt.Fprintf(w, "data: %s\n\n", data)
			flusher.Flush()
		case <-time.After(15 * time.Second):
			// Keepalive
			fmt.Fprintf(w, ": keepalive\n\n")
			flusher.Flush()
		}
	}
}
