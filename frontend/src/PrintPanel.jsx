import { useEffect, useRef, useState } from 'react';
import { Badge, Box, Button, Callout, Checkbox, Flex, Grid, Spinner, Text } from '@radix-ui/themes';
import { FileTextIcon, ReloadIcon, UploadIcon } from '@radix-ui/react-icons';
import { deviceLabel, fileKind, post, request, selectedPageCount, validatePageRange } from './api';
import { Choice, Confirm, Empty, Input, Panel } from './ui';
import Preview from './Preview';

export default function PrintPanel({
  device,
  active,
  blocked,
  notify,
  reportError,
  source,
  onSourceChange,
}) {
  const [copies, setCopies] = useState('1');
  const [range, setRange] = useState('');
  const [pages, setPages] = useState(null);
  const [pageSet, setPageSet] = useState('all');
  const [outputOrder, setOutputOrder] = useState('normal');
  const [collate, setCollate] = useState(true);
  const [paperSize, setPaperSize] = useState('');
  const [scaling, setScaling] = useState('fit');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [queue, setQueue] = useState(null);
  const [queueError, setQueueError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const input = useRef(null);
  const enabled = !!device?.print;
  const paperSizes = queue?.paper_sizes || [];
  const selectedPaper = paperSize || queue?.default_paper_size || 'default';
  const unavailablePaper =
    selectedPaper !== 'default' && !paperSizes.some((size) => size.value === selectedPaper);
  const paperOptions = paperSizes.map((size) => [size.value, size.label]);
  if (!paperOptions.length || selectedPaper === 'default')
    paperOptions.unshift(['default', 'Printer default']);
  if (unavailablePaper) paperOptions.push([selectedPaper, selectedPaper]);
  let selectedCount = null;
  let selectionError = '';
  try {
    selectedCount = selectedPageCount(range, pageSet, pages);
  } catch (e) {
    selectionError = e.message;
  }

  useEffect(() => {
    setRange('');
    setPages(null);
    setPageSet('all');
    setOutputOrder('normal');
  }, [source]);
  useEffect(() => setPaperSize(''), [device?.id]);
  useEffect(() => {
    if (!device?.print || !active || blocked) return;
    let cancelled = false;
    const controller = new AbortController();
    setQueue(null);
    setQueueError('');
    const load = async () => {
      try {
        const data = await request(`/api/printers?device_id=${encodeURIComponent(device.id)}`, {
          signal: controller.signal,
        });
        if (!cancelled) {
          setQueue(data);
          setQueueError('');
        }
      } catch (e) {
        if (!cancelled) {
          setQueueError(e.message);
          if (e.name !== 'AbortError') reportError(e, true);
        }
      }
    };
    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(interval);
    };
  }, [device, active, blocked, refresh, reportError]);

  function selectFile(file) {
    if (!file) return;
    if (fileKind(file.name) !== 'pdf') {
      reportError(
        new Error('Only PDF documents can be printed. Export your document to PDF first.'),
      );
      return;
    }
    onSourceChange({ file, name: file.name });
  }
  async function submit(event) {
    event.preventDefault();
    if (!source || busy || !enabled || blocked) return;
    try {
      const pageRanges = validatePageRange(range, pages);
      selectedPageCount(pageRanges, pageSet, pages);
      if (fileKind(source.name) !== 'pdf') throw new Error('Only PDF documents can be printed.');
      if (unavailablePaper) throw new Error('Refresh and choose an available paper size.');
      const paper = selectedPaper === 'default' ? '' : selectedPaper;
      const count = Number(copies);
      if (!Number.isInteger(count) || count < 1 || count > 20)
        throw new Error('Choose between 1 and 20 copies.');
      setBusy(true);
      if (source.file) {
        const body = new FormData();
        body.append('file', source.file);
        body.append('copies', String(count));
        body.append('device_id', device.id);
        body.append('page_ranges', pageRanges);
        body.append('page_set', pageSet);
        body.append('output_order', outputOrder);
        body.append('collate', String(collate));
        body.append('paper_size', paper);
        body.append('scaling', scaling);
        await request('/api/print', { method: 'POST', body });
      } else {
        await post('/api/print', {
          scan_filename: source.name,
          device_id: device.id,
          copies: count,
          page_ranges: pageRanges,
          page_set: pageSet,
          output_order: outputOrder,
          collate,
          paper_size: paper,
          scaling,
        });
      }
      notify('Print job submitted.');
      onSourceChange(null);
      setCopies('1');
      setRange('');
      setCollate(true);
      setRefresh((v) => v + 1);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }
  async function cancelJobs() {
    setBusy(true);
    try {
      await post('/api/print/cancel', { device_id: device.id });
      notify('Print jobs cancelled.');
      setRefresh((v) => v + 1);
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Grid columns={{ initial: '1', md: '2' }} gap="5" align="start">
      <Panel title="Print a document" description="Choose a file, check the preview, then print.">
        {!enabled && (
          <Callout.Root color="gray" mb="4">
            <Callout.Text>This device does not support printing.</Callout.Text>
          </Callout.Root>
        )}
        <form onSubmit={submit}>
          <fieldset disabled={busy || blocked || !enabled}>
            <input
              ref={input}
              type="file"
              accept=".pdf,application/pdf"
              hidden
              aria-label="Choose document"
              onChange={(e) => {
                selectFile(e.target.files[0]);
                e.target.value = '';
              }}
            />
            <button
              className={`dropzone ${dragging ? 'dragging' : ''}`}
              type="button"
              onClick={() => input.current.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (!busy && !blocked && enabled) selectFile(e.dataTransfer.files[0]);
              }}
            >
              <UploadIcon width="24" height="24" />
              <Text weight="medium" size="2">
                Choose a file or drop it here
              </Text>
              <Text size="1" color="gray">
                PDF documents only
              </Text>
              <Text size="1" color="gray">
                Export Office documents to PDF before uploading.
              </Text>
            </button>
            {source && (
              <Box mt="4">
                <Flex justify="between" align="center" gap="3" mb="3">
                  <Text size="2" weight="medium" className="break-text" style={{ minWidth: 0 }}>
                    {source.name}
                  </Text>
                  <Button
                    type="button"
                    variant="soft"
                    color="gray"
                    style={{ flexShrink: 0 }}
                    onClick={() => onSourceChange(null)}
                  >
                    Remove
                  </Button>
                </Flex>
                <Preview
                  file={source.file}
                  url={source.url}
                  name={source.name}
                  onPages={setPages}
                />
                {(range || pageSet !== 'all' || outputOrder === 'reverse') && (
                  <Text as="p" size="1" color="gray" mt="2">
                    Preview shows the original document. Your print settings apply when submitted.
                  </Text>
                )}
              </Box>
            )}
            <Grid columns={{ initial: '1', xs: '2' }} gap="4" mt="5">
              <Choice
                label="Paper size"
                value={selectedPaper}
                onChange={setPaperSize}
                disabled={busy || blocked || !enabled || !paperSizes.length}
                options={paperOptions}
              />
              <Choice
                label="Scaling"
                value={scaling}
                onChange={setScaling}
                disabled={busy || blocked || !enabled}
                options={[
                  ['fit', 'Fit to paper'],
                  ['actual', 'Actual size (100%)'],
                ]}
              />
              <Input
                label="Copies"
                type="number"
                min="1"
                max="20"
                required
                value={copies}
                onChange={(e) => setCopies(e.target.value)}
              />
              <Input
                label="Pages"
                placeholder="All pages"
                value={range}
                onChange={(e) => setRange(e.target.value)}
                hint={pages ? `${pages} pages · e.g. 1,3-5` : 'Optional · e.g. 1,3-5'}
              />
              <Choice
                label="Print pages"
                value={pageSet}
                onChange={setPageSet}
                disabled={busy || blocked || !enabled}
                options={[
                  ['all', 'All pages'],
                  ['odd', 'Odd pages only'],
                  ['even', 'Even pages only'],
                ]}
              />
              <Choice
                label="Page order"
                value={outputOrder}
                onChange={setOutputOrder}
                disabled={busy || blocked || !enabled}
                options={[
                  ['normal', 'First to last'],
                  ['reverse', 'Last to first'],
                ]}
              />
            </Grid>
            <Text as="p" size="1" color="gray" mt="3">
              Match the paper loaded in the tray.{' '}
              {scaling === 'actual'
                ? 'Actual size may crop content outside the printable area.'
                : 'Fit to paper keeps content inside the printable area.'}
            </Text>
            {(queue?.paper_sizes_error || unavailablePaper) && (
              <Text as="p" size="2" color="amber" mt="3" role="status">
                {unavailablePaper
                  ? 'The selected paper size is unavailable. Refresh and select it again.'
                  : queue.paper_sizes_error}
              </Text>
            )}
            <Text as="p" size="1" color="gray" mt="3">
              Odd/even uses original page numbers, within the page range above.
            </Text>
            <Flex direction="column" gap="2" mt="4">
              <Text as="label" size="2">
                <Flex align="center" gap="2">
                  <Checkbox
                    checked={collate}
                    onCheckedChange={(checked) => setCollate(checked === true)}
                    disabled={Number(copies) <= 1 || busy || blocked || !enabled}
                  />
                  Collate copies
                </Flex>
              </Text>
              <Text size="1" color="gray">
                {collate
                  ? 'Keep each copy together: 1,2,3 · 1,2,3.'
                  : 'Group matching pages: 1,1 · 2,2 · 3,3.'}
              </Text>
            </Flex>
            {selectionError && (
              <Text as="p" size="2" color="red" mt="3" role="alert">
                {selectionError}
              </Text>
            )}
            <Flex justify="between" align="center" wrap="wrap" gap="3" mt="5">
              <Text size="2" color="gray">
                {source
                  ? selectionError
                    ? 'Check your page selection'
                    : selectedCount === null
                      ? 'Ready for your review'
                      : `${selectedCount} selected ${selectedCount === 1 ? 'page' : 'pages'} per copy`
                  : 'Choose a document to begin'}
              </Text>
              <Button
                type="submit"
                disabled={
                  !source ||
                  !enabled ||
                  busy ||
                  blocked ||
                  !!selectionError ||
                  unavailablePaper ||
                  (!queue && !queueError)
                }
                loading={busy}
              >
                Print document
              </Button>
            </Flex>
          </fieldset>
        </form>
      </Panel>
      <Panel
        title="Print queue"
        description={deviceLabel(device)}
        actions={
          <Button
            variant="soft"
            color="gray"
            onClick={() => setRefresh((v) => v + 1)}
            disabled={!enabled || blocked}
            aria-label="Refresh print queue"
          >
            <ReloadIcon />
            Refresh
          </Button>
        }
      >
        {queueError ? (
          <Callout.Root color="red">
            <Callout.Text>{queueError}</Callout.Text>
          </Callout.Root>
        ) : !enabled ? (
          <Empty>No print queue for this device.</Empty>
        ) : !queue ? (
          <Flex gap="2" align="center">
            <Spinner />
            <Text size="2" color="gray">
              Loading queue…
            </Text>
          </Flex>
        ) : queue.jobs?.length ? (
          <Flex direction="column" gap="3">
            {queue.jobs.map((job, i) => (
              <Box key={`${job}-${i}`} className="queue-job">
                <Badge color="gray">Queued</Badge>
                <Text as="p" size="2" mt="2" className="break-text">
                  {job}
                </Text>
              </Box>
            ))}
          </Flex>
        ) : (
          <Empty icon={<FileTextIcon width="28" height="28" />}>
            No pending jobs. Your next print will appear here.
          </Empty>
        )}
        {queue?.jobs?.length > 0 && (
          <Flex justify="end" mt="4">
            <Confirm
              title="Cancel pending jobs?"
              description={`Cancel all pending jobs for ${deviceLabel(device)}?`}
              label="Cancel jobs"
              onConfirm={cancelJobs}
              busy={busy}
            >
              <Button color="red" variant="soft" disabled={busy || blocked}>
                Cancel all jobs
              </Button>
            </Confirm>
          </Flex>
        )}
        {queue && (
          <details className="details">
            <summary>Printer details</summary>
            <Text as="p" size="1" color="gray" className="break-text">
              Queue: {queue.default_printer}
            </Text>
            <pre>{queue.status_text || 'No additional status available.'}</pre>
          </details>
        )}
      </Panel>
    </Grid>
  );
}
