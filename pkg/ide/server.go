package ide

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"
	"time"
)


type FormConfig struct {
	Name      string `json:"name"`
	Caption   string `json:"caption"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	BackColor string `json:"backColor,omitempty"`
}

type ControlConfig struct {
	ID      string `json:"id"`
	Type    string `json:"type"`
	Caption string `json:"caption,omitempty"`
	Text    string `json:"text,omitempty"`
	Left    int    `json:"left"`
	Top     int    `json:"top"`
	Width   int    `json:"width"`
	Height  int    `json:"height"`
	Visible bool   `json:"visible"`
	Enabled bool   `json:"enabled"`
}

type ProjectConfig struct {
	Version     string          `json:"version"`
	ProjectName string          `json:"projectName"`
	Form        FormConfig      `json:"form"`
	Controls    []ControlConfig `json:"controls"`
	Code        string          `json:"code"`
}

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
	mux.HandleFunc("/api/project/save", s.handleProjectSave)
	mux.HandleFunc("/api/project/open", s.handleProjectOpen)

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

func (s *Server) handleProjectSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		FilePath string        `json:"filePath"`
		Project  ProjectConfig `json:"project"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid JSON body", http.StatusBadRequest)
		return
	}

	if req.FilePath == "" {
		if req.Project.ProjectName != "" {
			req.FilePath = req.Project.ProjectName + ".vbxp"
		} else {
			req.FilePath = "project.vbxp"
		}
	}

	data, err := json.MarshalIndent(req.Project, "", "  ")
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to marshal project: %v", err), http.StatusInternalServerError)
		return
	}

	if err := os.WriteFile(req.FilePath, data, 0644); err != nil {
		http.Error(w, fmt.Sprintf("Failed to save project file: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "success",
		"filePath": req.FilePath,
		"project":  req.Project,
	})
}

func (s *Server) handleProjectOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	filePath := r.URL.Query().Get("filePath")
	if filePath == "" {
		filePath = "project.vbxp"
	}

	content, err := os.ReadFile(filePath)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to read project file: %v", err), http.StatusNotFound)
		return
	}

	var project ProjectConfig
	if err := json.Unmarshal(content, &project); err != nil {
		http.Error(w, fmt.Sprintf("Failed to parse project file: %v", err), http.StatusBadRequest)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"filePath": filePath,
		"project":  project,
	})
}
