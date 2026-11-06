import { useState } from 'react';
import { Badge, Box, Button, Dialog, Flex, Link, Table, Text, TextField } from '@radix-ui/themes';
import { DownloadIcon, FileTextIcon, MagnifyingGlassIcon, ReloadIcon } from '@radix-ui/react-icons';
import { fileKind, request } from './api';
import { Confirm, Empty, Panel } from './ui';
import Preview from './Preview';

export default function Documents({
  scans,
  error,
  loading,
  reload,
  onPrint,
  canPrint,
  blocked,
  notify,
  reportError,
}) {
  const [filter, setFilter] = useState('');
  const [preview, setPreview] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const filtered = scans.filter((scan) => scan.name.toLowerCase().includes(filter.toLowerCase()));
  async function remove(scan) {
    setDeleting(scan.name);
    try {
      await request(`/api/scans/${encodeURIComponent(scan.name)}`, { method: 'DELETE' });
      notify('Document deleted.');
      reload();
    } catch (e) {
      reportError(e);
    } finally {
      setDeleting(null);
    }
  }
  return (
    <>
      <Panel
        title="Saved documents"
        description="Your scans, ready to download or print."
        actions={
          <Button variant="soft" color="gray" disabled={loading || blocked} onClick={reload}>
            <ReloadIcon />
            Refresh
          </Button>
        }
      >
        <TextField.Root
          aria-label="Search documents"
          placeholder="Search by filename…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          mb="4"
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
        {error ? (
          <Text color="red" size="2" role="alert">
            {error}
          </Text>
        ) : loading && !scans.length ? (
          <Empty>Loading documents…</Empty>
        ) : !filtered.length ? (
          <Empty icon={<FileTextIcon width="28" height="28" />}>
            {filter
              ? 'No documents match your search.'
              : 'No scans yet. Your saved documents will appear here.'}
          </Empty>
        ) : (
          <Box className="document-table">
            <Table.Root className="documents">
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeaderCell>Document</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="document-format">
                    File Format
                  </Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="document-size">Size</Table.ColumnHeaderCell>
                  <Table.ColumnHeaderCell className="document-actions-cell" align="right">
                    Actions
                  </Table.ColumnHeaderCell>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {filtered.map((scan) => (
                  <Table.Row key={scan.name}>
                    <Table.Cell className="document-name-cell">
                      <Link asChild>
                        <button
                          type="button"
                          onClick={() => setPreview(scan)}
                          className="document-name"
                        >
                          {scan.name}
                        </button>
                      </Link>
                    </Table.Cell>
                    <Table.Cell className="document-format" data-label="File Format">
                      <Badge color="gray" size="1">
                        {scan.format.toUpperCase()}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell className="document-size" data-label="Size">
                      <Text color="gray" size="2">
                        {scan.size_formatted}
                      </Text>
                    </Table.Cell>
                    <Table.Cell className="document-actions-cell">
                      <Flex gap="2" align="center" justify="end" className="document-actions">
                        <Button variant="soft" color="gray" asChild>
                          <a
                            href={`${scan.url}?download=true`}
                            download={scan.name}
                            aria-label={`Download ${scan.name}`}
                          >
                            <DownloadIcon />
                            Download
                          </a>
                        </Button>
                        {canPrint && fileKind(scan.name) === 'pdf' && (
                          <Button variant="soft" disabled={blocked} onClick={() => onPrint(scan)}>
                            Print
                          </Button>
                        )}
                        <Confirm
                          title="Delete document?"
                          description={`Permanently delete ${scan.name}? This cannot be undone.`}
                          label="Delete"
                          onConfirm={() => remove(scan)}
                          busy={!!deleting}
                        >
                          <Button variant="soft" color="red" disabled={!!deleting || blocked}>
                            Delete
                          </Button>
                        </Confirm>
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Box>
        )}
      </Panel>
      <Dialog.Root
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <Dialog.Content maxWidth="850px">
          <Dialog.Title className="break-text">{preview?.name}</Dialog.Title>
          <Dialog.Description size="2" mb="4">
            Preview your saved document.
          </Dialog.Description>
          {preview && <Preview url={preview.url} name={preview.name} />}
          <Flex justify="end" align="center" wrap="wrap" gap="3" mt="4">
            {preview && (
              <Button variant="soft" color="gray" asChild>
                <a href={`${preview.url}?download=true`} download={preview.name}>
                  Download
                </a>
              </Button>
            )}
            {canPrint && preview && fileKind(preview.name) === 'pdf' && (
              <Button
                disabled={blocked}
                onClick={() => {
                  onPrint(preview);
                  setPreview(null);
                }}
              >
                Print
              </Button>
            )}
            <Dialog.Close>
              <Button variant="soft" color="gray">
                Close
              </Button>
            </Dialog.Close>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
}
