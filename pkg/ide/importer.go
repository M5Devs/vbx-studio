package ide

import (
	"bufio"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
)

// ImportVB6 converts legacy VB6 file content (.frm, .vbp, .bas) into a ProjectConfig
func ImportVB6(content string, filename string) (*ProjectConfig, error) {
	ext := strings.ToLower(filepath.Ext(filename))
	if ext == "" {
		if strings.Contains(content, "Begin VB.Form") {
			ext = ".frm"
		} else if strings.Contains(content, "Type=Exe") || strings.Contains(content, "Form=") {
			ext = ".vbp"
		} else {
			ext = ".bas"
		}
	}

	switch ext {
	case ".vbp":
		return parseVBP(content, filename)
	case ".bas":
		return parseBAS(content, filename)
	case ".frm":
		fallthrough
	default:
		return parseFRM(content, filename)
	}
}

type blockType int

const (
	blockForm blockType = iota
	blockControl
)

type parseStackItem struct {
	kind       blockType
	controlIdx int // index in project.Controls if blockControl
}

func parseFRM(content string, filename string) (*ProjectConfig, error) {
	projName := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
	if projName == "" {
		projName = "ImportedProject"
	}

	proj := &ProjectConfig{
		Version:     "1.0",
		ProjectName: projName,
		Form: FormConfig{
			Name:      "Form1",
			Caption:   "Form1",
			Width:     600,
			Height:    400,
			BackColor: "#0b0f19",
		},
		Controls: make([]ControlConfig, 0),
		Code:     "",
	}

	scanner := bufio.NewScanner(strings.NewReader(content))
	var stack []parseStackItem
	var codeLines []string
	inCodeSection := false

	for scanner.Scan() {
		rawLine := scanner.Text()
		trimmedLine := strings.TrimSpace(rawLine)

		if inCodeSection {
			// Skip Attribute lines in the header of code section
			if strings.HasPrefix(strings.ToLower(trimmedLine), "attribute ") {
				continue
			}
			codeLines = append(codeLines, rawLine)
			continue
		}

		if trimmedLine == "" {
			continue
		}

		// Check for Begin statement
		if strings.HasPrefix(trimmedLine, "Begin ") {
			parts := strings.Fields(trimmedLine)
			if len(parts) >= 2 {
				vbType := parts[1]
				name := ""
				if len(parts) >= 3 {
					name = parts[2]
				}

				if vbType == "VB.Form" {
					if name != "" {
						proj.Form.Name = name
						proj.Form.Caption = name
					}
					stack = append(stack, parseStackItem{kind: blockForm})
				} else {
					ctrlType := mapVB6ControlType(vbType)
					if name == "" {
						name = fmt.Sprintf("%s%d", ctrlType, len(proj.Controls)+1)
					}
					ctrl := ControlConfig{
						ID:      name,
						Type:    ctrlType,
						Caption: name,
						Text:    name,
						Left:    0,
						Top:     0,
						Width:   100,
						Height:  32,
						Visible: true,
						Enabled: true,
					}
					proj.Controls = append(proj.Controls, ctrl)
					stack = append(stack, parseStackItem{
						kind:       blockControl,
						controlIdx: len(proj.Controls) - 1,
					})
				}
			}
			continue
		}

		if trimmedLine == "End" {
			if len(stack) > 0 {
				top := stack[len(stack)-1]
				stack = stack[:len(stack)-1]
				if top.kind == blockForm {
					// Form definition block finished; code section follows
					inCodeSection = true
				}
			}
			continue
		}

		// Parse key = value properties within active block
		if len(stack) > 0 {
			key, val, ok := parseKeyValuePair(trimmedLine)
			if ok {
				top := stack[len(stack)-1]
				if top.kind == blockForm {
					applyFormProperty(&proj.Form, key, val)
				} else if top.kind == blockControl {
					applyControlProperty(&proj.Controls[top.controlIdx], key, val)
				}
			}
		}
	}

	// Clean up extracted code
	rawCode := strings.Join(codeLines, "\n")
	proj.Code = strings.TrimSpace(rawCode)

	return proj, nil
}

func parseVBP(content string, filename string) (*ProjectConfig, error) {
	projName := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))

	title := ""
	name := ""
	var forms []string
	var modules []string

	scanner := bufio.NewScanner(strings.NewReader(content))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, ";") {
			continue
		}

		key, val, ok := parseKeyValuePair(line)
		if !ok {
			continue
		}

		switch strings.ToLower(key) {
		case "title":
			title = parseVB6String(val)
		case "name":
			name = parseVB6String(val)
		case "form":
			forms = append(forms, parseVB6String(val))
		case "module":
			modules = append(modules, parseVB6String(val))
		}
	}

	if title != "" {
		projName = title
	} else if name != "" {
		projName = name
	}

	var codeLines []string
	codeLines = append(codeLines, fmt.Sprintf("' Imported Legacy VB6 Project: %s", projName))
	if len(forms) > 0 {
		codeLines = append(codeLines, fmt.Sprintf("' Forms: %s", strings.Join(forms, ", ")))
	}
	if len(modules) > 0 {
		codeLines = append(codeLines, fmt.Sprintf("' Modules: %s", strings.Join(modules, ", ")))
	}
	codeLines = append(codeLines, "", "Sub Main()", fmt.Sprintf("    Print \"Loaded legacy project: %s\"", projName), "End Sub")

	return &ProjectConfig{
		Version:     "1.0",
		ProjectName: projName,
		Form: FormConfig{
			Name:      "Form1",
			Caption:   projName,
			Width:     600,
			Height:    400,
			BackColor: "#0b0f19",
		},
		Controls: make([]ControlConfig, 0),
		Code:     strings.Join(codeLines, "\n"),
	}, nil
}

func parseBAS(content string, filename string) (*ProjectConfig, error) {
	projName := strings.TrimSuffix(filepath.Base(filename), filepath.Ext(filename))
	if projName == "" {
		projName = "Module1"
	}

	scanner := bufio.NewScanner(strings.NewReader(content))
	var codeLines []string

	for scanner.Scan() {
		rawLine := scanner.Text()
		trimmedLine := strings.TrimSpace(rawLine)

		if strings.HasPrefix(strings.ToLower(trimmedLine), "attribute ") {
			continue
		}
		codeLines = append(codeLines, rawLine)
	}

	return &ProjectConfig{
		Version:     "1.0",
		ProjectName: projName,
		Form: FormConfig{
			Name:      "Form1",
			Caption:   projName,
			Width:     600,
			Height:    400,
			BackColor: "#0b0f19",
		},
		Controls: make([]ControlConfig, 0),
		Code:     strings.TrimSpace(strings.Join(codeLines, "\n")),
	}, nil
}

func mapVB6ControlType(vbType string) string {
	switch vbType {
	case "VB.CommandButton":
		return "Button"
	case "VB.TextBox":
		return "TextBox"
	case "VB.Label":
		return "Label"
	case "VB.CheckBox":
		return "CheckBox"
	case "VB.Frame":
		return "Frame"
	case "VB.Image":
		return "Image"
	case "VB.Timer":
		return "Timer"
	default:
		if strings.HasPrefix(vbType, "VB.") {
			return strings.TrimPrefix(vbType, "VB.")
		}
		return vbType
	}
}

func parseKeyValuePair(line string) (string, string, bool) {
	idx := strings.Index(line, "=")
	if idx == -1 {
		return "", "", false
	}
	key := strings.TrimSpace(line[:idx])
	val := strings.TrimSpace(line[idx+1:])
	return key, val, true
}

func parseVB6String(val string) string {
	val = strings.TrimSpace(val)
	if strings.HasPrefix(val, "\"") && strings.HasSuffix(val, "\"") && len(val) >= 2 {
		val = val[1 : len(val)-1]
		val = strings.ReplaceAll(val, "\"\"", "\"")
	}
	return val
}

func parseTwips(val string) int {
	val = strings.TrimSpace(val)
	// Handle potential hex or integer
	if strings.HasPrefix(val, "&H") {
		clean := strings.TrimSuffix(strings.TrimPrefix(val, "&H"), "&")
		if n, err := strconv.ParseInt(clean, 16, 64); err == nil {
			return int(n) / 15
		}
	}
	if n, err := strconv.Atoi(val); err == nil {
		return n / 15
	}
	return 0
}

func parseBool(val string) bool {
	val = strings.ToLower(strings.TrimSpace(val))
	if val == "0" || val == "false" {
		return false
	}
	return true
}

func applyFormProperty(form *FormConfig, key, val string) {
	switch strings.ToLower(key) {
	case "caption":
		form.Caption = parseVB6String(val)
	case "clientwidth":
		if w := parseTwips(val); w > 0 {
			form.Width = w
		}
	case "clientheight":
		if h := parseTwips(val); h > 0 {
			form.Height = h
		}
	case "backcolor":
		form.BackColor = val
	}
}

func applyControlProperty(ctrl *ControlConfig, key, val string) {
	switch strings.ToLower(key) {
	case "caption":
		ctrl.Caption = parseVB6String(val)
	case "text":
		ctrl.Text = parseVB6String(val)
	case "left":
		ctrl.Left = parseTwips(val)
	case "top":
		ctrl.Top = parseTwips(val)
	case "width":
		ctrl.Width = parseTwips(val)
	case "height":
		ctrl.Height = parseTwips(val)
	case "visible":
		ctrl.Visible = parseBool(val)
	case "enabled":
		ctrl.Enabled = parseBool(val)
	}
}
