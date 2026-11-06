import { useEffect, useRef, useState } from 'react';
import { Box, Button, Flex, Spinner, Text } from '@radix-ui/themes';
import { ChevronLeftIcon, ChevronRightIcon } from '@radix-ui/react-icons';
import { fileKind } from './api';

// Keep the audited, vendored PDF.js and worker together; no runtime CDN requests.
const pdfModule = () => import(/* @vite-ignore */ '/vendor/pdfjs/pdf.min.mjs');

export default function Preview({ file, url, name, onPages }) {
  const kind = fileKind(name || file?.name || '');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [pdf, setPdf] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [width, setWidth] = useState(600);
  const container = useRef(null);
  const canvas = useRef(null);

  useEffect(() => {
    let active = true;
    let task;
    const objectURL = file ? URL.createObjectURL(file) : null;
    setSource(objectURL || url || '');
    setPdf(null);
    setPage(1);
    setText('');
    setError('');
    onPages?.(null);
    setLoading(kind === 'pdf' || kind === 'txt');
    (async () => {
      try {
        if (kind === 'pdf') {
          const lib = await pdfModule();
          const bytes = file ? new Uint8Array(await file.arrayBuffer()) : null;
          if (!active) return;
          lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
          task = lib.getDocument(bytes ? { data: bytes } : { url });
          const document = await task.promise;
          if (!active) return;
          setPdf(document);
          onPages?.(document.numPages);
        } else if (kind === 'txt') {
          const content = file
            ? await file.text()
            : await fetch(url).then((response) => {
                if (!response.ok) throw new Error('Unable to load text preview.');
                return response.text();
              });
          if (active) setText(content);
        }
      } catch (e) {
        if (active) setError(`Preview unavailable: ${e.message}`);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
      task?.destroy();
    };
  }, [file, url, kind, onPages]);

  useEffect(() => {
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.max(100, entries[0].contentRect.width - 32)),
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let active = true;
    let render;
    (async () => {
      try {
        const pdfPage = await pdf.getPage(page);
        if (!active || !canvas.current) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const viewport = pdfPage.getViewport({ scale: Math.min(width, 800) / base.width });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const element = canvas.current;
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        element.style.width = `${Math.floor(viewport.width)}px`;
        render = pdfPage.render({
          canvasContext: element.getContext('2d'),
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await render.promise;
      } catch (e) {
        if (active && e.name !== 'RenderingCancelledException')
          setError(`Preview unavailable: ${e.message}`);
      }
    })();
    return () => {
      active = false;
      render?.cancel();
    };
  }, [pdf, page, width]);

  return (
    <Box className="document-preview" ref={container}>
      <Box className="preview-content">
        {loading ? (
          <Flex justify="center" gap="2" p="5">
            <Spinner />
            <Text size="2">Loading preview…</Text>
          </Flex>
        ) : error ? (
          <Text as="p" size="2" color="red" className="break-text" role="alert">
            {error}
          </Text>
        ) : kind === 'pdf' ? (
          <canvas ref={canvas} aria-label={`Page ${page} of ${pdf?.numPages || 1}`} />
        ) : ['png', 'jpg', 'jpeg'].includes(kind) ? (
          <img
            src={source}
            alt={`Preview of ${name || file?.name}`}
            onError={() => setError('Unable to load image preview.')}
          />
        ) : kind === 'txt' ? (
          <pre>{text}</pre>
        ) : (
          <Text size="2" color="gray">
            No preview available for this file type.
          </Text>
        )}
      </Box>
      {pdf && (
        <Flex className="preview-controls" justify="center" align="center" gap="3" p="3">
          <Button
            type="button"
            variant="soft"
            color="gray"
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            aria-label="Previous page"
          >
            <ChevronLeftIcon />
          </Button>
          <Text size="2">
            Page {page} of {pdf.numPages}
          </Text>
          <Button
            type="button"
            variant="soft"
            color="gray"
            disabled={page === pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <ChevronRightIcon />
          </Button>
        </Flex>
      )}
    </Box>
  );
}
