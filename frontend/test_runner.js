// Unit tests for frontend client-side runner and importer logic
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appJsContent = fs.readFileSync(path.join(__dirname, "app.js"), "utf8");

function createMockElement(id = "") {
  return {
    id,
    className: "",
    textContent: "",
    innerHTML: "",
    value: "",
    disabled: false,
    style: {},
    appendChild: () => {},
    removeChild: () => {},
    querySelector: () => createMockElement(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    setAttribute: () => {},
    getAttribute: () => null,
    classList: { add: () => {}, remove: () => {}, contains: () => false }
  };
}

const mockDocument = {
  createElement: () => createMockElement(),
  getElementById: (id) => createMockElement(id),
  querySelectorAll: () => [],
  querySelector: () => createMockElement(),
  activeElement: createMockElement(),
  body: createMockElement("body"),
  addEventListener: (event, cb) => {
    if (event === "DOMContentLoaded") {
      cb();
    }
  }
};

const mockCodeMirror = {
  fromTextArea: () => ({
    setValue: () => {},
    getValue: () => "",
    lineCount: () => 0,
    setCursor: () => {},
    focus: () => {}
  })
};

const mockEventSource = function() {
  return { onmessage: null, onerror: null, close: () => {} };
};

const sandbox = {
  document: mockDocument,
  CodeMirror: mockCodeMirror,
  EventSource: mockEventSource,
  console: console,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  Date: Date,
  Number: Number,
  String: String,
  Boolean: Boolean,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  Object: Object,
  URL: { createObjectURL: () => "blob:test", revokeObjectURL: () => {} },
  Blob: class {},
  FileReader: class {},
  localStorage: {
    _data: {},
    getItem: function(k) { return this._data[k] || null; },
    setItem: function(k, v) { this._data[k] = String(v); },
    removeItem: function(k) { delete this._data[k]; }
  },
  window: {
    location: { hostname: "username.github.io", protocol: "https:" },
    alert: (msg) => { sandbox._testEnv.lastAlert = msg; },
    prompt: (msg, def) => { sandbox._testEnv.lastPrompt = msg; return "UserPromptVal"; }
  },
  fetch: async () => { throw new Error("Offline"); },
  _testEnv: {}
};

const sandboxKeys = Object.keys(sandbox);
const sandboxValues = sandboxKeys.map(k => sandbox[k]);

// Inject window._testEnv export right before renderDesigner()
const scriptToRun = appJsContent.replace(
  '  // Initial Designer Render\n  renderDesigner();',
  '  _testEnv.evaluateJSExpr = evaluateJSExpr;\n  _testEnv.splitByOp = splitByOp;\n  _testEnv.runClientSideVBX = runClientSideVBX;\n  _testEnv.parseVB6ClientSide = parseVB6ClientSide;\n  _testEnv.parseFRMClientSide = parseFRMClientSide;\n  _testEnv.parseVBPClientSide = parseVBPClientSide;\n  _testEnv.parseBASClientSide = parseBASClientSide;\n  _testEnv.isStaticHosting = isStaticHosting;\n  // renderDesigner();'
);

const runTestEnv = new Function(...sandboxKeys, scriptToRun);
runTestEnv(...sandboxValues);

const env = sandbox._testEnv;

console.log("Running Frontend Automated Tests...");

// Test 1: Expression evaluation
assert.strictEqual(env.evaluateJSExpr('"Hello " & "World"'), "Hello World");
assert.strictEqual(env.evaluateJSExpr('5 + 3 * 2'), 11);
assert.strictEqual(env.evaluateJSExpr('x + 10', { x: 5 }), 15);
assert.strictEqual(env.evaluateJSExpr('msg', { msg: "VBX RAD" }), "VBX RAD");
console.log("✓ Expression evaluator tests passed");

// Test 2: Interpreter commands execution
async function testInterpreter() {
  const code = `
Print "Line 1"
Dim num = 20
Print num + 5
MsgBox "Alert box"
Dim name = InputBox("Enter Name", "Title", "DefaultName")
Print "Hello " & name
For i = 1 To 2
  Print "Loop " & i
Next i
Dim count = 1
While count <= 2
  Print "WhileWend " & count
  count = count + 1
Wend
  `;

  await env.runClientSideVBX(code);
  assert.strictEqual(env.lastAlert, "Alert box");
  assert.strictEqual(env.lastPrompt, "Enter Name");
  console.log("✓ Client interpreter execution & InputBox/MsgBox/Loops passed");

  assert.strictEqual(env.isStaticHosting(), true);
  console.log("✓ Static hosting domain detection passed");
}

// Test 3: VB6 Importer
const frmSample = `VERSION 5.00
Begin VB.Form Form1
   Caption         =   "Test VB6 Import"
   ClientHeight    =   4500
   ClientWidth     =   6000
   Begin VB.CommandButton btnClick
      Caption         =   "Click Me"
      Height          =   450
      Left            =   1500
      Top             =   1500
      Width           =   1500
   End
End
Attribute VB_Name = "Form1"

Private Sub btnClick_Click()
    Print "Hello"
End Sub
`;

const importedProj = env.parseVB6ClientSide(frmSample, "Form1.frm");
assert.strictEqual(importedProj.projectName, "Form1");
assert.strictEqual(importedProj.form.caption, "Test VB6 Import");
assert.strictEqual(importedProj.form.width, 400); // 6000 / 15
assert.strictEqual(importedProj.form.height, 300); // 4500 / 15
assert.strictEqual(importedProj.controls.length, 1);
assert.strictEqual(importedProj.controls[0].id, "btnClick");
assert.strictEqual(importedProj.controls[0].type, "Button");
assert.strictEqual(importedProj.controls[0].caption, "Click Me");
assert.strictEqual(importedProj.controls[0].left, 100);
assert.strictEqual(importedProj.controls[0].top, 100);
console.log("✓ Client VB6 Importer tests passed");

// Test 4: Extended Controls Import
const extProj = env.parseVB6ClientSide(`VERSION 5.00
Begin VB.Form Form1
   Caption         =   "Extended Controls Form"
   ClientHeight    =   6000
   ClientWidth     =   8000
   Begin VB.ComboBox Combo1
      Height          =   315
      Left            =   1000
      Top             =   1000
      Width           =   1500
   End
   Begin VB.ListBox List1
      Height          =   800
      Left            =   1000
      Top             =   1500
      Width           =   1500
   End
   Begin VB.OptionButton Option1
      Caption         =   "Option 1"
      Height          =   250
      Left            =   1000
      Top             =   2500
      Width           =   1200
   End
   Begin MSComctlLib.ProgBar ProgressBar1
      Height          =   250
      Left            =   1000
      Top             =   3000
      Width           =   2000
   End
   Begin VB.PictureBox Picture1
      Height          =   1000
      Left            =   1000
      Top             =   3500
      Width           =   1500
   End
End
`, "Form1.frm");

assert.strictEqual(extProj.controls.length, 5);
assert.strictEqual(extProj.controls[0].type, "ComboBox");
assert.strictEqual(extProj.controls[1].type, "ListBox");
assert.strictEqual(extProj.controls[2].type, "OptionButton");
assert.strictEqual(extProj.controls[3].type, "ProgressBar");
assert.strictEqual(extProj.controls[4].type, "PictureBox");
console.log("✓ Extended VB controls import tests passed");



// Test 5: Filename Sanitization Logic
function sanitizeProjectFilename(fileName, defaultProjName = "Project1") {
  if (!fileName || typeof fileName !== "string") fileName = defaultProjName + ".vbxp";
  fileName = fileName.trim();
  while (fileName.toLowerCase().endsWith(".json")) {
    fileName = fileName.slice(0, -5);
  }
  if (!fileName.toLowerCase().endsWith(".vbxp")) {
    fileName += ".vbxp";
  }
  return fileName;
}

assert.strictEqual(sanitizeProjectFilename("Project1.vbxp.json"), "Project1.vbxp");
assert.strictEqual(sanitizeProjectFilename("my_app.json"), "my_app.vbxp");
assert.strictEqual(sanitizeProjectFilename("TestProj"), "TestProj.vbxp");
assert.strictEqual(sanitizeProjectFilename("Demo.VBXP"), "Demo.VBXP");
console.log("✓ Filename sanitization tests passed");

testInterpreter().then(() => {
  console.log("All Frontend Automated Tests Passed Successfully!");
});
