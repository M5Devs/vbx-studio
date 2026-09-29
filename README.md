# VBX Studio Shell

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen)](https://github.com/vbx-studio)
[![Go Version](https://img.shields.io/badge/go-1.24%2B-blue)](https://golang.org)
[![License](https://img.shields.io/badge/license-GPLv3-blue)](#license)

**VBX Studio** is a modern, lightweight, cross-platform visual IDE for the **Visual Basic X (VBX)** programming language. Phase 1 introduces the desktop IDE shell featuring the classic 3-pane Visual Basic layout, an integrated code editor with syntax highlighting, and a Go backend process runner to execute `.vbx` scripts with live real-time log output.

---

## 🎨 Cyberpunk Visual Aesthetics

Inspired by classic Visual Basic IDEs (like VisualFBEditor and AvaloniaVisualBasic6) and reimagined with modern 2026 cyberpunk styling:
- **Background**: Deep Navy / Slate Slate (`#0b0f19` / `#121826`)
- **Primary Accent**: Neon Cyan (`#00e5ff`)
- **Secondary Accent**: Electric Purple (`#b388ff`)
- **Status Indicators**: Electric Green (`#00e676`) for Run and Red (`#ff5252`) for Stop

---

## 📐 Classic 3-Pane Layout

```
+-------------------------------------------------------------------------+
| VBX STUDIO  [File] [Edit] [Project] [Help]  [▶ Run] [⏹ Stop] [💾 Save]  |
+--------------+------------------------------------------+---------------+
| TOOLBOX      | WORKSPACE TAB: [Code View] [Design View] | PROPERTIES    |
|              |------------------------------------------|               |
| [ ] Pointer  |  1 | Print "Welcome to VBX Studio!"      | (Name)  Form1 |
| [ ] Button   |  2 | Dim msg = "RAD for 2026"            | Caption VBX   |
| [ ] TextBox  |  3 | Print msg                           | BackColor...  |
| [ ] Label    |  4 | MsgBox "Hello from VBX Studio!"     | Width   8000  |
| [ ] CheckBox |                                          | Height  6000  |
| [ ] Frame    |                                          | Visible True  |
| [ ] Image    |                                          |               |
| [ ] Timer    |                                          |               |
+--------------+------------------------------------------+---------------+
| CONSOLE      | [VBX Studio] Engine Ready...                             |
| OUTPUT       | [stdout] Welcome to VBX Studio!                          |
+-------------------------------------------------------------------------+
```

1. **Top Toolbar**: Menu navigation and quick execution controls (`Run`, `Stop`, `Save`).
2. **Left Sidebar (Toolbox Panel)**: Classic visual control placeholders (`Pointer`, `Button`, `TextBox`, `Label`, `CheckBox`, `Frame`, `Image`, `Timer`).
3. **Center Panel (Workspace)**: Dual-view tab system (`[Code View]` and `[Design View]`). Code view uses CodeMirror configured with VB/VBX syntax highlighting.
4. **Right Sidebar (Properties Panel)**: Structured property table displaying design properties (`Name`, `Caption`, `BackColor`, `Width`, `Height`, etc.).
5. **Bottom Panel (Output / Console Log)**: Real-time streaming console that displays compiler output, execution logs, stdout, stderr, execution time, and process status.

---

## 🚀 Features

- **Integrated Execution Engine**:
  - Automatically invokes `vbx run temp_studio.vbx` if the `vbx` binary is installed on system `PATH`.
  - Includes a fallback built-in interpreter for executing VBX syntax out of the box.
- **Real-Time Streaming**: Real-time output streaming from backend to UI using Server-Sent Events (SSE).
- **Default Sample Code**:
  ```vbx
  Print "Welcome to VBX Studio!"
  Dim msg = "Rapid Application Development for 2026"
  Print msg
  MsgBox "Hello from VBX Studio!"
  ```
- **Keyboard Shortcuts**:
  - `F5` — Run script
  - `Ctrl+S` / `Cmd+S` — Save buffer

---

## 🛠️ Building and Running Locally

### Prerequisites
- **Go 1.22+** installed on your system.

### Build Application
```bash
# Build the application
go build -o vbx-studio ./cmd/vbx-studio
```

### Run Application
```bash
# Launch VBX Studio (automatically launches desktop browser window)
./vbx-studio

# Or run without auto-opening a browser window
./vbx-studio --no-browser --port=8080
```

### Running Unit Tests
```bash
go test -v ./...
```

---

## 📁 Project Structure

```
.
├── cmd/
│   └── vbx-studio/
│       └── main.go       # Launcher & webview/browser server entrypoint
├── pkg/
│   └── ide/
│       ├── runner.go      # Process execution engine (vbx run & fallback)
│       ├── runner_test.go # Unit tests for runner and server handlers
│       └── server.go      # SSE event stream & HTTP API endpoints
├── frontend/
│   ├── index.html         # 3-Pane HTML shell
│   ├── style.css          # Cyberpunk dark theme styles
│   └── app.js             # Editor setup, SSE consumer, UI handlers
├── go.mod
└── README.md
```

---

## 📜 License

Distributed under the GPLv3 License.
