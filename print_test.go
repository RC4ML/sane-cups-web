package main

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNormalizePageRanges(t *testing.T) {
	tests := []struct {
		input string
		want  string
		ok    bool
	}{
		{"", "", true},
		{" 1, 3-5, 9 ", "1,3-5,9", true},
		{"0", "", false},
		{"3-2", "", false},
		{"1-", "", false},
		{"1,,2", "", false},
		{"1;rm", "", false},
		{"-P1", "", false},
	}
	for _, tt := range tests {
		got, err := normalizePageRanges(tt.input)
		if (err == nil) != tt.ok || got != tt.want {
			t.Errorf("normalizePageRanges(%q) = %q, %v; want %q, ok=%v", tt.input, got, err, tt.want, tt.ok)
		}
	}
}

func TestPrintOptionsUseOriginalPageNumbers(t *testing.T) {
	for _, test := range []struct{ ranges, selection, want string }{
		{"2-5", "even", "2,4"},
		{"2-5", "odd", "3,5"},
		{"6,2-5,4-6", "even", "2,4,6"},
		{"1,3,5", "odd", "1,3,5"},
	} {
		t.Run(test.ranges+test.selection, func(t *testing.T) {
			options := defaultPrintOptions()
			options.PageRanges, options.PageSet, options.OutputOrder = test.ranges, test.selection, "reverse"
			args, err := options.arguments("Office", "/tmp/document.pdf")
			if err != nil {
				t.Fatal(err)
			}
			command := strings.Join(args, "\n")
			for _, expected := range []string{"-P\n" + test.want + "\n", "-o\npage-set=all\n", "-o\noutputorder=reverse\n", "-o\nCollate=true\n", "-o\nnumber-up=1\n"} {
				if !strings.Contains(command, expected) {
					t.Errorf("missing %q in %q", expected, command)
				}
			}
		})
	}
	for _, ranges := range []string{"1,3,5", "1-1000000"} {
		options := defaultPrintOptions()
		options.PageRanges, options.PageSet = ranges, "even"
		if _, err := options.arguments("Office", "/tmp/document.pdf"); err == nil {
			t.Errorf("expected empty or oversized selection %q to fail", ranges)
		}
	}
}

func TestPrintUploadsAndSavedDocuments(t *testing.T) {
	previousConfig, previousScans := appConfig, scansDir
	t.Cleanup(func() { appConfig, scansDir = previousConfig, previousScans })
	root := t.TempDir()
	server := paperTestServer(t)
	scansDir = root
	appConfig = Config{Server: ServerConfig{RequestLimitBytes: 1 << 20}, Defaults: Defaults{Device: "hp"}, Devices: []Device{{ID: "hp", Print: &PrintConfig{Queue: "Office"}}}}
	if err := os.WriteFile(filepath.Join(root, "saved.pdf"), []byte("%PDF-test"), 0600); err != nil {
		t.Fatal(err)
	}
	capture := filepath.Join(root, "arguments")
	// A fake lp records submissions without contacting CUPS or printing anything.
	script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$PRINT_TEST_ARGS\"\nfor arg do file=\"$arg\"; done\ntest -s \"$file\" || exit 1\nprintf 'request id is Office-1\\n'\n"
	if err := os.WriteFile(filepath.Join(root, "lp"), []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", root+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("PRINT_TEST_ARGS", capture)
	t.Setenv("TMPDIR", root)
	t.Setenv("PRINT_TEST_SERVER", strings.TrimPrefix(server.URL, "http://"))
	if err := os.WriteFile(filepath.Join(root, "lpstat"), []byte("#!/bin/sh\nprintf '%s\\n' \"$PRINT_TEST_SERVER\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, upload := range []bool{false, true} {
		for _, test := range []struct {
			name    string
			options map[string]any
			status  int
			want    []string
		}{
			{"defaults", nil, 200, []string{"-n\n1\n", "page-set=all", "outputorder=normal", "Collate=true"}},
			{"even-reverse", map[string]any{"page_ranges": "2-5", "page_set": "even", "output_order": "reverse", "copies": 2, "collate": false}, 200, []string{"-P\n2,4\n", "page-set=all", "outputorder=reverse", "-n\n2\n", "Collate=false"}},
			{"odd-all", map[string]any{"page_set": "odd"}, 200, []string{"page-set=odd"}},
			{"bad-selection", map[string]any{"page_set": "all -o raw"}, 400, nil},
			{"bad-order", map[string]any{"output_order": "random"}, 400, nil},
			{"bad-copies", map[string]any{"copies": 0}, 400, nil},
			{"empty-selection", map[string]any{"page_ranges": "1,3", "page_set": "even"}, 400, nil},
			{"bad-range", map[string]any{"page_ranges": "5-2"}, 400, nil},
			{"bad-collate", map[string]any{"collate": "maybe"}, 400, nil},
			{"a4-fit", map[string]any{"paper_size": "iso_a4_210x297mm"}, 200, []string{"media=iso_a4_210x297mm", "print-scaling=fit"}},
			{"a5-actual", map[string]any{"paper_size": "iso_a5_148x210mm", "scaling": "actual"}, 200, []string{"media=iso_a5_148x210mm", "print-scaling=none"}},
			{"unsupported-a3", map[string]any{"paper_size": "iso_a3_297x420mm"}, 400, nil},
			{"bad-media", map[string]any{"paper_size": "A4,Manual"}, 400, nil},
			{"bad-scaling", map[string]any{"scaling": "200%"}, 400, nil},
		} {
			kind := "saved/"
			if upload {
				kind = "upload/"
			}
			t.Run(kind+test.name, func(t *testing.T) {
				os.Remove(capture)
				var body bytes.Buffer
				contentType := "application/json"
				if upload {
					writer := multipart.NewWriter(&body)
					file, err := writer.CreateFormFile("file", "uploaded.pdf")
					if err != nil {
						t.Fatal(err)
					}
					file.Write([]byte("%PDF-test"))
					writer.WriteField("device_id", "hp")
					for key, value := range test.options {
						data, _ := json.Marshal(value)
						writer.WriteField(key, strings.Trim(string(data), "\""))
					}
					writer.Close()
					contentType = writer.FormDataContentType()
				} else {
					data := map[string]any{"scan_filename": "saved.pdf", "device_id": "hp"}
					for key, value := range test.options {
						data[key] = value
					}
					json.NewEncoder(&body).Encode(data)
				}
				request := httptest.NewRequest("POST", "/api/print", &body)
				request.Header.Set("Content-Type", contentType)
				response := httptest.NewRecorder()
				handlePrintJob(response, request)
				if response.Code != test.status {
					t.Fatalf("status %d: %s", response.Code, response.Body.String())
				}
				arguments, err := os.ReadFile(capture)
				if test.status != 200 {
					if !os.IsNotExist(err) {
						t.Fatal("invalid request reached lp")
					}
				} else {
					if err != nil {
						t.Fatal(err)
					}
					for _, expected := range test.want {
						if !strings.Contains(string(arguments), expected) {
							t.Errorf("missing %q in %q", expected, arguments)
						}
					}
				}
				files, _ := filepath.Glob(filepath.Join(root, "print_upload_*"))
				if len(files) != 0 {
					t.Errorf("temporary uploads not cleaned up: %v", files)
				}
			})
		}
	}
}

func TestPrintRejectsNonPDF(t *testing.T) {
	previous := appConfig
	t.Cleanup(func() { appConfig = previous })
	appConfig = Config{Server: ServerConfig{RequestLimitBytes: 1 << 20}, Defaults: Defaults{Device: "hp"}, Devices: []Device{{ID: "hp", Print: &PrintConfig{Queue: "Office"}}}}
	for _, test := range []struct{ name, content string }{{"image.png", "PNG"}, {"office.docx", "ZIP"}, {"renamed.pdf", "not a PDF"}} {
		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		file, _ := writer.CreateFormFile("file", test.name)
		file.Write([]byte(test.content))
		writer.Close()
		req := httptest.NewRequest("POST", "/api/print", &body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		response := httptest.NewRecorder()
		handlePrintJob(response, req)
		if response.Code != 400 {
			t.Errorf("%s: status %d", test.name, response.Code)
		}
	}
}
