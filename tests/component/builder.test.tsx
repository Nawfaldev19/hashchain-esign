import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useReducer } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { signatureBlocks } from '../../src/shared/fields';
import type { TemplateField } from '../../src/shared/fields';
import { FieldCard } from '../../src/web/features/templates/FieldCard';
import { builderReducer, emptyBuilderState } from '../../src/web/features/templates/builder-state';
import type { BuilderAction } from '../../src/web/features/templates/builder-state';
import { field, twoPartyFields } from '../helpers/fixtures';

function renderCard(
  target: TemplateField,
  options: { disabled?: boolean; issues?: string[]; position?: number } = {},
) {
  const dispatch = vi.fn<(action: BuilderAction) => void>();
  render(
    <ol>
      <FieldCard
        field={target}
        position={options.position ?? 1}
        total={3}
        signatureBlocks={signatureBlocks(twoPartyFields)}
        issues={options.issues ?? []}
        disabled={options.disabled ?? false}
        dispatch={dispatch}
      />
    </ol>,
  );
  return dispatch;
}

/** The card wired to the real reducer, to test editing as a person would do it. */
function LiveCards({ initial }: { initial: TemplateField[] }) {
  const [state, dispatch] = useReducer(builderReducer, { ...emptyBuilderState, fields: initial });
  return (
    <ol>
      {state.fields.map((item, index) => (
        <FieldCard
          key={item.id}
          field={item}
          position={index}
          total={state.fields.length}
          signatureBlocks={signatureBlocks(state.fields)}
          issues={[]}
          disabled={false}
          dispatch={dispatch}
        />
      ))}
    </ol>
  );
}

describe('FieldCard', () => {
  it('names the card after its label, for screen readers and tests', () => {
    renderCard(field('phone', 'text', 'Phone', { assignedTo: 'sig_member' }));
    expect(screen.getByRole('listitem', { name: 'Field 2: Phone' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Phone up' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Remove Phone' })).toBeEnabled();
  });

  it('shows the controls that fit the kind', () => {
    const { unmount } = render(<LiveCards initial={[field('h', 'heading', 'Rules')]} />);
    expect(screen.getByLabelText('Heading text')).toHaveValue('Rules');
    expect(screen.queryByLabelText('Filled in by')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Required' })).not.toBeInTheDocument();
    unmount();

    render(<LiveCards initial={[field('p', 'paragraph', '', { body: 'Text' })]} />);
    expect(screen.getByLabelText('Paragraph text')).toHaveValue('Text');
    expect(screen.queryByLabelText('Question')).not.toBeInTheDocument();
  });

  it('dispatches moves, removal and edits', async () => {
    const user = userEvent.setup();
    const dispatch = renderCard(field('phone', 'text', 'Phone', { assignedTo: 'sig_member' }));

    await user.click(screen.getByRole('button', { name: 'Move Phone up' }));
    await user.click(screen.getByRole('button', { name: 'Move Phone down' }));
    await user.click(screen.getByRole('button', { name: 'Remove Phone' }));
    await user.click(screen.getByRole('checkbox', { name: 'Required' }));
    await user.selectOptions(screen.getByLabelText('Filled in by'), 'Steward');

    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'fieldMoved', id: 'phone', direction: -1 },
      { type: 'fieldMoved', id: 'phone', direction: 1 },
      { type: 'fieldRemoved', id: 'phone' },
      { type: 'fieldChanged', id: 'phone', patch: { required: true } },
      { type: 'fieldChanged', id: 'phone', patch: { assignedTo: 'sig_steward' } },
    ]);
  });

  it('cannot move the first card up or the last card down', () => {
    const { unmount } = render(
      <ol>
        <FieldCard
          field={field('a', 'heading', 'First')}
          position={0}
          total={2}
          signatureBlocks={[]}
          issues={[]}
          disabled={false}
          dispatch={vi.fn()}
        />
      </ol>,
    );
    expect(screen.getByRole('button', { name: 'Move First up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move First down' })).toBeEnabled();
    unmount();

    renderCard(field('z', 'heading', 'Last'), { position: 2 });
    expect(screen.getByRole('button', { name: 'Move Last down' })).toBeDisabled();
  });

  it('disables every control for read-only members', () => {
    renderCard(field('c', 'choice', 'Level', { options: ['A', 'B'], assignedTo: 'sig_member' }), {
      disabled: true,
    });
    const card = screen.getByRole('listitem');
    for (const control of [
      ...within(card).getAllByRole('button'),
      ...within(card).getAllByRole('textbox'),
      within(card).getByRole('combobox'),
      within(card).getByRole('checkbox'),
    ]) {
      expect(control).toBeDisabled();
    }
  });

  it('shows issues and marks the card', () => {
    renderCard(field('q', 'text', ''), { issues: ['Give this field a label.'] });
    expect(screen.getByText('Give this field a label.')).toBeInTheDocument();
    expect(screen.getByRole('listitem')).toHaveClass('field-card--invalid');
    expect(screen.getByRole('listitem', { name: 'Field 2: Short text' })).toBeInTheDocument();
  });

  it('edits choice options: type, add, and remove down to two', async () => {
    const user = userEvent.setup();
    render(
      <LiveCards
        initial={[
          field('c', 'choice', 'Level', { options: ['New', 'Skilled'] }),
          field('s', 'signature', 'Member'),
        ]}
      />,
    );
    const card = screen.getByRole('listitem', { name: 'Field 1: Level' });
    expect(within(card).getByRole('button', { name: 'Remove option 1' })).toBeDisabled();

    await user.click(within(card).getByRole('button', { name: 'Add option' }));
    await user.type(within(card).getByLabelText('Option 3'), 'Expert');
    expect(within(card).getByLabelText('Option 3')).toHaveValue('Expert');

    await user.click(within(card).getByRole('button', { name: 'Remove option 1' }));
    expect(within(card).getByLabelText('Option 1')).toHaveValue('Skilled');
    expect(within(card).getByLabelText('Option 2')).toHaveValue('Expert');
    expect(within(card).queryByLabelText('Option 3')).not.toBeInTheDocument();
  });

  it('clears help text to null instead of an empty string', async () => {
    const user = userEvent.setup();
    const dispatch = renderCard(field('t', 'text', 'Phone', { body: 'x' }));
    await user.clear(screen.getByLabelText('Help text (optional)'));
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'fieldChanged',
      id: 't',
      patch: { body: null },
    });
  });

  it('offers new signature blocks as assignees as soon as they exist', async () => {
    const user = userEvent.setup();
    render(<LiveCards initial={[field('t', 'text', 'Phone'), field('s', 'signature', '')]} />);
    const assignee = screen.getByLabelText('Filled in by');
    expect(within(assignee).getByRole('option', { name: 'Unnamed signer' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Signer label'), 'Member');
    expect(within(assignee).getByRole('option', { name: 'Member' })).toBeInTheDocument();
    await user.selectOptions(assignee, 'Member');
    expect(assignee).toHaveValue('s');
  });
});
