package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDevicesExposeDefaultsWithoutDeviceCredentials(t *testing.T) {
	previous := appConfig
	defer func() { appConfig = previous }()
	appConfig = Config{
		Defaults: Defaults{Device: "scanner", Scan: ScanDefaults{DPI: 600, Mode: "Gray", Format: "png"}},
		Devices:  []Device{{ID: "scanner", Name: "Scanner", Scan: &ScanConfig{Driver: "escl", Auth: DeviceAuth{Type: "basic", Username: "device-user", Password: "device-secret"}}}},
	}
	recorder := httptest.NewRecorder()
	handleDevices(recorder, httptest.NewRequest("GET", "/api/devices", nil))
	if recorder.Code != 200 {
		t.Fatalf("status %d", recorder.Code)
	}
	var body struct {
		Defaults ScanDefaults `json:"scan_defaults"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Defaults.DPI != 600 || body.Defaults.Mode != "Gray" || body.Defaults.Format != "png" {
		t.Fatalf("unexpected defaults: %+v", body.Defaults)
	}
	if strings.Contains(recorder.Body.String(), "device-secret") || strings.Contains(recorder.Body.String(), "device-user") {
		t.Fatal("device credentials exposed")
	}
}

func TestLoadConfigDeviceAlias(t *testing.T) {
	previous := appConfig
	defer func() { appConfig = previous }()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("devices:\n  - id: hp\n    name: HP LaserJet\n    alias: 科工楼 107 打印机\n    print:\n      driver: cups\n      queue: HP_Queue\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := loadConfig(path); err != nil {
		t.Fatal(err)
	}
	device, err := configuredDevice("hp")
	if err != nil {
		t.Fatal(err)
	}
	if device.Alias != "科工楼 107 打印机" || device.Name != "HP LaserJet" || device.Print.Queue != "HP_Queue" {
		t.Fatalf("alias changed device identity: %+v", device)
	}
}
