# Scanner & Printer Web Hub

A lightweight, self-hosted web interface and REST API for network and local flatbed scanners and CUPS printers. Built with **Go**, **React**, and **Radix Themes** (Dockerized).

---

## ✨ Features

- **⚡ Quick Scanner**: Acquire high-resolution scans (150 / 300 / 600 DPI, Color / Grayscale / B&W Lineart) directly into PNG, JPEG, or PDF.
- **📑 Multi-Page PDF Creator**: Scan multiple physical pages sequentially with live thumbnail previews and compile them into a unified PDF document.
- **🖼️ Document Gallery**: Browse, search, preview in-browser, download, and manage past scanned documents.
- **🖨️ CUPS Print Center**: Upload PDF documents or re-print saved scans, with supported paper sizes, scaling, page ranges, odd/even pages, reverse order, collated copies, and queue monitoring.
- **🔍 Dynamic Auto-Discovery & Static IP Modes**: Automatically discovers network scanners (via SANE / mDNS / WSD) or allows configuring a static IP.
- **🚀 100% Pure Go Processing**: Single & multi-page PDF generation without heavyweight external Python/Pillow dependencies.
- **🎨 Sleek Modern UI**: Clean, neutral, responsive interface with drag-and-drop uploads and scan animations.

---

## 🚀 Quick Start (Docker Compose)

The included Compose file runs the Web app and a separate CUPS server. CUPS,
PDF filters, Ghostscript and Chinese fonts are packaged together; no host CUPS
installation or socket mount is needed. Queue definitions and pending jobs
persist in Docker volumes.

### 1. Configure the device

Copy `config.example.yaml` to `config.yaml`. Set the scanner's eSCL endpoint and
the CUPS queue name; the example uses `Example_Printer`.

### 2. Start the services and create the queue

```bash
docker compose up -d --build
docker compose exec cups cups-add-printer Example_Printer ipps://192.0.2.10:631/ipp/print
```

Replace the example IP with your printer's address. Queue setup queries the
printer's capabilities and sets A4 as the default. Run it once per printer;
restarts preserve existing queues and do not re-enable paused printers.

Access the web interface at **`http://localhost:8085`**. The example binds only
to loopback. For shared access, put the Web service behind an authenticated
reverse proxy. CUPS has no published host port and must remain on the dedicated
`printing` network with trusted application clients.

Published images are `ghcr.io/rc4ml/sane-cups-web` and
`ghcr.io/rc4ml/sane-cups-web-cups`, with matching `sha-…` and release tags.
Set `IMAGE_TAG` to pin a deployment. See [CUPS operation and migration](docs/cups.md)
for image-only deployment, backup, host migration and validation commands.

---

## ⚙️ Configuration

All application and device settings live in `/app/config.yaml`. Copy
`config.example.yaml` to `config.yaml` and edit it before starting the service.
Each item in `devices` represents a logical scanner, printer, or multifunction
device. An optional `alias` provides a friendly display name (for example
`alias: 科工楼 107 打印机`) without changing the device ID or CUPS queue.
Native `escl` scanning supports HTTP or HTTPS, optional Basic
authentication, normal CA verification, a custom CA, or a SHA-256 certificate
pin. Set `tls.verify: false` when compatibility with a self-signed device is
preferred. The `sane` scan driver remains available for other SANE backends.
CUPS controls whether a configured print queue uses IPP, IPPS, or authentication.


---

## 📡 REST API Endpoints

- `GET /api/status` - Query scanner connectivity and CUPS printer queue state.
- `POST /api/scan` - Trigger a single-page scan (`{ dpi, mode, format, custom_name }`).
- `POST /api/scan/multipage/start` - Initialize a multi-page scan session.
- `POST /api/scan/multipage/page` - Add a page to the active session.
- `POST /api/scan/multipage/finish` - Merge session pages into a compiled PDF.
- `POST /api/scan/multipage/cancel` - Discard an active multi-page session.
- `GET /api/scans` - List all archived scanned documents.
- `GET /api/scans/{filename}` - View / download a specific scanned document.
- `DELETE /api/scans/{filename}` - Delete a document from the archive.
- `GET /api/printers` - Query active CUPS queues and pending print jobs.
- `POST /api/print` - Submit a document (multipart file or existing scan) to print.
- `POST /api/print/cancel` - Cancel a specific print job or all active jobs.

### Printing options and document formats

Both multipart uploads and JSON requests for saved scans accept:

| Field | Values | Default |
| --- | --- | --- |
| `copies` | Integer from 1 to 20 | `1` |
| `page_ranges` | Original page numbers, e.g. `2-5,8` | All pages |
| `page_set` | `all`, `odd`, `even` | `all` |
| `output_order` | `normal`, `reverse` | `normal` |
| `collate` | Boolean (string `true` / `false` in multipart) | `true` |
| `paper_size` | IPP media keyword reported by this queue, e.g. `iso_a4_210x297mm` | CUPS queue default when omitted |
| `scaling` | `fit` or `actual` (100%, may crop) | `fit` |

Odd/even selection always refers to original document page numbers. For example,
pages `2-5`, `even`, and `reverse` print pages **4, 2**. Overlapping ranges are
deduplicated. An explicit range combined with odd/even selection is limited to
10,000 selected pages to bound the CUPS command argument. Invalid options and
empty selections are rejected. One document page per sheet is explicitly set;
paper size and scaling are explicit, while other printer-specific settings remain under CUPS queue configuration. Preview
shows the original document, while selection and ordering apply at submission.

For Word, Excel, and PowerPoint, export to **PDF from the original editor**,
embedding fonts where supported, then inspect the PDF preview. This is the
recommended path for preserving Chinese text, pagination, and complex layouts.
Printing accepts PDF only, checked by extension and PDF header. Office conversion is intentionally out of scope. Image scans remain available for preview and download, but their Print buttons are hidden.
See [LibreOffice's compatibility notes](https://help.libreoffice.org/latest/en-US/text/shared/guide/ms_import_export_limitations.html).

Paper sizes and the current queue default are queried using IPP `Get-Printer-Attributes`
through the same CUPS server reported by `lpstat -H`, including Unix socket tunnels.
The UI selects that default and submits its explicit media keyword. Unsupported
paper sizes are rejected before submission. When capabilities cannot be read, the
UI reports the problem and offers the CUPS default rather than inventing a list.
The queue API includes `paper_sizes`, `default_paper_size`, and `paper_sizes_error`.
A small pure-Go IPP dependency is included; no extra runtime packages are required.
Network CUPS uses system certificate verification; `CUPS_ENCRYPTION=Required` or
`Always` selects HTTPS. A local/shared Unix socket needs no additional TLS setup.

A4 paper loaded in a printer does not override a CUPS queue configured for Letter.
The bundled `cups-add-printer` helper sets `PageSize=A4` after generating the
driver, allowing CUPS to derive the matching IPP `media-default`. This avoids
stale or duplicate defaults in CUPS 2.4.10. When changing a queue manually,
verify both the PPD default and the IPP default reported by the application.
Previously submitted jobs retain their original media requirement. Paper
selection describes the requested sheet, not the PDF page size; `Fit to paper`
scales content into the printable area.

The application uses CUPS `media`, `print-scaling`, `page-set`, `outputorder`, `Collate`, and page ranges.
These options require a CUPS queue with appropriate document filters; raw queues
may ignore them. See [CUPS printing options](https://www.cups.org/doc/options.html).

---

## 📄 License

MIT License


## Frontend development

Requires Node.js 22.12+ (or a supported newer LTS) and Go 1.24+.

```sh
npm ci
npm run dev
```

Vite serves the frontend locally and proxies `/api` to the Go service at
`127.0.0.1:8085`. The default workspace is Print. Scan combines single-page scans,
multi-page PDF sessions, previews and saved documents in one page.

```sh
npm test
npm run build
go test ./...
```

Frontend sources live in `frontend/`. `dist/` is generated by Vite and must not
be edited manually. Point `server.static_directory` at that directory when
running the Go server locally. The Dockerfile builds both frontend and backend;
Node.js is not needed in the runtime image. PDF.js is vendored under
`frontend/public/vendor/` and served locally, including its worker and license.

## Authentication and deployment

The application has no password login, HTTP Basic authentication, or login
session cookies. Protect **all** routes, including APIs and document downloads,
with an authentication proxy such as OAuth2 Proxy and Nginx `auth_request`.
Remove the legacy `authentication` block from configuration. Do not expose the
backend directly to untrusted clients; bind local development to loopback.

For browser requests, the proxy may redirect to GitHub login. For `/api/`
requests, return HTTP 401 when the session expires. The UI offers a sign-in link
using `/oauth2/start`, and never automatically retries a print or scan operation.
Device-level eSCL authentication remains supported and is unrelated to web login.
