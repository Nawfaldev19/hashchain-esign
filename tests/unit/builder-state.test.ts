import { describe, expect, it } from 'vitest';
import {
  KIND_LABELS,
  builderReducer,
  emptyBuilderState,
} from '../../src/web/features/templates/builder-state';
import type { BuilderState } from '../../src/web/features/templates/builder-state';
import { FIELD_KINDS } from '../../src/shared/fields';
import { field, twoPartyFields } from '../helpers/fixtures';

const loaded: BuilderState = builderReducer(emptyBuilderState, {
  type: 'loaded',
  title: 'Bench agreement',
  description: 'About benches.',
  fields: twoPartyFields,
  revision: 4,
});

const ids = (state: BuilderState): string[] => state.fields.map((item) => item.id);

describe('builderReducer', () => {
  it('loads a clean working copy', () => {
    expect(loaded).toMatchObject({ title: 'Bench agreement', revision: 4, dirty: false });
    expect(loaded.fields).toBe(twoPartyFields);
  });

  it('marks edits as unsaved and a save as clean, keeping the edits', () => {
    const edited = builderReducer(loaded, { type: 'titleChanged', title: 'New title' });
    expect(edited).toMatchObject({ title: 'New title', dirty: true, revision: 4 });
    const described = builderReducer(edited, { type: 'descriptionChanged', description: 'New' });
    const saved = builderReducer(described, { type: 'saved', revision: 5 });
    expect(saved).toMatchObject({
      title: 'New title',
      description: 'New',
      revision: 5,
      dirty: false,
    });
  });

  it('appends new fields, assigning inputs to the first signature block', () => {
    const withText = builderReducer(loaded, { type: 'fieldAdded', kind: 'text' });
    const added = withText.fields.at(-1);
    expect(withText.fields).toHaveLength(twoPartyFields.length + 1);
    expect(added).toMatchObject({ kind: 'text', label: '', assignedTo: 'sig_member' });
    expect(ids(loaded)).not.toContain(added?.id);

    const empty = builderReducer(emptyBuilderState, { type: 'fieldAdded', kind: 'date' });
    expect(empty.fields[0]).toMatchObject({ kind: 'date', assignedTo: null });
  });

  it('changes one field without touching the others or the original state', () => {
    const changed = builderReducer(loaded, {
      type: 'fieldChanged',
      id: 'phone',
      patch: { label: 'Mobile', required: false },
    });
    expect(changed.fields.find((item) => item.id === 'phone')).toMatchObject({
      label: 'Mobile',
      required: false,
    });
    expect(loaded.fields.find((item) => item.id === 'phone')?.label).toBe('Phone');
    expect(changed.fields.filter((item, index) => item !== loaded.fields[index])).toHaveLength(1);
  });

  it('moves fields up and down, and ignores moves past either end', () => {
    const down = builderReducer(loaded, { type: 'fieldMoved', id: 'h1', direction: 1 });
    expect(ids(down).slice(0, 2)).toEqual(['p1', 'h1']);
    const back = builderReducer(down, { type: 'fieldMoved', id: 'h1', direction: -1 });
    expect(ids(back)).toEqual(ids(loaded));

    expect(builderReducer(loaded, { type: 'fieldMoved', id: 'h1', direction: -1 })).toBe(loaded);
    expect(builderReducer(loaded, { type: 'fieldMoved', id: 'sig_steward', direction: 1 })).toBe(
      loaded,
    );
    expect(builderReducer(loaded, { type: 'fieldMoved', id: 'ghost', direction: 1 })).toBe(loaded);
  });

  it('unassigns inputs when their signature block is removed', () => {
    const removed = builderReducer(loaded, { type: 'fieldRemoved', id: 'sig_member' });
    expect(ids(removed)).not.toContain('sig_member');
    expect(removed.fields.find((item) => item.id === 'phone')?.assignedTo).toBeNull();
    expect(removed.fields.find((item) => item.id === 'day')?.assignedTo).toBe('sig_steward');
    expect(removed.dirty).toBe(true);
  });

  it('ignores removing a field that does not exist', () => {
    expect(builderReducer(loaded, { type: 'fieldRemoved', id: 'ghost' })).toBe(loaded);
  });

  it('replaces the working copy when a newer draft is loaded', () => {
    const dirty = builderReducer(loaded, { type: 'fieldAdded', kind: 'heading' });
    const reloaded = builderReducer(dirty, {
      type: 'loaded',
      title: 'Theirs',
      description: '',
      fields: [field('only', 'signature', 'Member')],
      revision: 9,
    });
    expect(reloaded).toMatchObject({ title: 'Theirs', revision: 9, dirty: false });
    expect(ids(reloaded)).toEqual(['only']);
  });

  it('has a label for every field kind', () => {
    expect(Object.keys(KIND_LABELS).sort()).toEqual([...FIELD_KINDS].sort());
  });
});
