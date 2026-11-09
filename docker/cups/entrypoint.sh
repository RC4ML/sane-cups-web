#!/bin/sh
set -eu

if [ "$#" -gt 0 ]; then
    exec "$@"
fi

install -d -m 0755 -o root -g lp /run/cups /var/lib/cups /var/lib/cups/ppd
install -d -m 0700 -o root -g lp /var/lib/cups/ssl
install -d -m 0770 -o root -g lp /var/lib/cups/cache
install -d -m 0710 -o root -g lp /var/spool/cups
install -d -m 1770 -o lp -g lp /var/spool/cups/tmp

exec /usr/sbin/cupsd -f -c /etc/cups/cupsd.conf -s /etc/cups/cups-files.conf
