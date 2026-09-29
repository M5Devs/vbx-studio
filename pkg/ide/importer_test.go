package ide

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestImportVB6_FRM(t *testing.T) {
	sampleFRM := `VERSION 5.00
Begin VB.Form MainForm
   Caption         =   "Legacy Test Form"
   ClientHeight    =   6000
   ClientWidth     =   9000
   Begin VB.CommandButton cmdSubmit
      Caption         =   "Submit Now"
      Height          =   450
      Left            =   1500
      Top             =   3000
      Width           =   1800
   End
   Begin VB.TextBox txtUsername
      Height          =   300
      Left            =   1500
      Text            =   "john_doe"
      Top             =   1500
      Width           =   3000
   End
   Begin VB.Label lblHeader
      Caption         =   "Enter Details:"
      Height          =   300
      Left            =   1500
      Top             =   900
      Width           =   2000
   End
End
Attribute VB_Name = "MainForm"
Attribute VB_GlobalNameSpace = False
Attribute VB_Creatable = False
Attribute VB_PredeclaredId = True
Attribute VB_Exposed = False

Private Sub cmdSubmit_Click()
    MsgBox "Submitted: " & txtUsername.Text
End Sub
`

	proj, err := ImportVB6(sampleFRM, "MainForm.frm")
	if err != nil {
		t.Fatalf("ImportVB6 failed: %v", err)
	}

	if proj.ProjectName != "MainForm" {
		t.Errorf("expected ProjectName 'MainForm', got '%s'", proj.ProjectName)
	}
	if proj.Form.Name != "MainForm" {
		t.Errorf("expected Form Name 'MainForm', got '%s'", proj.Form.Name)
	}
	if proj.Form.Caption != "Legacy Test Form" {
		t.Errorf("expected Form Caption 'Legacy Test Form', got '%s'", proj.Form.Caption)
	}
	if proj.Form.Width != 600 { // 9000 / 15
		t.Errorf("expected Form Width 600, got %d", proj.Form.Width)
	}
	if proj.Form.Height != 400 { // 6000 / 15
		t.Errorf("expected Form Height 400, got %d", proj.Form.Height)
	}

	if len(proj.Controls) != 3 {
		t.Fatalf("expected 3 controls, got %d", len(proj.Controls))
	}

	// Button check
	btn := proj.Controls[0]
	if btn.ID != "cmdSubmit" || btn.Type != "Button" {
		t.Errorf("control 0 mismatch: %+v", btn)
	}
	if btn.Caption != "Submit Now" || btn.Left != 100 || btn.Top != 200 || btn.Width != 120 || btn.Height != 30 {
		t.Errorf("control 0 properties mismatch: %+v", btn)
	}

	// TextBox check
	txt := proj.Controls[1]
	if txt.ID != "txtUsername" || txt.Type != "TextBox" || txt.Text != "john_doe" {
		t.Errorf("control 1 mismatch: %+v", txt)
	}

	// Code check
	expectedCode := `Private Sub cmdSubmit_Click()
    MsgBox "Submitted: " & txtUsername.Text
End Sub`
	if proj.Code != expectedCode {
		t.Errorf("code extraction failed. Expected:\n%s\nGot:\n%s", expectedCode, proj.Code)
	}
}

func TestImportVB6_VBP(t *testing.T) {
	sampleVBP := `Type=Exe
Form=MainForm.frm
Module=Module1; Module1.bas
Title="Legacy App"
Name="LegacyAppProj"
`

	proj, err := ImportVB6(sampleVBP, "LegacyApp.vbp")
	if err != nil {
		t.Fatalf("ImportVB6 VBP failed: %v", err)
	}

	if proj.ProjectName != "Legacy App" {
		t.Errorf("expected ProjectName 'Legacy App', got '%s'", proj.ProjectName)
	}
}

func TestServer_ImportVB6Endpoint(t *testing.T) {
	server := NewServer(t.TempDir())
	mux := http.NewServeMux()
	server.RegisterHandlers(mux)

	sampleFRM := `VERSION 5.00
Begin VB.Form Form1
   Caption         =   "API Test Form"
   ClientHeight    =   3000
   ClientWidth     =   4500
End
`

	reqBody, _ := json.Marshal(map[string]string{
		"filename": "Test.frm",
		"content":  sampleFRM,
	})

	req := httptest.NewRequest("POST", "/api/project/import-vb6", bytes.NewBuffer(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected status OK 200, got %d. Body: %s", rec.Code, rec.Body.String())
	}

	var proj ProjectConfig
	if err := json.Unmarshal(rec.Body.Bytes(), &proj); err != nil {
		t.Fatalf("failed to unmarshal JSON response: %v", err)
	}

	if proj.Form.Caption != "API Test Form" {
		t.Errorf("expected Form Caption 'API Test Form', got '%s'", proj.Form.Caption)
	}
}
