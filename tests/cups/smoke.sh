#!/usr/bin/env bash
set -euo pipefail
image=${1:-sane-cups-web-cups:test}
base=$(cd "$(dirname "$0")" && pwd)
run_id="cups-test-$$-${RANDOM}"
server="$run_id-server"
printer="$run_id-printer"
network="$run_id-network"
state="$run_id-state"
spool="$run_id-spool"
work=$(mktemp -d)

cleanup() {
    result=$?
    if (( result != 0 )); then
        docker logs "$server" >&2 || true
        docker logs "$printer" >&2 || true
        if [[ ${CUPS_TEST_KEEP:-0} == 1 ]]; then
            echo "Preserved $server, $printer, $network, $state, $spool and $work" >&2
            return
        fi
    fi
    docker rm -f "$server" >/dev/null 2>&1 || true
    docker rm -f "$printer" >/dev/null 2>&1 || true
    docker network rm "$network" >/dev/null 2>&1 || true
    docker volume rm "$state" "$spool" >/dev/null 2>&1 || true
    rm -rf "$work"
}
trap cleanup EXIT
client() {
    docker run --rm --network "$network" -e CUPS_SERVER=cups:631 \
        -v "$work:/test:ro,z" "$image" timeout 15s "$@"
}
assert_no_jobs() {
    local jobs
    jobs=$(client lpstat -o CI_Printer)
    test -z "$jobs"
}
start_server() {
    docker run -d --name "$server" --network "$network" --network-alias cups \
        -v "$state:/var/lib/cups" -v "$spool:/var/spool/cups" \
        "$image" >/dev/null
    for ((i=0; i<30; i++)); do
        if docker exec "$server" lpstat -h /run/cups/cups.sock -r 2>/dev/null | grep -qx 'scheduler is running'; then
            return
        fi
        sleep 1
    done
    echo 'CUPS did not start' >&2
    return 1
}

python3 "$base/fixture.py" make "$work/mixed.pdf"
cp "$base/check-printer.test" "$work/check-printer.test"
chmod 755 "$work"
docker network create "$network" >/dev/null
docker volume create "$state" >/dev/null
docker volume create "$spool" >/dev/null
start_server
docker cp "$work/mixed.pdf" "$server:/tmp/mixed.pdf"
docker exec "$server" gs -dSAFER -dBATCH -dNOPAUSE -sDEVICE=pgmraw -r72 \
    -o /tmp/mixed.pgm /tmp/mixed.pdf >"$work/render.log" 2>&1
cat "$work/render.log"
if grep -Eq 'NimbusSans|error reading|Substituting|Could not find' "$work/render.log"; then
    echo 'Unexpected font fallback' >&2
    exit 1
fi
docker cp "$server:/tmp/mixed.pgm" "$work/mixed.pgm"
python3 "$base/fixture.py" check "$work/mixed.pgm"

# A virtual printer receives test jobs locally; no real printer is contacted.
docker build -q -f "$base/Dockerfile.printer" -t sane-cups-virtual-printer:test "$base/../.."
docker run -d --name "$printer" --hostname virtual-printer --network "$network" --network-alias virtual-printer \
    sane-cups-virtual-printer:test >/dev/null
printer_ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$printer")
for ((i=0; i<15; i++)); do
    if docker exec "$server" timeout 3s ipptool -T 2 "ipp://$printer_ip:8631/ipp/print" \
        /usr/share/cups/ipptool/get-printer-attributes.test >/dev/null 2>&1; then break; fi
    sleep 1
done
docker exec "$server" cups-add-printer CI_Printer "ipp://$printer_ip:8631/ipp/print"
client lpstat -p CI_Printer
client lpoptions -p CI_Printer -l | grep 'PageSize.*\*A4'
client ipptool -t ipp://cups:631/printers/CI_Printer /test/check-printer.test

# Remote clients can manage shared jobs but cannot administer the server.
if admin_output=$(client lpadmin -x CI_Printer 2>&1); then
    echo 'Remote printer administration unexpectedly succeeded' >&2
    exit 1
fi
grep -E 'Forbidden|Unauthorized' <<<"$admin_output"
client lp -d CI_Printer -H hold /test/mixed.pdf
client cancel -a CI_Printer
assert_no_jobs

docker exec "$server" sh -c 'cupsfilter -p /var/lib/cups/ppd/CI_Printer.ppd -i application/pdf -m image/urf -o media=A4 -o fit-to-page /tmp/mixed.pdf >/tmp/filtered.urf'
docker exec "$server" sh -c 'test "$(head -c 7 /tmp/filtered.urf)" = UNIRAST'
client lp -d CI_Printer -o media=iso_a4_210x297mm /test/mixed.pdf
for ((i=0; i<30; i++)); do
    jobs=$(client lpstat -o CI_Printer)
    if test -z "$jobs"; then break; fi
    sleep 1
done
assert_no_jobs
docker exec "$printer" sh -c 'find /tmp/printed -type f -name "*.urf" | grep .'

# Queue defaults, held documents and disabled state must survive replacement.
client lp -d CI_Printer -H hold /test/mixed.pdf
docker exec "$server" cupsdisable CI_Printer
docker stop -t 10 "$server" >/dev/null
docker rm "$server" >/dev/null
start_server
client lpstat -p CI_Printer | grep disabled
client lpstat -o CI_Printer | grep CI_Printer
client lpoptions -p CI_Printer -l | grep 'PageSize.*\*A4'
client ipptool -t ipp://cups:631/printers/CI_Printer /test/check-printer.test
client cancel -a CI_Printer
assert_no_jobs
echo 'CUPS container smoke tests passed'
