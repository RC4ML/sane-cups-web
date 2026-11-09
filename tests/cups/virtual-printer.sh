#!/bin/sh
set -eu
# Debian's ippeveprinter needs DNS-SD initialization even with advertisements off.
mkdir -p /run/dbus /tmp/printed
dbus-daemon --system --fork
avahi-daemon --daemonize --no-chroot
exec ippeveprinter -p 8631 -r off \
    -f image/urf -k -d /tmp/printed 'CI Printer'
