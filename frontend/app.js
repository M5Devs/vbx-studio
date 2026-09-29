document.addEventListener("DOMContentLoaded", () => {
  // Initial default working script
  const defaultCode = `Print "Welcome to VBX Studio!"
Dim msg = "Rapid Application Development for 2026"
Print msg
MsgBox "Hello from VBX Studio!"`;

  // Initialize CodeMirror Editor
  const textarea = document.getElementById("code-editor");
  const editor = CodeMirror.fromTextArea(textarea, {
    mode: "vb",
    theme: "dracula",
    lineNumbers: true,
    tabSize: 4,
    indentWithTabs: false,
    lineWrapping: true,
    autofocus: true
  });

  editor.setValue(defaultCode);

  // UI Elements
  const btnRun = document.getElementById("btn-run");
  const btnStop = document.getElementById("btn-stop");
  const btnSave = document.getElementById("btn-save");
  const currentFilename = document.getElementById("current-filename");
  const consoleOutput = document.getElementById("console-output");
  const btnClearConsole = document.getElementById("btn-clear-console");

  const tabCode = document.getElementById("tab-code");
  const tabDesign = document.getElementById("tab-design");
  const viewCode = document.getElementById("view-code");
  const viewDesign = document.getElementById("view-design");

  const toolboxItems = document.querySelectorAll(".toolbox-item");

  let isRunning = false;

  // Setup Server-Sent Events (SSE) for execution logs
  function setupSSE() {
    const eventSource = new EventSource("/api/events");

    eventSource.onmessage = (event) => {
      try {
        const line = JSON.parse(event.data);
        appendConsoleLine(line.Text, line.Stream);
        if (line.Stream === "system" && line.Text.includes("[VBX Studio] Execution finished") || line.Text.includes("Process exited")) {
          setRunningState(false);
        }
      } catch (e) {
        console.error("Failed to parse SSE line:", e);
      }
    };

    eventSource.onerror = () => {
      console.log("SSE Connection lost, reconnecting...");
    };
  }

  setupSSE();

  function appendConsoleLine(text, stream = "stdout") {
    const div = document.createElement("div");
    div.className = `console-line line-${stream}`;
    div.textContent = text;
    consoleOutput.appendChild(div);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  function setRunningState(running) {
    isRunning = running;
    btnRun.disabled = running;
    btnStop.disabled = !running;
  }

  // Handle Run
  btnRun.addEventListener("click", async () => {
    if (isRunning) return;
    setRunningState(true);

    const code = editor.getValue();
    appendConsoleLine("[VBX Studio] Starting execution...", "system");

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });

      if (!response.ok) {
        const errText = await response.text();
        appendConsoleLine(`[Error] Execution failed: ${errText}`, "stderr");
        setRunningState(false);
      }
    } catch (err) {
      appendConsoleLine(`[Error] Request failed: ${err.message}`, "stderr");
      setRunningState(false);
    }
  });

  // Handle Stop
  btnStop.addEventListener("click", async () => {
    try {
      await fetch("/api/stop", { method: "POST" });
      appendConsoleLine("[VBX Studio] Stop request sent.", "system");
    } catch (err) {
      appendConsoleLine(`[Error] Failed to stop execution: ${err.message}`, "stderr");
    }
  });

  // Handle Save
  btnSave.addEventListener("click", async () => {
    const code = editor.getValue();
    const filePath = currentFilename.textContent || "main.vbx";

    try {
      const response = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath, code })
      });

      if (response.ok) {
        appendConsoleLine(`[VBX Studio] Saved successfully to ${filePath}`, "system");
      } else {
        appendConsoleLine(`[Error] Save failed`, "stderr");
      }
    } catch (err) {
      appendConsoleLine(`[Error] Save request failed: ${err.message}`, "stderr");
    }
  });

  // Handle Clear Console
  btnClearConsole.addEventListener("click", () => {
    consoleOutput.innerHTML = "";
  });

  // Handle Tabs Switch
  tabCode.addEventListener("click", () => {
    tabCode.classList.add("active");
    tabDesign.classList.remove("active");
    viewCode.classList.add("active");
    viewDesign.classList.remove("active");
    editor.refresh();
  });

  tabDesign.addEventListener("click", () => {
    tabDesign.classList.add("active");
    tabCode.classList.remove("active");
    viewDesign.classList.add("active");
    viewCode.classList.remove("active");
  });

  // Toolbox Selection
  toolboxItems.forEach((item) => {
    item.addEventListener("click", () => {
      toolboxItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
    });
  });

  // Keyboard Shortcuts
  document.addEventListener("keydown", (e) => {
    if (e.key === "F5") {
      e.preventDefault();
      btnRun.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      btnSave.click();
    }
  });
});
