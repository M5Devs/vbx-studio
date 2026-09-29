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

  // Setup Server-Sent Events (SSE) for execution logs
  function setupSSE() {
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

  const btnOpen = document.getElementById("btn-open");
  const projectFileInput = document.getElementById("project-file-input");
  const menuFile = document.getElementById("menu-file");

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

    // Download file in browser
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

    // Also call backend API to save project cleanly
    try {
      const response = await fetch("/api/project/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath: fileName, project: projectData })
      });

      if (response.ok) {
        appendConsoleLine(`[VBX Studio] Project saved successfully to ${fileName}`, "system");
      } else {
        appendConsoleLine(`[Error] Backend project save returned error status`, "stderr");
      }
    } catch (err) {
      appendConsoleLine(`[Error] Project save request failed: ${err.message}`, "stderr");
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
        // Reset file input value so selecting the same file triggers change again
        e.target.value = "";
      };
      reader.readAsText(file);
    });
  }

  if (menuFile) {
    menuFile.addEventListener("click", () => {
      // Trigger file selection on File menu click or present options
      projectFileInput.click();
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
      ctrlEl.addEventListener("mousedown", (e) => {
        if (e.target.classList.contains("resize-handle")) {
          return;
        }
        e.stopPropagation();
        state.selectedId = ctrl.id;
        renderDesigner();
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

  // Form Double Click
  designerForm.addEventListener("dblclick", (e) => {
    if (e.target === designerForm || formTitlebar.contains(e.target)) {
      e.stopPropagation();
      doubleClickControl(state.form);
    }
  });

  // Moving Controls
  function initControlDrag(e, ctrl) {
    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = ctrl.left;
    const initTop = ctrl.top;

    function onMouseMove(moveEv) {
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

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      renderDesigner();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  // Moving Form1 Titlebar Drag
  formTitlebar.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("control-box-btn")) return;
    e.stopPropagation();
    state.selectedId = "Form1";
    renderDesigner();

    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = state.form.left;
    const initTop = state.form.top;

    function onMouseMove(moveEv) {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;
      state.form.left = Math.max(0, snapToGrid(initLeft + dx));
      state.form.top = Math.max(0, snapToGrid(initTop + dy));

      designerForm.style.left = `${state.form.left}px`;
      designerForm.style.top = `${state.form.top}px`;
      updatePropertiesInputs();
    }

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      renderDesigner();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  });

  // Resizing Controls and Form via Handles
  document.addEventListener("mousedown", (e) => {
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

    const startX = e.clientX;
    const startY = e.clientY;
    const initLeft = targetObj.left;
    const initTop = targetObj.top;
    const initWidth = targetObj.width;
    const initHeight = targetObj.height;

    function onMouseMove(moveEv) {
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

    function onMouseUp() {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      renderDesigner();
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
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
