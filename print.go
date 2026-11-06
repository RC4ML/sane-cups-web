package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

type printOptions struct {
	Copies      int    `json:"copies"`
	PageRanges  string `json:"page_ranges"`
	PageSet     string `json:"page_set"`
	OutputOrder string `json:"output_order"`
	Collate     bool   `json:"collate"`
	PaperSize   string `json:"paper_size"`
	Scaling     string `json:"scaling"`
}

func defaultPrintOptions() printOptions {
	return printOptions{Copies: 1, PageSet: "all", OutputOrder: "normal", Collate: true, Scaling: "fit"}
}

func (o *printOptions) validate() error {
	if o.Copies < 1 || o.Copies > 20 {
		return fmt.Errorf("Choose between 1 and 20 copies")
	}
	if o.PageSet != "all" && o.PageSet != "odd" && o.PageSet != "even" {
		return fmt.Errorf("Page selection must be all, odd, or even")
	}
	if o.OutputOrder != "normal" && o.OutputOrder != "reverse" {
		return fmt.Errorf("Page order must be normal or reverse")
	}
	if o.PaperSize != "" && !mediaKeyword.MatchString(o.PaperSize) {
		return fmt.Errorf("Invalid paper size")
	}
	if o.Scaling != "fit" && o.Scaling != "actual" {
		return fmt.Errorf("Scaling must be fit or actual")
	}
	var err error
	o.PageRanges, err = normalizePageRanges(o.PageRanges)
	return err
}

// CUPS applies page-set after page-ranges. Resolve their intersection here so
// odd/even always refers to the original document, including overlapping ranges.
func selectedPageRanges(ranges, pageSet string) (string, string, error) {
	if ranges == "" || pageSet == "all" {
		return ranges, pageSet, nil
	}
	parity := 1
	if pageSet == "even" {
		parity = 0
	}
	selected := make(map[int]bool)
	for _, part := range strings.Split(ranges, ",") {
		bounds := strings.Split(part, "-")
		first, _ := strconv.Atoi(bounds[0])
		last := first
		if len(bounds) == 2 {
			last, _ = strconv.Atoi(bounds[1])
		}
		if first%2 != parity {
			first++
		}
		for page := first; page <= last; page += 2 {
			selected[page] = true
			// Bound the lp argument, independently of the HTTP request size.
			if len(selected) > 10000 {
				return "", "", fmt.Errorf("Choose a smaller page range when selecting odd or even pages (maximum 10,000 selected pages)")
			}
		}
	}
	if len(selected) == 0 {
		return "", "", fmt.Errorf("No %s pages in the selected range", pageSet)
	}
	pages := make([]int, 0, len(selected))
	for page := range selected {
		pages = append(pages, page)
	}
	sort.Ints(pages)
	values := make([]string, len(pages))
	for i, page := range pages {
		values[i] = strconv.Itoa(page)
	}
	return strings.Join(values, ","), "all", nil
}

func (o printOptions) arguments(printer, filename string) ([]string, error) {
	if err := o.validate(); err != nil {
		return nil, err
	}
	ranges, pageSet, err := selectedPageRanges(o.PageRanges, o.PageSet)
	if err != nil {
		return nil, err
	}
	args := []string{"-n", strconv.Itoa(o.Copies),
		"-o", "page-set=" + pageSet, "-o", "outputorder=" + o.OutputOrder,
		"-o", "Collate=" + strconv.FormatBool(o.Collate), "-o", "number-up=1"}
	if printer != "" {
		args = append(args, "-d", printer)
	}
	if ranges != "" {
		args = append(args, "-P", ranges)
	}
	if o.PaperSize != "" {
		args = append(args, "-o", "media="+o.PaperSize)
	}
	scaling := "fit"
	if o.Scaling == "actual" {
		scaling = "none"
	}
	args = append(args, "-o", "print-scaling="+scaling)
	return append(args, filename), nil
}

func supportedPrintFile(name string) bool {
	return strings.EqualFold(filepath.Ext(name), ".pdf")
}

func hasPDFHeader(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	defer file.Close()
	var header [5]byte
	_, err = io.ReadFull(file, header[:])
	return err == nil && bytes.Equal(header[:], []byte("%PDF-"))
}

// POST /api/print accepts the same options for uploads and saved documents.
func handlePrintJob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		jsonError(w, http.StatusMethodNotAllowed, "Method not allowed")
		return
	}
	if !isPrintingEnabled() {
		jsonError(w, http.StatusForbidden, "Printing functionality is disabled by server configuration (ENABLE_PRINTING=false)")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, appConfig.Server.RequestLimitBytes)
	options := defaultPrintOptions()
	var target, deviceID string
	if strings.Contains(r.Header.Get("Content-Type"), "multipart/form-data") {
		err := r.ParseMultipartForm(25 << 20)
		if r.MultipartForm != nil {
			defer r.MultipartForm.RemoveAll()
		}
		if err != nil {
			jsonError(w, http.StatusBadRequest, "File too large or invalid form data")
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			jsonError(w, http.StatusBadRequest, "No file provided in form")
			return
		}
		defer file.Close()
		if !supportedPrintFile(header.Filename) {
			jsonError(w, http.StatusBadRequest, "Only PDF documents can be printed. Export your document to PDF first.")
			return
		}
		if value := r.FormValue("copies"); value != "" {
			options.Copies, err = strconv.Atoi(value)
			if err != nil {
				jsonError(w, http.StatusBadRequest, "Copies must be an integer between 1 and 20")
				return
			}
		}
		options.PageRanges = r.FormValue("page_ranges")
		options.PaperSize = r.FormValue("paper_size")
		if value := r.FormValue("scaling"); value != "" {
			options.Scaling = value
		}
		if value := r.FormValue("page_set"); value != "" {
			options.PageSet = value
		}
		if value := r.FormValue("output_order"); value != "" {
			options.OutputOrder = value
		}
		if value := r.FormValue("collate"); value != "" {
			if value != "true" && value != "false" {
				jsonError(w, http.StatusBadRequest, "Collate must be true or false")
				return
			}
			options.Collate = value == "true"
		}
		deviceID = r.FormValue("device_id")
		temp, err := os.CreateTemp("", "print_upload_*"+strings.ToLower(filepath.Ext(header.Filename)))
		if err != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to create temporary print file")
			return
		}
		target = temp.Name()
		defer os.Remove(target)
		_, copyErr := io.Copy(temp, file)
		closeErr := temp.Close()
		if copyErr != nil || closeErr != nil {
			jsonError(w, http.StatusInternalServerError, "Failed to save print file")
			return
		}
	} else {
		req := struct {
			ScanFilename string `json:"scan_filename"`
			DeviceID     string `json:"device_id"`
			printOptions
		}{printOptions: options}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			jsonError(w, http.StatusBadRequest, "Invalid JSON payload")
			return
		}
		if req.ScanFilename != filepath.Base(req.ScanFilename) || !validFileNameRx.MatchString(req.ScanFilename) || !supportedPrintFile(req.ScanFilename) {
			jsonError(w, http.StatusBadRequest, "Invalid or unsupported scan filename")
			return
		}
		target = filepath.Join(scansDir, req.ScanFilename)
		info, err := os.Stat(target)
		if err != nil || !info.Mode().IsRegular() {
			jsonError(w, http.StatusNotFound, "Scan file not found")
			return
		}
		options, deviceID = req.printOptions, req.DeviceID
	}
	d, err := configuredDevice(deviceID)
	if err != nil || d.Print == nil {
		jsonError(w, http.StatusBadRequest, "Selected device does not support printing")
		return
	}
	args, err := options.arguments(d.Print.Queue, target)
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !hasPDFHeader(target) {
		jsonError(w, http.StatusBadRequest, "The selected file is not a PDF document")
		return
	}
	if options.PaperSize != "" {
		caps, err := loadPaperCapabilities(r.Context(), d.Print.Queue)
		if err != nil {
			jsonError(w, http.StatusServiceUnavailable, "Unable to verify this printer's paper sizes. Refresh and try again.")
			return
		}
		if !caps.supports(options.PaperSize) {
			jsonError(w, http.StatusBadRequest, "The selected paper size is not supported by this printer")
			return
		}
	}
	output, err := exec.CommandContext(r.Context(), "lp", args...).CombinedOutput()
	if err != nil {
		log.Printf("Print error: %v, output: %s", err, string(output))
		jsonError(w, http.StatusInternalServerError, fmt.Sprintf("Print job failed: %s", strings.TrimSpace(string(output))))
		return
	}
	jsonResponse(w, http.StatusOK, map[string]any{"success": true, "message": strings.TrimSpace(string(output))})
}
