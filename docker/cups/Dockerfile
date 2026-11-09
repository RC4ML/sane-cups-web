FROM debian:trixie-slim

# Keep the complete rendering environment in this image, including CID fonts.
RUN apt-get update && apt-get install -y --no-install-recommends \
    cups cups-client cups-filters cups-ipp-utils \
    ghostscript poppler-utils fontconfig ca-certificates \
    fonts-noto-cjk fonts-arphic-ukai fonts-arphic-uming \
    fonts-wqy-zenhei fonts-droid-fallback \
    && rm -rf /var/lib/apt/lists/*

COPY docker/cups/cidfmap.conf /etc/ghostscript/cidfmap.d/99-sane-cups-web.conf
RUN update-gsfontmap && fc-cache -f

COPY docker/cups/cupsd.conf docker/cups/cups-files.conf /etc/cups/
COPY --chmod=755 docker/cups/entrypoint.sh /usr/local/bin/cups-entrypoint
COPY --chmod=755 docker/cups/add-printer.sh /usr/local/bin/cups-add-printer

# Persist queue definitions/PPDs and spool data separately from image config.
VOLUME ["/var/lib/cups", "/var/spool/cups"]
EXPOSE 631
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
    CMD LC_ALL=C lpstat -h /run/cups/cups.sock -r | grep -qx 'scheduler is running'
ENTRYPOINT ["cups-entrypoint"]
