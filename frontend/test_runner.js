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
  fetch: async () => { throw new Error("Offline"); },
  _testEnv: {}
};

const sandboxKeys = Object.keys(sandbox);
const sandboxValues = sandboxKeys.map(k => sandbox[k]);

// Inject window._testEnv export right before renderDesigner()
const scriptToRun = appJsContent.replace(
  '  // Initial Designer Render\n  renderDesigner();',
  '  _testEnv.evaluateJSExpr = evaluateJSExpr;\n  _testEnv.splitByOp = splitByOp;\n  _testEnv.runClientSideVBX = runClientSideVBX;\n  _testEnv.parseVB6ClientSide = parseVB6ClientSide;\n  _testEnv.parseFRMClientSide = parseFRMClientSide;\n  _testEnv.parseVBPClientSide = parseVBPClientSide;\n  _testEnv.parseBASClientSide = parseBASClientSide;\n  // renderDesigner();'
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
For i = 1 To 2
  Print "Loop " & i
Next i
Dim count = 1
Do While count <= 2
  Print "DoWhile " & count
  count = count + 1
Loop
  `;

  await env.runClientSideVBX(code);
  console.log("✓ Client interpreter execution passed");
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

testInterpreter().then(() => {
  console.log("All Frontend Automated Tests Passed Successfully!");
});
