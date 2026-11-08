import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DocumentForm } from '../../src/web/components/DocumentForm';
import { twoPartyFields } from '../helpers/fixtures';

const parties = [
  { blockId: 'sig_member', label: 'Member', name: 'Ada Member', signedAt: null, signature: null },
  {
    blockId: 'sig_steward',
    label: 'Steward',
    name: 'Sol Steward',
    signedAt: null,
    signature: null,
  },
];

describe('DocumentForm', () => {
  it('renders static content and read-only placeholders in preview', () => {
    render(
      <DocumentForm fields={twoPartyFields} parties={[]} answers={{}} editableBlockId={null} />,
    );
    expect(screen.getByRole('heading', { name: 'Bench rules' })).toBeInTheDocument();
    expect(screen.getByText('Keep the bench tidy.')).toBeInTheDocument();
    expect(screen.getAllByText('To be completed by Member')).toHaveLength(3);
    expect(screen.getByText('To be completed by Steward')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getAllByText('Not signed yet')).toHaveLength(2);
  });

  it("makes only the current signer's fields editable", () => {
    render(
      <DocumentForm
        fields={twoPartyFields}
        parties={parties}
        answers={{}}
        editableBlockId="sig_member"
        signatureSlot={<button type="button">Signature controls</button>}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /I agree/ })).toBeRequired();
    expect(screen.getByRole('textbox', { name: /Phone/ })).toBeRequired();
    expect(screen.getByRole('combobox', { name: 'Level' })).not.toBeRequired();
    expect(screen.queryByLabelText(/Checked on/)).not.toBeInTheDocument();
    expect(screen.getByText('To be completed by Steward')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Signature controls' })).toBeInTheDocument();
    expect(screen.getAllByText('Not signed yet')).toHaveLength(1);
  });

  it('reports every change with the field id', async () => {
    const onAnswer = vi.fn();
    const user = userEvent.setup();
    render(
      <DocumentForm
        fields={twoPartyFields}
        parties={parties}
        answers={{}}
        editableBlockId="sig_member"
        onAnswer={onAnswer}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /I agree/ }));
    await user.type(screen.getByRole('textbox', { name: /Phone/ }), '5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Level' }), 'Skilled');

    expect(onAnswer.mock.calls).toEqual([
      ['agree', 'true'],
      ['phone', '5'],
      ['level', 'Skilled'],
    ]);
  });

  it('ties error messages to their controls for assistive technology', () => {
    render(
      <DocumentForm
        fields={twoPartyFields}
        parties={parties}
        answers={{ phone: '' }}
        editableBlockId="sig_member"
        issues={
          new Map([
            ['phone', ['This field is required.']],
            ['agree', ['You need to tick this box to continue.']],
            ['sig_member', ['Draw your signature to sign.']],
          ])
        }
      />,
    );
    const phone = screen.getByRole('textbox', { name: /Phone/ });
    expect(phone).toBeInvalid();
    expect(phone).toHaveAccessibleDescription('This field is required.');

    const agree = screen.getByRole('checkbox', { name: /I agree/ });
    expect(agree).toBeInvalid();
    expect(agree).toHaveAccessibleDescription('You need to tick this box to continue.');

    expect(screen.getByRole('combobox', { name: 'Level' })).toBeValid();
    expect(screen.getByText('Draw your signature to sign.')).toBeInTheDocument();
  });

  it('shows submitted answers and signatures in a signed copy', () => {
    render(
      <DocumentForm
        fields={twoPartyFields}
        editableBlockId={null}
        answers={{ agree: 'true', phone: '555 0100', level: '' }}
        parties={[
          {
            blockId: 'sig_member',
            label: 'Member',
            name: 'Ada Member',
            signedAt: '2025-06-01T10:00:00.000Z',
            signature: { kind: 'typed', text: 'Ada M.' },
          },
          {
            blockId: 'sig_steward',
            label: 'Steward',
            name: 'Sol Steward',
            signedAt: '2025-06-01T11:00:00.000Z',
            signature: {
              kind: 'drawn',
              strokes: [
                [
                  { x: 0, y: 0 },
                  { x: 1, y: 1 },
                ],
              ],
            },
          },
        ]}
      />,
    );
    expect(screen.getByText('Ticked')).toBeInTheDocument();
    expect(screen.getByText('555 0100')).toBeInTheDocument();
    expect(screen.getByText('Left empty')).toBeInTheDocument();
    expect(screen.getByLabelText('Typed signature of Ada Member')).toHaveTextContent('Ada M.');

    const drawn = screen.getByRole('img', { name: 'Drawn signature of Sol Steward' });
    expect(drawn.querySelector('polyline')).toHaveAttribute('points', '0.0,0.0 460.0,140.0');
    expect(screen.getAllByText(/^Signed /)).toHaveLength(2);
    expect(screen.queryByText('Not signed yet')).not.toBeInTheDocument();
  });

  it('shows help text and marks unticked boxes in a signed copy', () => {
    const fields = twoPartyFields.map((item) =>
      item.id === 'phone' ? { ...item, body: 'Include the area code.' } : item,
    );
    const { rerender } = render(
      <DocumentForm fields={fields} parties={parties} answers={{}} editableBlockId="sig_member" />,
    );
    expect(screen.getByRole('textbox', { name: /Phone/ })).toHaveAccessibleDescription(
      'Include the area code.',
    );

    rerender(
      <DocumentForm
        fields={fields}
        parties={parties}
        answers={{ agree: 'false' }}
        editableBlockId={null}
      />,
    );
    expect(
      within(screen.getByText('I agree').closest('div') as HTMLElement).getByText('Not ticked'),
    ).toBeInTheDocument();
  });
});
