package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/OpenPrinting/goipp"
)

func paperTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var request goipp.Message
		if err := request.Decode(r.Body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		if request.Code != goipp.Code(goipp.OpGetPrinterAttributes) {
			t.Error("expected Get-Printer-Attributes")
		}
		response := goipp.NewResponse(goipp.DefaultVersion, goipp.StatusOk, request.RequestID)
		response.Printer.Add(goipp.MakeAttribute("media-default", goipp.TagKeyword, goipp.String("iso_a4_210x297mm")))
		sizes := goipp.MakeAttribute("media-supported", goipp.TagKeyword, goipp.String("na_letter_8.5x11in"))
		for _, value := range []string{"iso_a4_210x297mm", "iso_a5_148x210mm", "iso_a4_210x297mm", "custom_min_3x5in", "custom_max_8.5x14in", "invalid,media"} {
			sizes.Values.Add(goipp.TagKeyword, goipp.String(value))
		}
		response.Printer.Add(sizes)
		w.Header().Set("Content-Type", goipp.ContentType)
		if err := response.Encode(w); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(server.Close)
	return server
}

func TestPaperCapabilitiesFromIPP(t *testing.T) {
	server := paperTestServer(t)
	caps, err := queryPaperCapabilities(context.Background(), server.Client(), server.URL+"/printers/Office")
	if err != nil {
		t.Fatal(err)
	}
	if caps.Default != "iso_a4_210x297mm" || len(caps.Sizes) != 3 {
		t.Fatalf("unexpected capabilities: %+v", caps)
	}
	if caps.Sizes[0].Value != caps.Default || caps.Sizes[0].Label != "A4 · 210 × 297 mm" {
		t.Fatalf("bad default label/order: %+v", caps.Sizes)
	}
	if !caps.supports("iso_a5_148x210mm") || caps.supports("iso_a3_297x420mm") {
		t.Fatal("incorrect supported sizes")
	}
}

func TestPaperCapabilitiesFailure(t *testing.T) {
	for _, code := range []int{401, 500} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(code) }))
		_, err := queryPaperCapabilities(context.Background(), server.Client(), server.URL)
		server.Close()
		if err == nil {
			t.Fatalf("HTTP %d must fail", code)
		}
	}
}
