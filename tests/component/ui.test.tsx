import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StatusBadge } from '../../src/web/components/StatusBadge';
import { CopyButton, Dialog, ToastHost } from '../../src/web/components/overlays';
import {
  Banner,
  Button,
  EmptyState,
  ErrorState,
  Field,
  Segmented,
  Skeleton,
} from '../../src/web/components/ui';
import { applyTheme } from '../../src/web/lib/theme';
import { ThemeToggle } from '../../src/web/components/ThemeToggle';
import { REQUEST_STATUSES, STATUS_LABELS } from '../../src/shared/status';

describe('Button', () => {
  it('is a plain button by default, so it never submits a form by accident', () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button');
  });

  it('blocks clicks and announces work while busy', async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Field', () => {
  it('connects label, hint and errors to the control', () => {
    render(
      <Field label="Email" hint="We only use it to send the link." errors={['Enter an email.']}>
        {(control) => <input {...control} />}
      </Field>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toBeInvalid();
    expect(input).toHaveAccessibleDescription('We only use it to send the link. Enter an email.');
  });

  it('adds no description when there is nothing to describe', () => {
    render(<Field label="Name">{(control) => <input {...control} />}</Field>);
    const input = screen.getByLabelText('Name');
    expect(input).toBeValid();
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});

describe('Segmented', () => {
  it('marks the current option and reports a new choice', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Filter"
        value="a"
        onChange={onChange}
        options={[
          { value: 'a', label: 'All' },
          { value: 'b', label: 'Open' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Open' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('states', () => {
  it('announces loading politely with a text label', () => {
    render(<Skeleton lines={4} label="Loading requests" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading requests');
  });

  it('explains an empty list and offers the next step', () => {
    render(
      <EmptyState title="No requests yet" action={<Button>New request</Button>}>
        Send a template to get started.
      </EmptyState>,
    );
    expect(screen.getByRole('heading', { name: 'No requests yet' })).toBeInTheDocument();
    expect(screen.getByText('Send a template to get started.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New request' })).toBeInTheDocument();
  });

  it('reports an error as an alert and retries on request', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="The server could not be reached." onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The server could not be reached.');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('has no retry button when retrying cannot help', () => {
    render(<ErrorState title="This link is not valid" message="Ask for a new one." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses the status role for calm banners and alert for urgent ones', () => {
    render(
      <>
        <Banner tone="success">Saved</Banner>
        <Banner tone="danger" role="alert">
          Failed
        </Banner>
      </>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed');
  });
});

describe('StatusBadge', () => {
  it.each(REQUEST_STATUSES)('writes %s out in words', (status) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(STATUS_LABELS[status])).toBeInTheDocument();
  });
});

describe('Dialog', () => {
  it('renders its content only while open, labelled by its title', () => {
    const { rerender } = render(
      <Dialog open={false} title="New template" onClose={vi.fn()}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.queryByText('Body')).not.toBeInTheDocument();

    rerender(
      <Dialog open title="New template" onClose={vi.fn()}>
        <p>Body</p>
      </Dialog>,
    );
    expect(screen.getByRole('dialog', { name: 'New template' })).toHaveTextContent('Body');
  });

  it('tells the owner when the browser closes it (Escape or backdrop)', () => {
    const onClose = vi.fn();
    render(
      <Dialog open title="Confirm" onClose={onClose}>
        <p>Body</p>
      </Dialog>,
    );
    screen.getByRole('dialog').dispatchEvent(new Event('close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('CopyButton', () => {
  it('copies the text and confirms with a toast', async () => {
    const user = userEvent.setup();
    render(
      <ToastHost>
        <CopyButton text="https://example.com/sign/abc" label="Copy the signing link" />
      </ToastHost>,
    );
    await user.click(screen.getByRole('button', { name: 'Copy the signing link' }));
    expect(await screen.findByText('Copied to the clipboard')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('https://example.com/sign/abc');
    expect(screen.getByRole('button', { name: 'Copy the signing link' })).toHaveTextContent(
      'Copied',
    );
  });
});

describe('theme', () => {
  it('switches the document theme, remembers it and updates the toggle', async () => {
    applyTheme('light');
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark theme' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('signoff-ledger-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Switch to light theme' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });
});
