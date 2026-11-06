package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/OpenPrinting/goipp"
)

type paperSize struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type paperCapabilities struct {
	Sizes   []paperSize `json:"paper_sizes"`
	Default string      `json:"default_paper_size"`
}

var mediaKeyword = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$`)

// Use the same CUPS server as lp, including client.conf and Unix socket tunnels.
// IPP works with driverless queues that no longer expose a legacy PPD file.
func loadPaperCapabilities(ctx context.Context, queue string) (paperCapabilities, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if queue == "" {
		cmd := exec.CommandContext(ctx, "lpstat", "-d")
		cmd.Env = append(os.Environ(), "LC_ALL=C")
		out, err := cmd.Output()
		if err != nil {
			return paperCapabilities{}, err
		}
		_, queue, _ = strings.Cut(strings.TrimSpace(string(out)), ": ")
		if queue == "" {
			return paperCapabilities{}, fmt.Errorf("No default CUPS queue")
		}
	}
	out, err := exec.CommandContext(ctx, "lpstat", "-H").Output()
	if err != nil {
		return paperCapabilities{}, err
	}
	server := strings.TrimSpace(string(out))
	transport := &http.Transport{}
	defer transport.CloseIdleConnections()
	host, scheme := server, "http"
	if strings.HasPrefix(server, "/") {
		host = "localhost"
		transport.DialContext = func(ctx context.Context, _, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "unix", server)
		}
	} else {
		if !strings.Contains(host, ":") {
			host = net.JoinHostPort(host, "631")
		}
		if strings.EqualFold(os.Getenv("CUPS_ENCRYPTION"), "Required") || strings.EqualFold(os.Getenv("CUPS_ENCRYPTION"), "Always") {
			scheme = "https"
		}
	}
	endpoint := (&url.URL{Scheme: scheme, Host: host, Path: "/printers/" + queue}).String()
	client := &http.Client{Transport: transport, Timeout: 8 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	return queryPaperCapabilities(ctx, client, endpoint)
}

func queryPaperCapabilities(ctx context.Context, client *http.Client, endpoint string) (paperCapabilities, error) {
	uri := strings.Replace(strings.Replace(endpoint, "https://", "ipps://", 1), "http://", "ipp://", 1)
	message := goipp.NewRequest(goipp.DefaultVersion, goipp.OpGetPrinterAttributes, 1)
	message.Operation.Add(goipp.MakeAttribute("attributes-charset", goipp.TagCharset, goipp.String("utf-8")))
	message.Operation.Add(goipp.MakeAttribute("attributes-natural-language", goipp.TagLanguage, goipp.String("en")))
	message.Operation.Add(goipp.MakeAttribute("printer-uri", goipp.TagURI, goipp.String(uri)))
	requested := goipp.MakeAttribute("requested-attributes", goipp.TagKeyword, goipp.String("media-supported"))
	requested.Values.Add(goipp.TagKeyword, goipp.String("media-default"))
	message.Operation.Add(requested)
	body, err := message.EncodeBytes()
	if err != nil {
		return paperCapabilities{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return paperCapabilities{}, err
	}
	req.Header.Set("Content-Type", goipp.ContentType)
	resp, err := client.Do(req)
	if err != nil {
		return paperCapabilities{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return paperCapabilities{}, fmt.Errorf("CUPS returned HTTP %d", resp.StatusCode)
	}
	var result goipp.Message
	if err := result.Decode(io.LimitReader(resp.Body, 1<<20)); err != nil {
		return paperCapabilities{}, err
	}
	if result.Code >= 0x0400 {
		return paperCapabilities{}, fmt.Errorf("CUPS returned IPP status %s", goipp.Status(result.Code))
	}
	caps := paperCapabilities{Sizes: []paperSize{}}
	seen := map[string]bool{}
	for _, attr := range result.Printer {
		for _, value := range attr.Values {
			keyword, ok := value.V.(goipp.String)
			if !ok {
				continue
			}
			name := string(keyword)
			if !mediaKeyword.MatchString(name) {
				continue
			}
			switch attr.Name {
			case "media-default":
				caps.Default = name
			case "media-supported":
				// These are custom-size bounds, not actual selectable paper sizes.
				if !seen[name] && !strings.HasPrefix(name, "custom_") {
					seen[name] = true
					caps.Sizes = append(caps.Sizes, paperSize{Value: name, Label: paperLabel(name)})
				}
			}
		}
	}
	if len(caps.Sizes) == 0 {
		return paperCapabilities{}, fmt.Errorf("CUPS did not report supported paper sizes")
	}
	if !seen[caps.Default] {
		caps.Default = ""
	}
	sort.SliceStable(caps.Sizes, func(i, j int) bool {
		iDefault, jDefault := caps.Sizes[i].Value == caps.Default, caps.Sizes[j].Value == caps.Default
		if iDefault != jDefault {
			return iDefault
		}
		iRank, jRank := paperRank(caps.Sizes[i].Value), paperRank(caps.Sizes[j].Value)
		if iRank != jRank {
			return iRank < jRank
		}
		return caps.Sizes[i].Label < caps.Sizes[j].Label
	})
	return caps, nil
}

func paperRank(value string) int {
	for rank, prefix := range []string{"iso_a4_", "iso_a5_", "iso_a6_", "na_letter_", "na_legal_", "jis_b5_", "iso_b5_", "jis_b6_"} {
		if strings.HasPrefix(value, prefix) {
			return rank
		}
	}
	return 100
}

func paperLabel(value string) string {
	parts := strings.Split(value, "_")
	if len(parts) != 3 {
		return value
	}
	name := strings.ToUpper(parts[1])
	switch parts[1] {
	case "letter":
		name = "Letter"
	case "legal":
		name = "Legal"
	case "executive":
		name = "Executive"
	case "number-10":
		name = "#10 Envelope"
	case "monarch":
		name = "Monarch Envelope"
	case "c5", "dl":
		name += " Envelope"
	case "small-photo":
		name = "Photo"
	case "index-4x6", "index-5x8":
		name = "Index card"
	case "foolscap":
		name = "Foolscap"
	case "oficio":
		name = "Oficio"
	case "hagaki":
		name = "Postcard (Japan)"
	case "oufuku":
		name = "Double postcard (Japan)"
	}
	if parts[0] == "jis" {
		name += " (JIS)"
	}
	dimensions := strings.ReplaceAll(parts[2], "x", " × ")
	dimensions = strings.ReplaceAll(strings.ReplaceAll(dimensions, "mm", " mm"), "in", " in")
	return name + " · " + dimensions
}

func (caps paperCapabilities) supports(value string) bool {
	for _, size := range caps.Sizes {
		if size.Value == value {
			return true
		}
	}
	return false
}
