import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Container,
  Flex,
  Select,
  Tabs,
  Text,
  Theme,
} from '@radix-ui/themes';
import { ExclamationTriangleIcon, ReloadIcon } from '@radix-ui/react-icons';
import { deviceLabel, request, SignInRequired } from './api';
import PrintPanel from './PrintPanel';
import ScanPanel from './ScanPanel';

export default function App() {
  const [appearance, setAppearance] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  );
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [defaults, setDefaults] = useState(null);
  const [deviceError, setDeviceError] = useState('');
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [deviceRefresh, setDeviceRefresh] = useState(0);
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [tab, setTab] = useState('print');
  const [locked, setLocked] = useState(false);
  const [source, setSource] = useState(null);
  const [scans, setScans] = useState([]);
  const [scansError, setScansError] = useState('');
  const [loadingScans, setLoadingScans] = useState(true);
  const [scansRefresh, setScansRefresh] = useState(0);
  const [notice, setNotice] = useState(null);
  const [expired, setExpired] = useState(false);
  const device = devices.find((item) => item.id === deviceId);

  const notify = useCallback((message) => setNotice({ message, error: false }), []);
  const reportError = useCallback((error, quiet = false) => {
    if (error instanceof SignInRequired) setExpired(true);
    else if (!quiet) setNotice({ message: error.message, error: true });
  }, []);
  const reloadScans = useCallback(() => setScansRefresh((v) => v + 1), []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = (e) => setAppearance(e.matches ? 'dark' : 'light');
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingDevices(true);
    setDeviceError('');
    request('/api/devices', { signal: controller.signal })
      .then((data) => {
        setDevices(data.devices || []);
        setDefaults(data.scan_defaults);
        const remembered = localStorage.getItem('device_id');
        const selected =
          data.devices?.find((d) => d.id === remembered) ||
          data.devices?.find((d) => d.id === data.default_device) ||
          data.devices?.[0];
        setDeviceId(selected?.id || '');
        if (selected && !selected.print) setTab('scan');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setDeviceError(e.message);
          reportError(e, true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingDevices(false);
      });
    return () => controller.abort();
  }, [deviceRefresh, reportError]);
  useEffect(() => {
    if (!device || expired) return;
    const controller = new AbortController();
    setStatus(null);
    setStatusError('');
    const load = async () => {
      try {
        const data = await request(`/api/status?device_id=${encodeURIComponent(device.id)}`, {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setStatus(data);
          setStatusError('');
        }
      } catch (e) {
        if (e.name !== 'AbortError' && !controller.signal.aborted) {
          setStatus(null);
          setStatusError(e.message);
          reportError(e, true);
        }
      }
    };
    load();
    const timer = setInterval(load, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [device, statusRefresh, expired, reportError]);
  useEffect(() => {
    if (expired) return;
    const controller = new AbortController();
    setLoadingScans(true);
    request('/api/scans', { signal: controller.signal })
      .then((data) => {
        setScans(data.scans || []);
        setScansError('');
      })
      .catch((e) => {
        if (e.name !== 'AbortError') {
          setScansError(e.message);
          reportError(e, true);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingScans(false);
      });
    return () => controller.abort();
  }, [scansRefresh, expired, reportError]);

  function changeDevice(id) {
    setDeviceId(id);
    localStorage.setItem('device_id', id);
    if (!devices.find((d) => d.id === id)?.print) setTab('scan');
  }
  function printSaved(scan) {
    setSource({ name: scan.name, url: scan.url });
    setTab('print');
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  return (
    <Theme
      appearance={appearance}
      accentColor="indigo"
      grayColor="slate"
      radius="medium"
      scaling="100%"
      panelBackground="solid"
    >
      <Box className="app-shell">
        <Container size="4" px={{ initial: '4', sm: '6' }}>
          <section className="device-bar" aria-label="Device selection">
            <Flex justify="between" align="center" wrap="wrap" gap="4">
              <Flex direction="column" gap="2" className="device-field">
                <Text as="label" htmlFor="device" size="2" weight="medium">
                  Device
                </Text>
                <Select.Root
                  value={deviceId}
                  onValueChange={changeDevice}
                  disabled={loadingDevices || !devices.length || locked || expired}
                >
                  <Select.Trigger
                    id="device"
                    aria-label="Device"
                    placeholder={loadingDevices ? 'Loading devices…' : 'No devices configured'}
                  />
                  <Select.Content position="popper">
                    {devices.map((d) => (
                      <Select.Item key={d.id} value={d.id}>
                        {deviceLabel(d)}
                      </Select.Item>
                    ))}
                  </Select.Content>
                </Select.Root>
                {locked && (
                  <Text size="1" color="gray">
                    Finish or discard your scan before changing devices.
                  </Text>
                )}
              </Flex>
              <Flex gap="2" align="center" wrap="wrap">
                {device?.print && (
                  <DeviceBadge
                    label="Printer"
                    state={
                      statusError
                        ? 'Unavailable'
                        : !status
                          ? 'Checking'
                          : status.printer?.online
                            ? 'Ready'
                            : 'Offline'
                    }
                  />
                )}
                {device?.scan && (
                  <DeviceBadge
                    label="Scanner"
                    state={
                      statusError
                        ? 'Unavailable'
                        : !status
                          ? 'Checking'
                          : status.scanner?.online
                            ? 'Ready'
                            : 'Offline'
                    }
                  />
                )}
                <Button
                  variant="soft"
                  color="gray"
                  aria-label="Refresh device status"
                  title="Refresh device status"
                  className="device-refresh"
                  disabled={!device || expired}
                  onClick={() => setStatusRefresh((v) => v + 1)}
                >
                  <ReloadIcon />
                  <span className="refresh-label">Refresh</span>
                </Button>
              </Flex>
            </Flex>
            {deviceError && (
              <Callout.Root color="red" mt="4">
                <Callout.Text>{deviceError}</Callout.Text>
                <Button size="1" variant="soft" onClick={() => setDeviceRefresh((v) => v + 1)}>
                  Retry
                </Button>
              </Callout.Root>
            )}
            {!loadingDevices && !deviceError && !devices.length && (
              <Text as="p" size="2" color="gray" mt="3">
                No devices configured. Add a device to the server configuration to begin.
              </Text>
            )}
            {statusError && (
              <Text as="p" color="red" size="2" mt="3">
                Unable to refresh device status: {statusError}
              </Text>
            )}
          </section>
          {expired && (
            <Callout.Root color="amber" mb="4" role="alert">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                Your session has expired. Sign in again; your print job will not be submitted
                automatically.
              </Callout.Text>
              <Button asChild size="2">
                <a
                  href={`/oauth2/start?rd=${encodeURIComponent(window.location.origin + window.location.pathname)}`}
                >
                  Sign in with GitHub
                </a>
              </Button>
            </Callout.Root>
          )}
          {notice && (
            <Callout.Root
              color={notice.error ? 'red' : 'green'}
              mb="4"
              role={notice.error ? 'alert' : 'status'}
            >
              <Callout.Text>{notice.message}</Callout.Text>
              <Button
                size="1"
                variant="soft"
                color="gray"
                onClick={() => setNotice(null)}
                aria-label="Dismiss message"
              >
                Dismiss
              </Button>
            </Callout.Root>
          )}
          <Tabs.Root value={tab} onValueChange={setTab}>
            <Tabs.List size="2" mb="5" aria-label="Workspace">
              <Tabs.Trigger value="print" aria-label="Print">
                Print
              </Tabs.Trigger>
              <Tabs.Trigger value="scan" aria-label="Scan">
                Scan
              </Tabs.Trigger>
            </Tabs.List>
            <main>
              <Tabs.Content value="print" forceMount hidden={tab !== 'print'} className="workspace">
                <PrintPanel
                  device={device}
                  active={tab === 'print'}
                  blocked={expired}
                  notify={notify}
                  reportError={reportError}
                  source={source}
                  onSourceChange={setSource}
                />
              </Tabs.Content>
              <Tabs.Content value="scan" forceMount hidden={tab !== 'scan'} className="workspace">
                <ScanPanel
                  device={device}
                  defaults={defaults}
                  blocked={expired}
                  notify={notify}
                  reportError={reportError}
                  onLockChange={setLocked}
                  onPrint={printSaved}
                  documents={{
                    scans,
                    error: scansError,
                    loading: loadingScans,
                    reload: reloadScans,
                  }}
                />
              </Tabs.Content>
            </main>
          </Tabs.Root>
        </Container>
      </Box>
    </Theme>
  );
}
function DeviceBadge({ label, state }) {
  return (
    <Badge variant="soft" color={state === 'Ready' ? 'green' : 'gray'} size="2">
      <span className="status-dot" />
      {label}: {state}
    </Badge>
  );
}
