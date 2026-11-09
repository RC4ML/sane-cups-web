# Containerized CUPS

The Web container uses `CUPS_SERVER=cups:631`. The CUPS container connects directly
to configured IPP/IPPS printers. Native eSCL scanning remains in the Web app.
Fixed-address network devices need neither privileged containers nor host
networking. Automatic multicast discovery and USB devices need separate setup;
they are not enabled by this Compose file.

## Images and persistence

GitHub Actions builds two linux/amd64 images from the same revision:

- `ghcr.io/rc4ml/sane-cups-web:sha-<revision>`
- `ghcr.io/rc4ml/sane-cups-web-cups:sha-<revision>`

Repository names are normalized to lowercase. Pull requests build and test
without publishing. The CUPS image must pass the container smoke test before it
is published. If anonymously pulling a newly created GHCR package, ensure that
package's visibility is Public as well as the Web package's visibility.

With the Compose file and your own `config.yaml` in a deployment directory:

```sh
export IMAGE_TAG=sha-<revision>
docker compose pull
docker compose up -d --no-build
docker compose exec cups cups-add-printer Example_Printer ipps://192.0.2.10:631/ipp/print
```

Use the same queue name in `config.yaml`. The helper sets A4, makes the queue
available to the Web container and sets it as the CUPS default. The printer
must be reachable during setup. If a queue already exists, the helper refuses
to replace it. For explicit maintenance, use `docker compose exec cups lpadmin`.

`cups-state` mounts at `/var/lib/cups` and stores printer definitions, PPDs,
certificates and cache. `cups-spool` mounts at `/var/spool/cups` and stores job
state and pending documents. Back up both volumes together with CUPS stopped.
Completed document files are removed; job history is retained subject to CUPS
history limits. `docker compose down` preserves named volumes; **`down -v`
deletes queues and pending documents**.

Daemon configuration under `/etc/cups`, filters and fonts remain part of the
image. Upgrading the image therefore applies configuration fixes without an
old `/etc/cups` volume masking them. Queue configuration must not be written
into the image or re-created on each startup.

## Network and access

Only trusted application containers should join the `printing` network.
Its normal bridge networking allows outbound connections to LAN printers;
do not set this network to `internal: true` without providing another egress
route. Do not publish CUPS port 631 or attach it to a shared proxy network.

The application provides a shared job queue behind external authentication.
CUPS therefore permits those internal clients to query, submit and cancel jobs,
including cancel-all. Printer administration and document retrieval are local
only. Administer queues via `docker compose exec cups`, using the local Unix
socket. There is no CUPS web UI or extra login to configure.

In a reverse-proxy deployment, attach the Web service to both the proxy network
and `printing`, attach CUPS only to `printing`, and remove the Web `ports` mapping
if the proxy reaches it by container name. Keep external authentication on all
pages, API endpoints and scan downloads.

## Migrating from host CUPS

1. Back up the host queue's device URI, defaults and PPD. Check for pending jobs;
   finish or deliberately cancel them before directing new jobs elsewhere.
2. Start the new CUPS container alongside the host daemon without publishing 631.
3. Create the required queues with the same names. Confirm the new IPP
   `media-default` and PPD `DefaultPageSize` are both A4. Reapply any additional
   device options explicitly.
4. Validate representative PDFs through the container's filters. Change the
   Web service to `CUPS_SERVER=cups:631`, remove the host socket mount and connect
   it to the dedicated network. Check capabilities, queue management and a
   deliberate physical print.
5. Keep the old host configuration for rollback until validation is complete.
   Other clients using host CUPS are separate clients with separate queues;
   move them explicitly if they should share this service's queue. Old history
   and pending jobs do not automatically move to the new server.

## Fonts and checks

The CUPS image includes Ghostscript, Poppler, CUPS filters, Noto CJK, AR PL UKai,
AR PL UMing, WenQuanYi Zen Hei and Droid fallback fonts. Explicit Ghostscript
CID mappings resolve common unembedded KaiTi, SimSun and SimHei invoice fonts.
The substitutes contain Latin as well as Chinese characters. Their typefaces
can differ from the original fonts; embedding the source fonts in a PDF remains
the best way to preserve exact appearance.

Run the automated container checks locally:

```sh
docker build -f docker/cups/Dockerfile -t sane-cups-web-cups:test .
bash tests/cups/smoke.sh sane-cups-web-cups:test
```

The test generates a synthetic PDF with unembedded Chinese fonts, checks actual
Chinese and Latin rendering, sends jobs to a virtual IPP printer, checks A4 and
remote cancellation, denies remote administration, and replaces the CUPS
container to verify held documents and disabled queues survive. It contacts
no physical printer and cleans up its containers, networks and volumes.
The virtual printer needs a test-only Avahi/DBus environment; those daemons are
not included in the production CUPS image.

Useful production diagnostics:

```sh
docker compose logs cups
docker compose exec cups lpstat -t
docker compose exec printer lpstat -H
docker compose exec printer lpoptions -p Example_Printer -l
```
