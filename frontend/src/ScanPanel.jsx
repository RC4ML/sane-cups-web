import { useEffect, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Callout,
  Flex,
  Grid,
  SegmentedControl,
  Spinner,
  Text,
} from '@radix-ui/themes';
import { DownloadIcon, FilePlusIcon, ImageIcon } from '@radix-ui/react-icons';
import { fileKind, post } from './api';
import { Choice, Confirm, Empty, Field, Input, Panel } from './ui';
import Preview from './Preview';
import Documents from './Documents';

export default function ScanPanel({
  device,
  defaults,
  blocked,
  notify,
  reportError,
  onLockChange,
  documents,
  onPrint,
}) {
  const [mode, setMode] = useState('single');
  const [dpi, setDpi] = useState('300');
  const [color, setColor] = useState('Color');
  const [format, setFormat] = useState('pdf');
  const [name, setName] = useState('');
  const [session, setSession] = useState(null);
  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState(null);
  const [settingsTouched, setSettingsTouched] = useState(false);
  const enabled = !!device?.scan;
  const multiple = mode === 'multiple';
  const locked = !!session || !!busy;

  useEffect(() => {
    if (!settingsTouched && defaults) {
      setDpi(String(defaults.dpi || 300));
      setColor(defaults.mode || 'Color');
      setFormat(defaults.format || 'pdf');
    }
  }, [defaults, settingsTouched]);
  useEffect(() => {
    onLockChange(locked);
    return () => onLockChange(false);
  }, [locked, onLockChange]);
  useEffect(() => {
    if (!session) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [session]);

  async function scan() {
    if (busy || blocked || !enabled) return;
    setBusy('scan');
    try {
      const settings = { device_id: device.id, dpi: Number(dpi), mode: color };
      if (multiple) {
        let id = session;
        if (!id) {
          const data = await post('/api/scan/multipage/start', {});
          id = data.session_id;
          setSession(id);
        }
        const page = await post('/api/scan/multipage/page', { ...settings, session_id: id });
        setPages((old) => [...old, page]);
        notify(`Page ${page.page_number} scanned. Add another page or save your PDF.`);
      } else {
        const data = await post('/api/scan', { ...settings, format, custom_name: name.trim() });
        setPreview({ name: data.filename, url: data.url, format });
        documents.reload();
        notify('Scan saved.');
      }
    } catch (e) {
      reportError(e);
    } finally {
      setBusy('');
    }
  }
  async function finish() {
    if (!session || !pages.length || busy || blocked) return;
    setBusy('finish');
    try {
      const data = await post('/api/scan/multipage/finish', {
        session_id: session,
        custom_name: name.trim(),
      });
      setPreview({ name: data.filename, url: data.url, format: 'pdf' });
      setSession(null);
      setPages([]);
      documents.reload();
      notify('Multi-page PDF saved.');
    } catch (e) {
      reportError(e);
    } finally {
      setBusy('');
    }
  }
  async function discard() {
    setBusy('discard');
    try {
      await post('/api/scan/multipage/cancel', { session_id: session });
      setSession(null);
      setPages([]);
      notify('Unfinished scan discarded.');
    } catch (e) {
      reportError(e);
    } finally {
      setBusy('');
    }
  }
  const setting = (setter) => (value) => {
    setSettingsTouched(true);
    setter(value);
  };

  return (
    <Flex direction="column" gap="5">
      <Grid columns={{ initial: '1', md: '2' }} gap="5" align="start">
        <Panel title="Scan a document" description="Place a page on the scanner to get started.">
          {!enabled && (
            <Callout.Root color="gray" mb="4">
              <Callout.Text>
                This device does not support scanning. Your saved documents are available below.
              </Callout.Text>
            </Callout.Root>
          )}
          <Flex direction="column" gap="4">
            <Field label="Output">
              <SegmentedControl.Root
                aria-label="Scan output"
                value={mode}
                onValueChange={setMode}
                disabled={locked || blocked || !enabled}
              >
                <SegmentedControl.Item value="single" aria-label="Single page">
                  Single page
                </SegmentedControl.Item>
                <SegmentedControl.Item value="multiple" aria-label="Multi-page PDF">
                  Multi-page PDF
                </SegmentedControl.Item>
              </SegmentedControl.Root>
            </Field>
            <Grid columns={{ initial: '1', xs: '2' }} gap="4">
              <Choice
                label="Resolution"
                value={dpi}
                onChange={setting(setDpi)}
                disabled={!!busy || blocked || !enabled}
                options={[
                  ['150', '150 DPI · Draft'],
                  ['300', '300 DPI · Standard'],
                  ['600', '600 DPI · High quality'],
                ]}
              />
              <Choice
                label="Color"
                value={color}
                onChange={setting(setColor)}
                disabled={!!busy || blocked || !enabled}
                options={[
                  ['Color', 'Color'],
                  ['Gray', 'Grayscale'],
                  ['Lineart', 'Black & white'],
                ]}
              />
            </Grid>
            {!multiple && (
              <Choice
                label="File format"
                value={format}
                onChange={setting(setFormat)}
                disabled={!!busy || blocked || !enabled}
                options={[
                  ['pdf', 'PDF document'],
                  ['png', 'PNG image'],
                  ['jpg', 'JPEG image'],
                ]}
              />
            )}
            <Input
              label="Filename prefix"
              placeholder="e.g. meeting_notes"
              hint="Optional. A timestamp is added automatically."
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={!!busy || blocked || !enabled}
            />
            {multiple && (
              <Text size="2" color="gray">
                Scan each page, then save them together as one PDF.
              </Text>
            )}
            <Flex gap="3" align="center" wrap="wrap" mt="2">
              <Button
                onClick={scan}
                disabled={!!busy || blocked || !enabled}
                loading={busy === 'scan'}
              >
                <FilePlusIcon />
                {multiple && pages.length ? 'Scan next page' : 'Scan page'}
              </Button>
              {multiple && (
                <Button
                  variant="soft"
                  onClick={finish}
                  disabled={!pages.length || !!busy || blocked}
                  loading={busy === 'finish'}
                >
                  Save PDF{pages.length ? ` (${pages.length} pages)` : ''}
                </Button>
              )}
            </Flex>
            {session && (
              <Flex justify="between" align="center" wrap="wrap" gap="3">
                <Text size="1" color="gray">
                  {pages.length} unsaved {pages.length === 1 ? 'page' : 'pages'}
                </Text>
                <Confirm
                  title="Discard this scan?"
                  description="The unsaved pages in this session will be deleted. Saved documents are kept."
                  label="Discard pages"
                  busy={!!busy}
                  onConfirm={discard}
                >
                  <Button color="red" variant="soft" disabled={!!busy || blocked}>
                    Discard
                  </Button>
                </Confirm>
              </Flex>
            )}
          </Flex>
        </Panel>
        <Panel
          title={session ? 'Pages to combine' : 'Preview'}
          actions={
            session ? (
              <Badge color="gray">{pages.length} pages</Badge>
            ) : (
              preview && (
                <Flex gap="2" align="center" wrap="wrap">
                  <Button variant="soft" color="gray" asChild>
                    <a href={`${preview.url}?download=true`} download={preview.name}>
                      <DownloadIcon />
                      Download
                    </a>
                  </Button>
                  {device?.print && fileKind(preview.name) === 'pdf' && (
                    <Button variant="soft" disabled={blocked} onClick={() => onPrint(preview)}>
                      Print
                    </Button>
                  )}
                </Flex>
              )
            )
          }
        >
          {busy && (
            <Flex align="center" gap="2" mb="4" role="status">
              <Spinner />
              <Text size="2">
                {busy === 'finish'
                  ? 'Saving your PDF…'
                  : busy === 'discard'
                    ? 'Discarding pages…'
                    : 'Scanning. Please keep the document in place…'}
              </Text>
            </Flex>
          )}
          {session ? (
            pages.length ? (
              <Grid columns={{ initial: '2', sm: '3' }} gap="3">
                {pages.map((page) => (
                  <Box key={page.page_filename} className="scan-page">
                    <img src={page.url} alt={`Scanned page ${page.page_number}`} />
                    <Text as="p" size="1" color="gray" align="center" mt="2">
                      Page {page.page_number}
                    </Text>
                  </Box>
                ))}
              </Grid>
            ) : (
              <Empty icon={<ImageIcon width="28" height="28" />}>
                Your scanned pages will appear here.
              </Empty>
            )
          ) : preview ? (
            <>
              <Preview url={preview.url} name={preview.name} />
              <Text as="p" size="1" color="gray" mt="3" className="break-text">
                {preview.name}
              </Text>
            </>
          ) : (
            <Empty icon={<ImageIcon width="28" height="28" />}>
              Preview your scan here before downloading or printing.
            </Empty>
          )}
        </Panel>
      </Grid>
      <Documents
        {...documents}
        canPrint={!!device?.print}
        onPrint={onPrint}
        blocked={blocked}
        notify={notify}
        reportError={reportError}
      />
    </Flex>
  );
}
