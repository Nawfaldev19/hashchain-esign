import { blankField } from '../../../shared/fields';
import type { FieldKind, TemplateField } from '../../../shared/fields';

/**
 * The template builder keeps its working copy in a reducer. All editing rules
 * live here as pure functions, away from React, so they are easy to test.
 */

export interface BuilderState {
  title: string;
  description: string;
  fields: TemplateField[];
  /** The draft revision the working copy started from (for optimistic locking). */
  revision: number;
  dirty: boolean;
}

export type BuilderAction =
  | {
      type: 'loaded';
      title: string;
      description: string;
      fields: TemplateField[];
      revision: number;
    }
  | { type: 'saved'; revision: number }
  | { type: 'titleChanged'; title: string }
  | { type: 'descriptionChanged'; description: string }
  | { type: 'fieldAdded'; kind: FieldKind }
  | { type: 'fieldChanged'; id: string; patch: Partial<Omit<TemplateField, 'id' | 'kind'>> }
  | { type: 'fieldMoved'; id: string; direction: -1 | 1 }
  | { type: 'fieldRemoved'; id: string };

export const emptyBuilderState: BuilderState = {
  title: '',
  description: '',
  fields: [],
  revision: 0,
  dirty: false,
};

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'loaded':
      return {
        title: action.title,
        description: action.description,
        fields: action.fields,
        revision: action.revision,
        dirty: false,
      };
    case 'saved':
      return { ...state, revision: action.revision, dirty: false };
    case 'titleChanged':
      return { ...state, title: action.title, dirty: true };
    case 'descriptionChanged':
      return { ...state, description: action.description, dirty: true };
    case 'fieldAdded':
      return {
        ...state,
        fields: [...state.fields, blankField(action.kind, state.fields)],
        dirty: true,
      };
    case 'fieldChanged':
      return {
        ...state,
        fields: state.fields.map((field) =>
          field.id === action.id ? { ...field, ...action.patch } : field,
        ),
        dirty: true,
      };
    case 'fieldMoved': {
      const from = state.fields.findIndex((field) => field.id === action.id);
      const to = from + action.direction;
      if (from < 0 || to < 0 || to >= state.fields.length) return state;
      const fields = [...state.fields];
      const [moved] = fields.splice(from, 1);
      if (!moved) return state;
      fields.splice(to, 0, moved);
      return { ...state, fields, dirty: true };
    }
    case 'fieldRemoved': {
      if (!state.fields.some((field) => field.id === action.id)) return state;
      // Inputs that were assigned to a removed signature block become
      // unassigned, which the publish check then reports.
      const fields = state.fields
        .filter((field) => field.id !== action.id)
        .map((field) => (field.assignedTo === action.id ? { ...field, assignedTo: null } : field));
      return { ...state, fields, dirty: true };
    }
  }
}

export const KIND_LABELS: Readonly<Record<FieldKind, string>> = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  text: 'Short text',
  longText: 'Long text',
  checkbox: 'Checkbox',
  date: 'Date',
  choice: 'Choice',
  signature: 'Signature',
};
