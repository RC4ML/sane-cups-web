import { useId } from 'react';
import {
  AlertDialog,
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Select,
  Text,
  TextField,
} from '@radix-ui/themes';

export function Field({ label, hint, children }) {
  return (
    <Flex direction="column" gap="2" minWidth="0">
      <Text size="2" weight="medium">
        {label}
      </Text>
      {children}
      {hint && (
        <Text size="1" color="gray">
          {hint}
        </Text>
      )}
    </Flex>
  );
}
export function Input({ label, hint, ...props }) {
  const id = useId();
  return (
    <Flex direction="column" gap="2" minWidth="0">
      <Text as="label" htmlFor={id} size="2" weight="medium">
        {label}
      </Text>
      <TextField.Root id={id} {...props} />
      {hint && (
        <Text size="1" color="gray">
          {hint}
        </Text>
      )}
    </Flex>
  );
}
export function Choice({ label, options, value, onChange, disabled }) {
  const id = useId();
  return (
    <Flex direction="column" gap="2" minWidth="0">
      <Text as="label" htmlFor={id} size="2" weight="medium">
        {label}
      </Text>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
        <Select.Trigger id={id} aria-label={label} />
        <Select.Content
          position="popper"
          style={{ maxHeight: 'min(320px, var(--radix-select-content-available-height))' }}
        >
          {options.map(([key, text]) => (
            <Select.Item key={key} value={key}>
              {text}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </Flex>
  );
}
export function Panel({ title, description, actions, children, className = '' }) {
  return (
    <Card size="3" className={`panel ${className}`}>
      <Flex justify="between" align="center" gap="3" wrap="wrap" mb="5">
        <Box minWidth="0">
          <Heading as="h2" size="4">
            {title}
          </Heading>
          {description && (
            <Text as="p" color="gray" size="2" mt="1">
              {description}
            </Text>
          )}
        </Box>
        {actions && (
          <Flex align="center" gap="2" wrap="wrap" flexShrink="0">
            {actions}
          </Flex>
        )}
      </Flex>
      {children}
    </Card>
  );
}
export function Empty({ children, icon }) {
  return (
    <Flex className="empty-state" direction="column" align="center" justify="center" gap="3" p="5">
      <Text color="gray">{icon}</Text>
      <Text as="p" align="center" size="2" color="gray">
        {children}
      </Text>
    </Flex>
  );
}
export function Confirm({ title, description, label = 'Confirm', busy, onConfirm, children }) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger>{children}</AlertDialog.Trigger>
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2" className="break-text">
          {description}
        </AlertDialog.Description>
        <Flex gap="3" mt="5" justify="end" align="center" wrap="wrap">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Keep
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color="red" disabled={busy} onClick={onConfirm}>
              {label}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
