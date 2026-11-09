#!/bin/sh
set -eu

if [ "$#" -ne 2 ]; then
    echo "Usage: cups-add-printer QUEUE ipp[s]://PRINTER/ipp/print" >&2
    exit 2
fi
queue=$1
uri=$2
case "$queue" in
    ''|[!A-Za-z0-9]*|*[!A-Za-z0-9_.-]*) echo "Invalid queue name" >&2; exit 2 ;;
esac
case "$uri" in
    ipp://?*|ipps://?*) ;;
    *) echo "An IPP or IPPS printer URI is required" >&2; exit 2 ;;
esac

# Local administration never needs a remotely accessible CUPS admin account.
export CUPS_SERVER=/run/cups/cups.sock
if lpstat -p "$queue" >/dev/null 2>&1; then
    echo "Queue $queue already exists; use lpadmin explicitly to change it." >&2
    exit 1
fi

timeout 45s lpadmin -p "$queue" -v "$uri" -m everywhere -E \
    -o printer-is-shared=true \
    -o printer-error-policy=stop-printer
# Apply defaults after driver generation so the cached IPP attributes also
# reflect A4, rather than retaining the printer's initial Letter default.
# Let CUPS derive media-default from the PPD. Setting both creates duplicate
# media-default IPP attributes on CUPS 2.4.10.
lpadmin -p "$queue" -o PageSize=A4
lpadmin -d "$queue"
lpstat -p "$queue"
