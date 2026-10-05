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

  // Design View Elements
  const canvasContainer = document.getElementById("canvas-container");
  const designerForm = document.getElementById("designer-form");
  const formTitlebar = document.getElementById("form-titlebar");
  const formTitleText = document.getElementById("form-title-text");
  const formBody = document.getElementById("form-body");
  const propertiesPanelTitle = document.getElementById("properties-panel-title");
  const propertiesBody = document.getElementById("properties-body");

  let isRunning = false;

  // Visual Designer State
  const GRID_SIZE = 8;
  const state = {
    form: {
      id: "Form1",
      name: "Form1",
      caption: "Form1",
      left: 40,
      top: 40,
      width: 440,
      height: 320,
      visible: true,
      enabled: true
    },
    controls: [],
    selectedId: "Form1",
    activeTool: "Pointer",
    nextControlIndices: {
      Button: 1,
      TextBox: 1,
      Label: 1,
      CheckBox: 1,
      Frame: 1,
      Image: 1,
      Timer: 1
    }
  };

  function snapToGrid(val) {
    return Math.round(val / GRID_SIZE) * GRID_SIZE;
  }

  // Client-Side JS VBX Interpreter for Static Hosting (e.g. GitHub Pages)
  let abortRequested = false;

  function isStaticHosting() {
    if (typeof window === "undefined" || !window.location) return false;
    const hostname = window.location.hostname || "";
    const protocol = window.location.protocol || "";
    return protocol === "file:" || hostname.endsWith("github.io") || hostname.endsWith("github.dev");
  }

  function evaluateJSExpr(expr, vars = {}) {
    expr = expr.trim();
    if (!expr) return "";

    const concatParts = splitByOp(expr, "&");
    if (concatParts.length > 1) {
      return concatParts.map((p) => evaluateJSExpr(p, vars)).join("");
    }

    if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
      return expr.slice(1, -1);
    }

    if (!isNaN(Number(expr)) && expr !== "") {
      return Number(expr);
    }

    if (expr.toLowerCase() === "true") return true;
    if (expr.toLowerCase() === "false") return false;

    if (Object.prototype.hasOwnProperty.call(vars, expr)) {
      return vars[expr];
    }

    try {
      let replaced = expr.replace(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g, (match) => {
        const lower = match.toLowerCase();
        if (lower === "true" || lower === "false" || lower === "and" || lower === "or" || lower === "not") {
          return match;
        }
        if (Object.prototype.hasOwnProperty.call(vars, match)) {
          const val = vars[match];
          if (typeof val === "string") return JSON.stringify(val);
          return val;
        }
        return match;
      });

      replaced = replaced.replace(/<>/g, "!=");
      return Function('"use strict"; return (' + replaced + ');')();
    } catch (e) {
      return expr;
    }
  }

  function splitByOp(str, op) {
    const parts = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      if (char === '"' || char === "'") {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
        }
      }
      if (char === op && !inQuotes) {
        parts.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    parts.push(current);
    return parts;
  }

  async function executeSingleVBXLine(line, vars, log) {
    if (!line || line.startsWith("'") || line.toLowerCase().startsWith("rem ")) return;

    if (/^(Sub|Function|End Sub|End Function)\b/i.test(line)) {
      return;
    }

    if (/^Print(\s+.*)?$/i.test(line)) {
      const expr = line.replace(/^Print\s*/i, "");
      const val = expr ? evaluateJSExpr(expr, vars) : "";
      log(String(val), "stdout");
      await new Promise((r) => setTimeout(r, 10));
      return;
    }

    if (/^MsgBox(\s+.*)?$/i.test(line)) {
      const expr = line.replace(/^MsgBox\s*/i, "");
      const val = expr ? evaluateJSExpr(expr, vars) : "";
      log("[Dialog MsgBox] " + val, "stdout");
      if (typeof window !== "undefined" && typeof window.alert === "function") {
        try { window.alert(String(val)); } catch (e) {}
      }
      await new Promise((r) => setTimeout(r, 10));
      return;
    }

    // InputBox command: InputBox "Prompt", "Title", "Default" or variable assignment x = InputBox(...)
    const inputBoxMatch = line.match(/^(?:(?:Dim\s+)?([a-zA-Z0-9_]+)\s*=\s*)?InputBox\s*\((.*)\)$/i) ||
                          line.match(/^(?:(?:Dim\s+)?([a-zA-Z0-9_]+)\s*=\s*)?InputBox\s+(.+)$/i);
    if (inputBoxMatch) {
      const targetVar = inputBoxMatch[1];
      const argsStr = inputBoxMatch[2];
      const args = splitByOp(argsStr, ",").map((a) => evaluateJSExpr(a.trim(), vars));
      const promptText = args[0] !== undefined ? String(args[0]) : "";
      const defaultVal = args[2] !== undefined ? String(args[2]) : "";

      let result = "";
      if (typeof window !== "undefined" && typeof window.prompt === "function") {
        const userInput = window.prompt(promptText, defaultVal);
        result = userInput !== null ? userInput : "";
      } else {
        result = defaultVal;
      }

      log("[InputBox] " + promptText + " -> " + result, "system");
      if (targetVar) {
        vars[targetVar] = result;
      }
      await new Promise((r) => setTimeout(r, 10));
      return;
    }

    if (/^Dim\s+/i.test(line)) {
      const decl = line.replace(/^Dim\s+/i, "").trim();
      const eqIdx = decl.indexOf("=");
      if (eqIdx !== -1) {
        const varName = decl.slice(0, eqIdx).trim();
        const expr = decl.slice(eqIdx + 1).trim();
        vars[varName] = evaluateJSExpr(expr, vars);
      } else {
        vars[decl] = "";
      }
      return;
    }

    const assignIdx = line.indexOf("=");
    if (assignIdx !== -1 && !line.toLowerCase().startsWith("if ")) {
      const varName = line.slice(0, assignIdx).trim();
      const expr = line.slice(assignIdx + 1).trim();
      vars[varName] = evaluateJSExpr(expr, vars);
      return;
    }

    log("Syntax or unknown statement: " + line, "stderr");
  }

  async function runClientSideVBX(code) {
    abortRequested = false;
    const lines = code.split("\n");
    const vars = {};

    function log(text, stream = "stdout") {
      appendConsoleLine(text, stream);
    }

    log("[VBX Studio] Executing script client-side (GitHub Pages mode)...", "system");
    const startTime = Date.now();

    let ip = 0;
    let maxSteps = 10000;
    let steps = 0;

    while (ip < lines.length) {
      if (abortRequested) {
        log("[VBX Studio] Execution aborted by user.", "stderr");
        setRunningState(false);
        return;
      }

      steps++;
      if (steps > maxSteps) {
        log("[Error] Execution step limit exceeded (possible infinite loop).", "stderr");
        setRunningState(false);
        return;
      }

      const rawLine = lines[ip];
      const line = rawLine.trim();

      if (!line || line.startsWith("'") || line.toLowerCase().startsWith("rem ")) {
        ip++;
        continue;
      }

      if (/^(Sub|Function|End Sub|End Function)\b/i.test(line)) {
        ip++;
        continue;
      }

      // For loop
      const forMatch = line.match(/^For\s+([a-zA-Z0-9_]+)\s*=\s*(.+?)\s+To\s+(.+?)(?:\s+Step\s+(.+?))?$/i);
      if (forMatch) {
        const varName = forMatch[1];
        const startVal = Number(evaluateJSExpr(forMatch[2], vars));
        const endVal = Number(evaluateJSExpr(forMatch[3], vars));
        const stepVal = forMatch[4] ? Number(evaluateJSExpr(forMatch[4], vars)) : 1;

        let nest = 1;
        let nextIp = ip + 1;
        while (nextIp < lines.length) {
          const l = lines[nextIp].trim();
          if (/^For\s+/i.test(l)) nest++;
          if (/^Next\b/i.test(l)) {
            nest--;
            if (nest === 0) break;
          }
          nextIp++;
        }

        if (nextIp >= lines.length) {
          log("Line " + (ip + 1) + ": Syntax error - For without Next", "stderr");
          setRunningState(false);
          return;
        }

        vars[varName] = startVal;
        const loopBodyLines = lines.slice(ip + 1, nextIp);

        while ((stepVal > 0 && vars[varName] <= endVal) || (stepVal < 0 && vars[varName] >= endVal)) {
          for (let bodyLine of loopBodyLines) {
            if (abortRequested) {
              log("[VBX Studio] Execution aborted by user.", "stderr");
              setRunningState(false);
              return;
            }
            await executeSingleVBXLine(bodyLine.trim(), vars, log);
          }
          vars[varName] += stepVal;
        }

        ip = nextIp + 1;
        continue;
      }

      // Do While/Until
      const doMatch = line.match(/^Do\s+(While|Until)\s+(.+)$/i);
      if (doMatch) {
        const mode = doMatch[1].toLowerCase();
        const condExpr = doMatch[2];

        let nest = 1;
        let loopEndIp = ip + 1;
        while (loopEndIp < lines.length) {
          const l = lines[loopEndIp].trim();
          if (/^Do\s+(While|Until)/i.test(l)) nest++;
          if (/^Loop\b/i.test(l)) {
            nest--;
            if (nest === 0) break;
          }
          loopEndIp++;
        }

        if (loopEndIp >= lines.length) {
          log("Line " + (ip + 1) + ": Syntax error - Do without Loop", "stderr");
          setRunningState(false);
          return;
        }

        const loopBodyLines = lines.slice(ip + 1, loopEndIp);

        const checkCond = () => {
          const condVal = Boolean(evaluateJSExpr(condExpr, vars));
          return mode === "while" ? condVal : !condVal;
        };

        while (checkCond()) {
          steps++;
          if (steps > maxSteps) {
            log("[Error] Execution step limit exceeded in Do loop.", "stderr");
            setRunningState(false);
            return;
          }
          for (let bodyLine of loopBodyLines) {
            if (abortRequested) {
              log("[VBX Studio] Execution aborted by user.", "stderr");
              setRunningState(false);
              return;
            }
            await executeSingleVBXLine(bodyLine.trim(), vars, log);
          }
        }

        ip = loopEndIp + 1;
        continue;
      }

      // While ... Wend
      const whileMatch = line.match(/^While\s+(.+)$/i);
      if (whileMatch) {
        const condExpr = whileMatch[1];
        let nest = 1;
        let wendIp = ip + 1;
        while (wendIp < lines.length) {
          const l = lines[wendIp].trim();
          if (/^While\s+/i.test(l)) nest++;
          if (/^Wend\b/i.test(l)) {
            nest--;
            if (nest === 0) break;
          }
          wendIp++;
        }

        if (wendIp >= lines.length) {
          log("Line " + (ip + 1) + ": Syntax error - While without Wend", "stderr");
          setRunningState(false);
          return;
        }

        const loopBodyLines = lines.slice(ip + 1, wendIp);

        while (Boolean(evaluateJSExpr(condExpr, vars))) {
          steps++;
          if (steps > maxSteps) {
            log("[Error] Execution step limit exceeded in While loop.", "stderr");
            setRunningState(false);
            return;
          }
          for (let bodyLine of loopBodyLines) {
            if (abortRequested) {
              log("[VBX Studio] Execution aborted by user.", "stderr");
              setRunningState(false);
              return;
            }
            await executeSingleVBXLine(bodyLine.trim(), vars, log);
          }
        }

        ip = wendIp + 1;
        continue;
      }

      await executeSingleVBXLine(line, vars, log);
      ip++;
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(3) + "s";
    log("[VBX Studio] Execution finished successfully (Duration: " + duration + ")", "system");
    setRunningState(false);
  }

  // Client-Side VB6 Importer (.frm, .vbp, .bas)
  function mapVB6ControlType(vbType) {
    switch (vbType) {
      case "VB.CommandButton": return "Button";
      case "VB.TextBox": return "TextBox";
      case "VB.Label": return "Label";
      case "VB.CheckBox": return "CheckBox";
      case "VB.Frame": return "Frame";
      case "VB.Image": return "Image";
      case "VB.Timer": return "Timer";
      case "VB.ComboBox": return "ComboBox";
      case "VB.ListBox": return "ListBox";
      case "VB.OptionButton": return "OptionButton";
      case "VB.PictureBox": return "PictureBox";
      case "MSComctlLib.ProgBar":
      case "VB.ProgressBar": return "ProgressBar";
      default:
        if (vbType.startsWith("VB.")) return vbType.slice(3);
        return vbType;
    }
  }

  function parseKeyValuePair(line) {
    const idx = line.indexOf("=");
    if (idx === -1) return null;
    return { key: line.slice(0, idx).trim(), val: line.slice(idx + 1).trim() };
  }

  function parseVB6String(val) {
    val = val.trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
      val = val.slice(1, -1).replace(/""/g, '"');
    }
    return val;
  }

  function parseTwips(val) {
    val = val.trim();
    if (val.startsWith("&H")) {
      const clean = val.slice(2).replace(/&$/, "");
      const n = parseInt(clean, 16);
      if (!isNaN(n)) return Math.floor(n / 15);
    }
    const n = parseInt(val, 10);
    if (!isNaN(n)) return Math.floor(n / 15);
    return 0;
  }

  function parseBool(val) {
    val = val.trim().toLowerCase();
    return !(val === "0" || val === "false");
  }

  function parseFRMClientSide(content, filename) {
    let projName = filename ? filename.replace(/\.[^/.]+$/, "") : "ImportedProject";
    if (!projName) projName = "ImportedProject";

    const proj = {
      version: "1.0",
      projectName: projName,
      form: {
        name: "Form1",
        caption: "Form1",
        width: 600,
        height: 400,
        backColor: "#0b0f19"
      },
      controls: [],
      code: ""
    };

    const lines = content.split("\n");
    const stack = [];
    const codeLines = [];
    let inCodeSection = false;

    for (let rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      const trimmedLine = line.trim();

      if (inCodeSection) {
        if (trimmedLine.toLowerCase().startsWith("attribute ")) continue;
        codeLines.push(line);
        continue;
      }

      if (!trimmedLine) continue;

      if (trimmedLine.startsWith("Begin ")) {
        const parts = trimmedLine.split(/\s+/);
        if (parts.length >= 2) {
          const vbType = parts[1];
          const name = parts[2] || "";

          if (vbType === "VB.Form") {
            if (name) {
              proj.form.name = name;
              proj.form.caption = name;
            }
            stack.push({ kind: "form" });
          } else {
            const ctrlType = mapVB6ControlType(vbType);
            const ctrlName = name || `${ctrlType}${proj.controls.length + 1}`;
            const ctrl = {
              id: ctrlName,
              type: ctrlType,
              caption: ctrlName,
              text: ctrlName,
              left: 0,
              top: 0,
              width: 100,
              height: 32,
              visible: true,
              enabled: true
            };
            proj.controls.push(ctrl);
            stack.push({ kind: "control", controlIdx: proj.controls.length - 1 });
          }
        }
        continue;
      }

      if (trimmedLine === "End") {
        if (stack.length > 0) {
          const top = stack.pop();
          if (top.kind === "form") {
            inCodeSection = true;
          }
        }
        continue;
      }

      if (stack.length > 0) {
        const kv = parseKeyValuePair(trimmedLine);
        if (kv) {
          const top = stack[stack.length - 1];
          if (top.kind === "form") {
            const k = kv.key.toLowerCase();
            if (k === "caption") proj.form.caption = parseVB6String(kv.val);
            else if (k === "clientwidth") { const w = parseTwips(kv.val); if (w > 0) proj.form.width = w; }
            else if (k === "clientheight") { const h = parseTwips(kv.val); if (h > 0) proj.form.height = h; }
            else if (k === "backcolor") proj.form.backColor = kv.val;
          } else if (top.kind === "control") {
            const ctrl = proj.controls[top.controlIdx];
            const k = kv.key.toLowerCase();
            if (k === "caption") ctrl.caption = parseVB6String(kv.val);
            else if (k === "text") ctrl.text = parseVB6String(kv.val);
            else if (k === "left") ctrl.left = parseTwips(kv.val);
            else if (k === "top") ctrl.top = parseTwips(kv.val);
            else if (k === "width") ctrl.width = parseTwips(kv.val);
            else if (k === "height") ctrl.height = parseTwips(kv.val);
            else if (k === "visible") ctrl.visible = parseBool(kv.val);
            else if (k === "enabled") ctrl.enabled = parseBool(kv.val);
          }
        }
      }
    }

    proj.code = codeLines.join("\n").trim();
    return proj;
  }

  function parseVBPClientSide(content, filename) {
    let projName = filename ? filename.replace(/\.[^/.]+$/, "") : "LegacyProject";

    let title = "";
    let name = "";
    const forms = [];
    const modules = [];

    const lines = content.split("\n");
    for (let rawLine of lines) {
      const line = rawLine.replace(/\r$/, "").trim();
      if (!line || line.startsWith(";")) continue;

      const kv = parseKeyValuePair(line);
      if (!kv) continue;

      const k = kv.key.toLowerCase();
      if (k === "title") title = parseVB6String(kv.val);
      else if (k === "name") name = parseVB6String(kv.val);
      else if (k === "form") forms.push(parseVB6String(kv.val));
      else if (k === "module") modules.push(parseVB6String(kv.val));
    }

    if (title) projName = title;
    else if (name) projName = name;

    const codeLines = [
      `' Imported Legacy VB6 Project: ${projName}`
    ];
    if (forms.length > 0) codeLines.push(`' Forms: ${forms.join(", ")}`);
    if (modules.length > 0) codeLines.push(`' Modules: ${modules.join(", ")}`);
    codeLines.push("", "Sub Main()", `    Print "Loaded legacy project: ${projName}"`, "End Sub");

    return {
      version: "1.0",
      projectName: projName,
      form: {
        name: "Form1",
        caption: projName,
        width: 600,
        height: 400,
        backColor: "#0b0f19"
      },
      controls: [],
      code: codeLines.join("\n")
    };
  }

  function parseBASClientSide(content, filename) {
    let projName = filename ? filename.replace(/\.[^/.]+$/, "") : "Module1";

    const lines = content.split("\n");
    const codeLines = [];

    for (let rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      const trimmedLine = line.trim();

      if (trimmedLine.toLowerCase().startsWith("attribute ")) continue;
      codeLines.push(line);
    }

    return {
      version: "1.0",
      projectName: projName,
      form: {
        name: "Form1",
        caption: projName,
        width: 600,
        height: 400,
        backColor: "#0b0f19"
      },
      controls: [],
      code: codeLines.join("\n").trim()
    };
  }

  function parseVB6ClientSide(content, filename) {
    let ext = "";
    if (filename && filename.includes(".")) {
      ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
    }
    if (!ext) {
      if (content.includes("Begin VB.Form")) ext = ".frm";
      else if (content.includes("Type=Exe") || content.includes("Form=")) ext = ".vbp";
      else ext = ".bas";
    }

    if (ext === ".vbp") return parseVBPClientSide(content, filename);
    if (ext === ".bas") return parseBASClientSide(content, filename);
    return parseFRMClientSide(content, filename);
  }

  // Setup Server-Sent Events (SSE) for execution logs
  function setupSSE() {
    try {
      const eventSource = new EventSource("/api/events");

      eventSource.onmessage = (event) => {
        try {
          const line = JSON.parse(event.data);
          appendConsoleLine(line.Text, line.Stream);
          if (line.Stream === "system" && (line.Text.includes("[VBX Studio] Execution finished") || line.Text.includes("Process exited"))) {
            setRunningState(false);
          }
        } catch (e) {
          console.error("Failed to parse SSE line:", e);
        }
      };

      eventSource.onerror = () => {
        // Quietly close SSE if running on static host (e.g., GitHub Pages) where /api/events is unavailable
        eventSource.close();
      };
    } catch (e) {
      // EventSource not supported or unavailable
    }
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

    if (isStaticHosting()) {
      runClientSideVBX(code);
      return;
    }

    try {
      const response = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });

      if (!response.ok) {
        if (response.status === 405) {
          // GitHub Pages or static host returning Method Not Allowed for POST -> fallback cleanly to client-side
          runClientSideVBX(code);
        } else {
          const errText = await response.text();
          appendConsoleLine(`[Error] Execution failed: ${errText}`, "stderr");
          setRunningState(false);
        }
      }
    } catch (err) {
      // Backend unavailable or network error -> Fallback to client-side JS runner
      runClientSideVBX(code);
    }
  });

  // Handle Stop
  btnStop.addEventListener("click", async () => {
    abortRequested = true;
    try {
      await fetch("/api/stop", { method: "POST" });
      appendConsoleLine("[VBX Studio] Stop request sent.", "system");
    } catch (err) {
      appendConsoleLine("[VBX Studio] Stop request set (client-side execution aborted).", "system");
      setRunningState(false);
    }
  });

  const btnOpen = document.getElementById("btn-open");
  const projectFileInput = document.getElementById("project-file-input");
  const vb6FileInput = document.getElementById("vb6-file-input");
  const menuOpenProject = document.getElementById("menu-open-project");
  const menuImportVB6 = document.getElementById("menu-import-vb6");
  const menuExportHTML = document.getElementById("menu-export-html");

  // Save Project (.vbxp)
  async function saveProject() {
    const code = editor.getValue();
    const projectName = state.form.name || "Project1";
    const fileName = `${projectName}.vbxp`;

    const projectData = {
      version: "1.0",
      projectName: projectName,
      form: {
        name: state.form.name || "Form1",
        caption: state.form.caption || state.form.name || "Form1",
        width: state.form.width || 600,
        height: state.form.height || 400,
        backColor: state.form.backColor || "#0b0f19"
      },
      controls: state.controls.map((c) => ({
        id: c.id,
        type: c.type,
        caption: c.caption !== undefined ? c.caption : c.name,
        left: c.left,
        top: c.top,
        width: c.width,
        height: c.height,
        visible: c.visible !== undefined ? c.visible : true,
        enabled: c.enabled !== undefined ? c.enabled : true
      })),
      code: code
    };

    // Download file in browser using HTML5 Blob download
    const jsonStr = JSON.stringify(projectData, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    appendConsoleLine(`[VBX Studio] Project saved successfully to ${fileName}`, "system");

    // Optionally sync with backend API if available
    try {
      await fetch("/api/project/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: fileName, project: projectData })
      });
    } catch (err) {
      // Ignore network errors in static host / offline mode
    }

    currentFilename.textContent = fileName;
  }

  // Load / Open Project (.vbxp)
  function loadProject(project, fileName) {
    if (!project) return;

    if (project.form) {
      state.form.name = project.form.name || "Form1";
      state.form.caption = project.form.caption || project.form.name || "Form1";
      state.form.width = project.form.width || 600;
      state.form.height = project.form.height || 400;
      state.form.backColor = project.form.backColor || "#0b0f19";
    }

    if (Array.isArray(project.controls)) {
      state.controls = project.controls.map((c) => ({
        id: c.id || c.name,
        type: c.type || "Button",
        name: c.id || c.name,
        caption: c.caption !== undefined ? c.caption : (c.text !== undefined ? c.text : c.id),
        text: c.text !== undefined ? c.text : c.caption,
        left: c.left || 0,
        top: c.top || 0,
        width: c.width || 100,
        height: c.height || 32,
        visible: c.visible !== undefined ? c.visible : true,
        enabled: c.enabled !== undefined ? c.enabled : true
      }));

      // Update control indices so newly created controls don't conflict
      const indices = { Button: 1, TextBox: 1, Label: 1, CheckBox: 1, Frame: 1, Image: 1, Timer: 1 };
      state.controls.forEach((c) => {
        const match = c.id && c.id.match(/^([A-Za-z]+)(\d+)$/);
        if (match) {
          const type = match[1];
          const num = parseInt(match[2], 10);
          if (indices[type] !== undefined && num >= indices[type]) {
            indices[type] = num + 1;
          }
        }
      });
      state.nextControlIndices = indices;
    } else {
      state.controls = [];
    }

    if (project.code !== undefined) {
      editor.setValue(project.code);
    }

    state.selectedId = "Form1";
    const displayFile = fileName || (project.projectName ? `${project.projectName}.vbxp` : "project.vbxp");
    currentFilename.textContent = displayFile;

    // Switch to Design View to immediately show restored visual form
    tabDesign.click();
    renderDesigner();

    appendConsoleLine(`[VBX Studio] Loaded project: ${displayFile}`, "system");
  }

  // Event Listeners for Save and Open
  btnSave.addEventListener("click", () => {
    saveProject();
  });

  if (btnOpen) {
    btnOpen.addEventListener("click", () => {
      projectFileInput.click();
    });
  }

  if (menuOpenProject) {
    menuOpenProject.addEventListener("click", () => {
      projectFileInput.click();
    });
  }

  if (menuImportVB6) {
    menuImportVB6.addEventListener("click", () => {
      vb6FileInput.click();
    });
  }

  if (projectFileInput) {
    projectFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const projectData = JSON.parse(event.target.result);
          loadProject(projectData, file.name);
        } catch (err) {
          appendConsoleLine(`[Error] Failed to parse .vbxp project file: ${err.message}`, "stderr");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
  }

  if (vb6FileInput) {
    vb6FileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const content = event.target.result;
        let projectData = null;

        try {
          const response = await fetch(`/api/project/import-vb6?filename=${encodeURIComponent(file.name)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filename: file.name, content: content })
          });

          if (response.ok) {
            projectData = await response.json();
          }
        } catch (err) {
          // Backend offline / static mode -> Fall back to pure JS client-side parser
        }

        if (!projectData) {
          try {
            projectData = parseVB6ClientSide(content, file.name);
          } catch (parseErr) {
            appendConsoleLine(`[Error] Failed to import VB6 file: ${parseErr.message}`, "stderr");
            e.target.value = "";
            return;
          }
        }

        loadProject(projectData, `${projectData.projectName || "imported"}.vbxp`);
        appendConsoleLine(`[VBX Studio] Successfully imported legacy VB6 project: ${projectData.projectName || file.name}`, "system");
        e.target.value = "";
      };
      reader.readAsText(file);
    });
  }

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
    renderDesigner();
  });

  // Toolbox Items Selection & Drag-and-Drop
  toolboxItems.forEach((item) => {
    item.addEventListener("click", () => {
      toolboxItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");
      state.activeTool = item.getAttribute("data-control-type") || "Pointer";
    });

    item.addEventListener("dragstart", (e) => {
      const toolType = item.getAttribute("data-control-type");
      if (toolType && toolType !== "Pointer") {
        e.dataTransfer.setData("text/plain", toolType);
      } else {
        e.preventDefault();
      }
    });
  });

    if (menuExportHTML) {
    menuExportHTML.addEventListener("click", () => {
      exportHTMLApp();
    });
  }

  function exportHTMLApp() {
    const projName = state.projectName || "Project1";
    const form = state.form;
    const controls = state.controls;
    const vbxCode = editor.getValue();

    let controlsHTML = "";
    controls.forEach(ctrl => {
      let content = "";
      if (ctrl.type === "Button") {
        content = `<button class="vbx-btn" onclick="triggerEvent('${ctrl.id}_Click')">${ctrl.caption || ctrl.name}</button>`;
      } else if (ctrl.type === "TextBox") {
        content = `<input type="text" class="vbx-input" id="input-${ctrl.id}" value="${ctrl.text !== undefined ? ctrl.text : (ctrl.caption || ctrl.name)}" oninput="updateControlProp('${ctrl.id}', 'Text', this.value)" />`;
      } else if (ctrl.type === "Label") {
        content = `<span id="label-${ctrl.id}">${ctrl.caption || ctrl.name}</span>`;
      } else if (ctrl.type === "CheckBox") {
        content = `<label class="vbx-checkbox-label"><input type="checkbox" id="chk-${ctrl.id}" onchange="updateControlProp('${ctrl.id}', 'Value', this.checked ? 1 : 0); triggerEvent('${ctrl.id}_Click')" /> <span>${ctrl.caption || ctrl.name}</span></label>`;
      } else if (ctrl.type === "Frame") {
        content = `<fieldset class="vbx-fieldset"><legend>${ctrl.caption || ctrl.name}</legend></fieldset>`;
      } else if (ctrl.type === "Image") {
        content = `<div class="vbx-image-box">📷 <span>${ctrl.caption || ctrl.name}</span></div>`;
      } else if (ctrl.type === "Timer") {
        content = `<div class="vbx-timer-box">⏱ <span>${ctrl.caption || ctrl.name}</span></div>`;
      } else if (ctrl.type === "ComboBox") {
        content = `<select class="vbx-select" id="combo-${ctrl.id}" onchange="updateControlProp('${ctrl.id}', 'Text', this.value); triggerEvent('${ctrl.id}_Click')"><option>${ctrl.text !== undefined ? ctrl.text : (ctrl.caption || ctrl.name)}</option></select>`;
      } else if (ctrl.type === "ListBox") {
        content = `<select multiple class="vbx-listbox" id="list-${ctrl.id}" onchange="triggerEvent('${ctrl.id}_Click')"><option selected>${ctrl.text !== undefined ? ctrl.text : (ctrl.caption || ctrl.name)} Item 1</option><option>${ctrl.text !== undefined ? ctrl.text : (ctrl.caption || ctrl.name)} Item 2</option></select>`;
      } else if (ctrl.type === "OptionButton") {
        content = `<label class="vbx-option-label"><input type="radio" name="opt_group" id="opt-${ctrl.id}" onchange="triggerEvent('${ctrl.id}_Click')" /> <span>${ctrl.caption || ctrl.name}</span></label>`;
      } else if (ctrl.type === "ProgressBar") {
        content = `<div class="vbx-progress-track"><div class="vbx-progress-fill" id="pbar-${ctrl.id}" style="width: 50%;"></div></div>`;
      } else if (ctrl.type === "PictureBox") {
        content = `<div class="vbx-picture-box" id="pic-${ctrl.id}">🎨 <span>${ctrl.caption || ctrl.name}</span></div>`;
      }

      const visStyle = ctrl.visible ? "" : "display: none;";
      const disAttr = ctrl.enabled ? "" : "disabled";

      controlsHTML += `
        <div class="standalone-control control-type-${ctrl.type.toLowerCase()}" id="ctrl-${ctrl.id}" style="left: ${ctrl.left}px; top: ${ctrl.top}px; width: ${ctrl.width}px; height: ${ctrl.height}px; ${visStyle}" ${disAttr}>
          ${content}
        </div>`;
    });

    const htmlBundle = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${projName} - Standalone VBX App</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background-color: #080b12; color: #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .standalone-window { position: relative; background-color: #121826; border: 1px solid #00e5ff; border-radius: 6px; box-shadow: 0 10px 30px rgba(0,229,255,0.2); width: ${form.width}px; height: ${form.height}px; overflow: hidden; touch-action: none; }
    .titlebar { background-color: #1e273d; padding: 8px 12px; font-weight: bold; font-size: 13px; color: #b388ff; border-bottom: 1px solid #232d42; display: flex; justify-content: space-between; align-items: center; }
    .window-body { position: relative; width: 100%; height: calc(100% - 33px); background-image: radial-gradient(#232d42 1px, transparent 1px); background-size: 8px 8px; }
    .standalone-control { position: absolute; display: flex; align-items: center; justify-content: center; font-size: 12px; }
    .vbx-btn { width: 100%; height: 100%; background: rgba(0, 229, 255, 0.15); color: #00e5ff; border: 1px solid #00e5ff; border-radius: 4px; font-weight: bold; cursor: pointer; transition: background 0.15s; }
    .vbx-btn:active { background: rgba(0, 229, 255, 0.35); }
    .vbx-input { width: 100%; height: 100%; background: #0b0f19; color: #00e5ff; border: 1px solid #232d42; padding: 0 6px; border-radius: 3px; font-family: monospace; }
    .vbx-checkbox-label, .vbx-option-label { display: flex; align-items: center; gap: 6px; cursor: pointer; color: #e2e8f0; width: 100%; }
    .vbx-fieldset { width: 100%; height: 100%; border: 1px solid #232d42; padding: 6px; border-radius: 3px; }
    .vbx-fieldset legend { color: #b388ff; padding: 0 4px; font-size: 11px; }
    .vbx-image-box, .vbx-picture-box { width: 100%; height: 100%; background: rgba(18, 24, 38, 0.8); border: 1px solid #232d42; display: flex; align-items: center; justify-content: center; gap: 6px; color: #b388ff; border-radius: 3px; }
    .vbx-timer-box { width: 100%; height: 100%; background: rgba(179, 136, 255, 0.1); border: 1px solid #b388ff; display: flex; align-items: center; justify-content: center; gap: 4px; color: #b388ff; border-radius: 3px; }
    .vbx-select, .vbx-listbox { width: 100%; height: 100%; background: #0b0f19; color: #00e5ff; border: 1px solid #232d42; border-radius: 3px; padding: 2px; }
    .vbx-progress-track { width: 100%; height: 100%; background: #0b0f19; border: 1px solid #232d42; border-radius: 3px; overflow: hidden; position: relative; }
    .vbx-progress-fill { height: 100%; background: linear-gradient(90deg, #b388ff, #00e5ff); }
    .console-toast { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #121826; border: 1px solid #00e5ff; color: #00e5ff; padding: 10px 20px; border-radius: 20px; font-family: monospace; font-size: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); opacity: 0; transition: opacity 0.3s; pointer-events: none; }
    .console-toast.show { opacity: 1; }
  </style>
</head>
<body>
  <div class="standalone-window">
    <div class="titlebar">
      <span>${form.caption || form.name}</span>
      <span>×</span>
    </div>
    <div class="window-body">
      ${controlsHTML}
    </div>
  </div>
  <div id="toast" class="console-toast"></div>

  <script>
    const controlProps = {};

    function updateControlProp(id, prop, value) {
      if (!controlProps[id]) controlProps[id] = {};
      controlProps[id][prop] = value;
    }

    function showToast(msg) {
      const toast = document.getElementById("toast");
      toast.textContent = msg;
      toast.classList.add("show");
      setTimeout(() => toast.classList.remove("show"), 2500);
    }

    function triggerEvent(handlerName) {
      console.log("Trigger event: " + handlerName);
      const code = ${JSON.stringify(vbxCode)};
      const lines = code.split("\n");

      let inSub = false;
      let subLines = [];

      for (let line of lines) {
        const trimmed = line.trim();
        if (new RegExp("^Sub\\s+" + handlerName + "\\s*\\(\\)", "i").test(trimmed)) {
          inSub = true;
          continue;
        }
        if (inSub) {
          if (/^End\s+Sub$/i.test(trimmed)) {
            break;
          }
          subLines.push(line);
        }
      }

      if (subLines.length > 0) {
        executeSubLines(subLines);
      } else {
        showToast("Executed: " + handlerName + "()");
      }
    }

    function executeSubLines(lines) {
      const vars = {};
      for (let rawLine of lines) {
        let line = rawLine.trim();
        if (!line || line.startsWith("'") || line.startsWith("Rem")) continue;

        if (line.toLowerCase().startsWith("print ")) {
          const expr = line.substring(6).trim();
          showToast("Print: " + evaluateExpr(expr, vars));
        } else if (line.toLowerCase().startsWith("msgbox ")) {
          const expr = line.substring(7).trim();
          alert(evaluateExpr(expr, vars));
        } else if (line.toLowerCase().startsWith("dim ")) {
          const decl = line.substring(4).trim();
          const eqIdx = decl.indexOf("=");
          if (eqIdx !== -1) {
            vars[decl.substring(0, eqIdx).trim()] = evaluateExpr(decl.substring(eqIdx + 1).trim(), vars);
          } else {
            vars[decl] = "";
          }
        }
      }
    }

    function evaluateExpr(expr, vars) {
      expr = expr.trim();
      if ((expr.startsWith('"') && expr.endsWith('"')) || (expr.startsWith("'") && expr.endsWith("'"))) {
        return expr.slice(1, -1);
      }
      if (!isNaN(Number(expr))) return Number(expr);
      if (vars[expr] !== undefined) return vars[expr];
      if (expr.includes("&")) {
        return expr.split("&").map(p => evaluateExpr(p, vars)).join("");
      }
      return expr;
    }
  </script>
</body>
</html>`;

    const blob = new Blob([htmlBundle], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projName}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    logConsole("system", `[VBX Studio] Standalone HTML app exported: ${projName}.html`);
  }

  function resetToolboxToPointer() {
    state.activeTool = "Pointer";
    toolboxItems.forEach((i) => {
      if (i.getAttribute("data-control-type") === "Pointer") {
        i.classList.add("active");
      } else {
        i.classList.remove("active");
      }
    });
  }

  // Helper to create controls
  function createControl(type, left, top) {
    if (!state.nextControlIndices[type]) {
      state.nextControlIndices[type] = 1;
    }
    const seqNum = state.nextControlIndices[type]++;
    const name = `${type}${seqNum}`;

    let width = 100;
    let height = 32;
    if (type === "TextBox") { width = 120; height = 28; }
    else if (type === "Label") { width = 80; height = 24; }
    else if (type === "CheckBox") { width = 100; height = 24; }
    else if (type === "Frame") { width = 160; height = 120; }
    else if (type === "Image") { width = 80; height = 80; }
    else if (type === "Timer") { width = 32; height = 32; }
    else if (type === "ComboBox") { width = 120; height = 28; }
    else if (type === "ListBox") { width = 120; height = 80; }
    else if (type === "OptionButton") { width = 110; height = 24; }
    else if (type === "ProgressBar") { width = 140; height = 24; }
    else if (type === "PictureBox") { width = 120; height = 100; }

    const newControl = {
      id: name,
      type: type,
      name: name,
      caption: name,
      text: name,
      left: snapToGrid(left),
      top: snapToGrid(top),
      width: width,
      height: height,
      visible: true,
      enabled: true
    };

    state.controls.push(newControl);
    state.selectedId = newControl.id;
    renderDesigner();
  }

  // Canvas Drag & Drop and Click Insertion
  formBody.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });

  formBody.addEventListener("drop", (e) => {
    e.preventDefault();
    const toolType = e.dataTransfer.getData("text/plain");
    if (toolType && toolType !== "Pointer") {
      const rect = formBody.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      createControl(toolType, rawX, rawY);
      resetToolboxToPointer();
    }
  });

  formBody.addEventListener("click", (e) => {
    if (state.activeTool !== "Pointer" && e.target === formBody) {
      const rect = formBody.getBoundingClientRect();
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      createControl(state.activeTool, rawX, rawY);
      resetToolboxToPointer();
    } else if (e.target === formBody) {
      state.selectedId = "Form1";
      renderDesigner();
    }
  });

  // Select Form1 on Titlebar or Form click
  designerForm.addEventListener("click", (e) => {
    if (e.target === designerForm || formTitlebar.contains(e.target)) {
      state.selectedId = "Form1";
      renderDesigner();
    }
  });

  // Render Visual Designer Canvas
  // Double-tap helper for touch/pointer devices
  let lastTapTime = 0;
  let lastTapTarget = null;

  function checkDoubleTap(e, targetObj) {
    const now = Date.now();
    const timeDiff = now - lastTapTime;
    if (timeDiff < 300 && lastTapTarget === targetObj) {
      lastTapTime = 0;
      lastTapTarget = null;
      doubleClickControl(targetObj);
      return true;
    }
    lastTapTime = now;
    lastTapTarget = targetObj;
    return false;
  }

  function renderDesigner() {
    // Update Form Position and Dimensions
    designerForm.style.left = `${state.form.left}px`;
    designerForm.style.top = `${state.form.top}px`;
    designerForm.style.width = `${state.form.width}px`;
    designerForm.style.height = `${state.form.height}px`;

    formTitleText.textContent = state.form.caption || state.form.name;

    if (state.selectedId === "Form1") {
      designerForm.classList.add("selected");
    } else {
      designerForm.classList.remove("selected");
    }

    // Render Controls in Form Body
    formBody.innerHTML = "";

    state.controls.forEach((ctrl) => {
      const ctrlEl = document.createElement("div");
      ctrlEl.className = `designer-control control-type-${ctrl.type.toLowerCase()}`;
      if (ctrl.id === state.selectedId) {
        ctrlEl.classList.add("selected");
      }
      if (!ctrl.visible) {
        ctrlEl.classList.add("hidden-control");
      }
      if (!ctrl.enabled) {
        ctrlEl.classList.add("disabled");
      }

      ctrlEl.style.left = `${ctrl.left}px`;
      ctrlEl.style.top = `${ctrl.top}px`;
      ctrlEl.style.width = `${ctrl.width}px`;
      ctrlEl.style.height = `${ctrl.height}px`;
      ctrlEl.setAttribute("data-control-id", ctrl.id);

      // Inner Content Rendering
      if (ctrl.type === "Button") {
        ctrlEl.textContent = ctrl.caption || ctrl.name;
      } else if (ctrl.type === "TextBox") {
        ctrlEl.textContent = ctrl.text !== undefined ? ctrl.text : ctrl.caption;
      } else if (ctrl.type === "Label") {
        ctrlEl.textContent = ctrl.caption || ctrl.name;
      } else if (ctrl.type === "CheckBox") {
        ctrlEl.innerHTML = `<span class="control-type-checkbox-box">✓</span><span>${ctrl.caption || ctrl.name}</span>`;
      } else if (ctrl.type === "Frame") {
        ctrlEl.innerHTML = `<span class="control-type-frame-caption">${ctrl.caption || ctrl.name}</span>`;
      } else if (ctrl.type === "Image") {
        ctrlEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>${ctrl.caption || ctrl.name}</span>`;
      } else if (ctrl.type === "Timer") {
        ctrlEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polyline points="12 6 12 16 14"/></svg><span>${ctrl.caption || ctrl.name}</span>`;
      } else if (ctrl.type === "ComboBox") {
        ctrlEl.innerHTML = `<span>${ctrl.text !== undefined ? ctrl.text : (ctrl.caption || ctrl.name)}</span><span class="control-type-combobox-arrow">▼</span>`;
      } else if (ctrl.type === "ListBox") {
        const itemText = ctrl.text !== undefined ? ctrl.text : (ctrl.caption || ctrl.name);
        ctrlEl.innerHTML = `<div class="control-type-listbox-item selected">${itemText} Item 1</div><div class="control-type-listbox-item">${itemText} Item 2</div>`;
      } else if (ctrl.type === "OptionButton") {
        ctrlEl.innerHTML = `<span class="control-type-option-circle"><span class="control-type-option-circle-dot"></span></span><span>${ctrl.caption || ctrl.name}</span>`;
      } else if (ctrl.type === "ProgressBar") {
        ctrlEl.innerHTML = `<div class="control-type-progressbar-fill"></div>`;
      } else if (ctrl.type === "PictureBox") {
        ctrlEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/><polygon points="5,19 10,11 15,16 19,10 21,19"/></svg><span>${ctrl.caption || ctrl.name}</span>`;
      }

      // Selection Resize Handles on Control
      if (ctrl.id === state.selectedId) {
        const handles = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
        handles.forEach((h) => {
          const handleEl = document.createElement("div");
          handleEl.className = `resize-handle handle-${h}`;
          handleEl.setAttribute("data-handle", h);
          handleEl.setAttribute("data-target-id", ctrl.id);
          ctrlEl.appendChild(handleEl);
        });
      }

      // Event Listeners on Control
      ctrlEl.addEventListener("pointerdown", (e) => {
        if (e.target.classList.contains("resize-handle")) {
          return;
        }
        e.stopPropagation();
        state.selectedId = ctrl.id;
        renderDesigner();

        if (checkDoubleTap(e, ctrl)) {
          return;
        }

        initControlDrag(e, ctrl);
      });

      ctrlEl.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        doubleClickControl(ctrl);
      });

      formBody.appendChild(ctrlEl);
    });

    renderPropertiesPanel();
  }

  // Form Double Click and Double Tap
  designerForm.addEventListener("dblclick", (e) => {
    if (e.target === designerForm || formTitlebar.contains(e.target)) {
      e.stopPropagation();
      doubleClickControl(state.form);
    }
  });

  designerForm.addEventListener("pointerdown", (e) => {
    if (e.target === designerForm || formTitlebar.contains(e.target)) {
      if (!e.target.classList.contains("control-box-btn") && !e.target.classList.contains("resize-handle")) {
        checkDoubleTap(e, state.form);
      }
    }
  });

  // Moving Controls
  function initControlDrag(e, ctrl) {
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = ctrl.left;
    const initTop = ctrl.top;

    function onPointerMove(moveEv) {
      if (moveEv.pointerId !== pointerId) return;
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;
      ctrl.left = Math.max(0, snapToGrid(initLeft + dx));
      ctrl.top = Math.max(0, snapToGrid(initTop + dy));

      const ctrlEl = formBody.querySelector(`[data-control-id="${ctrl.id}"]`);
      if (ctrlEl) {
        ctrlEl.style.left = `${ctrl.left}px`;
        ctrlEl.style.top = `${ctrl.top}px`;
      }
      updatePropertiesInputs();
    }

    function onPointerUp(upEv) {
      if (upEv.pointerId !== pointerId) return;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      renderDesigner();
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  }

  // Moving Form1 Titlebar Drag
  formTitlebar.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("control-box-btn")) return;
    e.stopPropagation();
    state.selectedId = "Form1";
    renderDesigner();

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = state.form.left;
    const initTop = state.form.top;

    function onPointerMove(moveEv) {
      if (moveEv.pointerId !== pointerId) return;
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;
      state.form.left = Math.max(0, snapToGrid(initLeft + dx));
      state.form.top = Math.max(0, snapToGrid(initTop + dy));

      designerForm.style.left = `${state.form.left}px`;
      designerForm.style.top = `${state.form.top}px`;
      updatePropertiesInputs();
    }

    function onPointerUp(upEv) {
      if (upEv.pointerId !== pointerId) return;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      renderDesigner();
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  });

  // Resizing Controls and Form via Handles
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.classList.contains("resize-handle")) return;
    e.stopPropagation();

    const handleDir = e.target.getAttribute("data-handle");
    const targetId = e.target.getAttribute("data-target-id");

    let isForm = false;
    let targetObj = null;

    if (!targetId || targetId === "Form1") {
      isForm = true;
      targetObj = state.form;
    } else {
      targetObj = state.controls.find((c) => c.id === targetId);
    }

    if (!targetObj) return;

    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = targetObj.left;
    const initTop = targetObj.top;
    const initWidth = targetObj.width;
    const initHeight = targetObj.height;

    function onPointerMove(moveEv) {
      if (moveEv.pointerId !== pointerId) return;
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;

      let newLeft = initLeft;
      let newTop = initTop;
      let newWidth = initWidth;
      let newHeight = initHeight;

      if (handleDir.includes("e")) {
        newWidth = Math.max(16, snapToGrid(initWidth + dx));
      }
      if (handleDir.includes("s")) {
        newHeight = Math.max(16, snapToGrid(initHeight + dy));
      }
      if (handleDir.includes("w")) {
        const potentialWidth = initWidth - dx;
        if (potentialWidth >= 16) {
          newWidth = snapToGrid(potentialWidth);
          newLeft = snapToGrid(initLeft + (initWidth - newWidth));
        }
      }
      if (handleDir.includes("n")) {
        const potentialHeight = initHeight - dy;
        if (potentialHeight >= 16) {
          newHeight = snapToGrid(potentialHeight);
          newTop = snapToGrid(initTop + (initHeight - newHeight));
        }
      }

      targetObj.left = Math.max(0, newLeft);
      targetObj.top = Math.max(0, newTop);
      targetObj.width = newWidth;
      targetObj.height = newHeight;

      if (isForm) {
        designerForm.style.left = `${targetObj.left}px`;
        designerForm.style.top = `${targetObj.top}px`;
        designerForm.style.width = `${targetObj.width}px`;
        designerForm.style.height = `${targetObj.height}px`;
      } else {
        const ctrlEl = formBody.querySelector(`[data-control-id="${targetObj.id}"]`);
        if (ctrlEl) {
          ctrlEl.style.left = `${targetObj.left}px`;
          ctrlEl.style.top = `${targetObj.top}px`;
          ctrlEl.style.width = `${targetObj.width}px`;
          ctrlEl.style.height = `${targetObj.height}px`;
        }
      }
      updatePropertiesInputs();
    }

    function onPointerUp(upEv) {
      if (upEv.pointerId !== pointerId) return;
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      renderDesigner();
    }

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  });

  // Delete key handler for selected control
  document.addEventListener("keydown", (e) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
      if (activeTag === "input" || activeTag === "textarea" || document.activeElement.classList.contains("CodeMirror-code")) {
        return;
      }
      if (state.selectedId && state.selectedId !== "Form1") {
        e.preventDefault();
        state.controls = state.controls.filter((c) => c.id !== state.selectedId);
        state.selectedId = "Form1";
        renderDesigner();
      }
    }
  });

  // Properties Panel Rendering & Binding
  function getSelectedItem() {
    if (state.selectedId === "Form1") return state.form;
    return state.controls.find((c) => c.id === state.selectedId) || state.form;
  }

  function renderPropertiesPanel() {
    const item = getSelectedItem();
    const isForm = item.id === "Form1";
    propertiesPanelTitle.textContent = `Properties - ${item.name}`;

    propertiesBody.innerHTML = "";

    const props = [
      { key: "(Name)", field: "name", type: "text", val: item.name },
      { key: item.type === "TextBox" ? "Text" : "Caption", field: item.type === "TextBox" ? "text" : "caption", type: "text", val: item.type === "TextBox" ? (item.text !== undefined ? item.text : item.caption) : item.caption },
      { key: "Left", field: "left", type: "number", val: item.left },
      { key: "Top", field: "top", type: "number", val: item.top },
      { key: "Width", field: "width", type: "number", val: item.width },
      { key: "Height", field: "height", type: "number", val: item.height },
      { key: "Visible", field: "visible", type: "boolean", val: item.visible },
      { key: "Enabled", field: "enabled", type: "boolean", val: item.enabled }
    ];

    props.forEach((p) => {
      const tr = document.createElement("tr");
      const tdKey = document.createElement("td");
      tdKey.className = "prop-key";
      tdKey.textContent = p.key;

      const tdVal = document.createElement("td");
      tdVal.className = "prop-val";

      if (p.type === "boolean") {
        const select = document.createElement("select");
        select.className = "prop-select";
        select.setAttribute("data-field", p.field);

        const optTrue = document.createElement("option");
        optTrue.value = "true";
        optTrue.textContent = "True";
        if (p.val === true) optTrue.selected = true;

        const optFalse = document.createElement("option");
        optFalse.value = "false";
        optFalse.textContent = "False";
        if (p.val === false) optFalse.selected = true;

        select.appendChild(optTrue);
        select.appendChild(optFalse);

        select.addEventListener("change", (e) => {
          const newBool = e.target.value === "true";
          item[p.field] = newBool;
          renderDesigner();
        });

        tdVal.appendChild(select);
      } else {
        const input = document.createElement("input");
        input.className = "prop-input";
        input.type = p.type;
        input.value = p.val !== undefined ? p.val : "";
        input.setAttribute("data-field", p.field);

        input.addEventListener("input", (e) => {
          let newNameVal = e.target.value;
          if (p.field === "name") {
            if (newNameVal.trim() !== "") {
              item.name = newNameVal.trim();
              if (!isForm) {
                item.id = item.name;
                state.selectedId = item.id;
              }
              propertiesPanelTitle.textContent = `Properties - ${item.name}`;
            }
          } else if (p.type === "number") {
            const num = parseInt(newNameVal, 10);
            if (!isNaN(num)) {
              item[p.field] = Math.max(0, num);
            }
          } else {
            item[p.field] = newNameVal;
            if (p.field === "caption" && item.type === "TextBox") {
              item.text = newNameVal;
            }
          }
          // Real-time canvas update
          updateCanvasElementFromState(item);
        });

        input.addEventListener("change", () => {
          renderDesigner();
        });

        tdVal.appendChild(input);
      }

      tr.appendChild(tdKey);
      tr.appendChild(tdVal);
      propertiesBody.appendChild(tr);
    });
  }

  function updatePropertiesInputs() {
    const item = getSelectedItem();
    const inputs = propertiesBody.querySelectorAll("input, select");
    inputs.forEach((input) => {
      const field = input.getAttribute("data-field");
      if (field && item[field] !== undefined) {
        if (input.tagName.toLowerCase() === "select") {
          input.value = item[field] ? "true" : "false";
        } else if (document.activeElement !== input) {
          input.value = item[field];
        }
      }
    });
  }

  function updateCanvasElementFromState(item) {
    if (item.id === "Form1") {
      designerForm.style.left = `${item.left}px`;
      designerForm.style.top = `${item.top}px`;
      designerForm.style.width = `${item.width}px`;
      designerForm.style.height = `${item.height}px`;
      formTitleText.textContent = item.caption || item.name;
    } else {
      const ctrlEl = formBody.querySelector(`[data-control-id="${item.id}"]`);
      if (ctrlEl) {
        ctrlEl.style.left = `${item.left}px`;
        ctrlEl.style.top = `${item.top}px`;
        ctrlEl.style.width = `${item.width}px`;
        ctrlEl.style.height = `${item.height}px`;
        if (item.type === "Button" || item.type === "Label") {
          ctrlEl.textContent = item.caption || item.name;
        } else if (item.type === "TextBox") {
          ctrlEl.textContent = item.text !== undefined ? item.text : item.caption;
        } else if (item.type === "CheckBox") {
          ctrlEl.innerHTML = `<span class="control-type-checkbox-box">✓</span><span>${item.caption || item.name}</span>`;
        } else if (item.type === "Frame") {
          ctrlEl.innerHTML = `<span class="control-type-frame-caption">${item.caption || item.name}</span>`;
        } else if (item.type === "Image") {
          ctrlEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span>${item.caption || item.name}</span>`;
        } else if (item.type === "Timer") {
          ctrlEl.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polyline points="12 6 12 16 14"/></svg><span>${item.caption || item.name}</span>`;
        }
      }
    }
  }

  // Double Click Event Generator
  function doubleClickControl(item) {
    const ctrlName = item.name;

    // Switch to Code View
    tabCode.click();

    let code = editor.getValue();
    const subRegex = new RegExp(`Sub\\s+${ctrlName}_Click\\s*\\(\\s*\\)`, "i");

    if (!subRegex.test(code)) {
      if (code.trim() !== "" && !code.endsWith("\n")) {
        code += "\n\n";
      } else if (code.trim() !== "" && !code.endsWith("\n\n")) {
        code += "\n";
      }

      const boilerplate = `Sub ${ctrlName}_Click()\n    MsgBox "${ctrlName} Clicked!"\nEnd Sub\n`;
      code += boilerplate;
      editor.setValue(code);
    }

    // Position cursor inside the subroutine
    const lines = editor.getValue().split("\n");
    let targetLine = -1;

    for (let i = 0; i < lines.length; i++) {
      if (subRegex.test(lines[i])) {
        targetLine = i + 1; // line inside the sub
        break;
      }
    }

    if (targetLine !== -1 && targetLine < editor.lineCount()) {
      editor.setCursor({ line: targetLine, ch: lines[targetLine] ? lines[targetLine].length : 4 });
      editor.focus();
    }
  }

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

  // Initial Designer Render
  renderDesigner();
});
