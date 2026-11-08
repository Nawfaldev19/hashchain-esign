import type { Point, TemplateField } from '../../shared/fields';
import { hashPassword } from '../domain/secrets';
import type { Deps, Role, Scope } from '../services/records';
import { createRequest, revokeRequest } from '../services/request-service';
import { recordView, submitSignature } from '../services/signing-service';
import { createTemplate, firstRow, publishTemplate, saveDraft } from '../services/template-service';

/**
 * Fictional demo data. Every name is invented and every email address uses the
 * reserved example.com domain. Requests are created through the same services
 * the API uses, so their hash chains are real and verify as intact.
 */

export const DEMO_PASSWORD = 'makerspace-demo';

export const DEMO_USERS = {
  owner: { name: 'Mira Okafor', email: 'mira@example.com' },
  editor: { name: 'Jonas Lindqvist', email: 'jonas@example.com' },
  viewer: { name: 'Priya Nair', email: 'priya@example.com' },
  otherOwner: { name: 'Tomás Rivera', email: 'tomas@example.com' },
} as const;

const field = (
  id: string,
  kind: TemplateField['kind'],
  label: string,
  extra: Partial<TemplateField> = {},
): TemplateField => ({
  id,
  kind,
  label,
  body: null,
  required: false,
  options: [],
  assignedTo: null,
  ...extra,
});

const woodShopFields: TemplateField[] = [
  field('h_rules', 'heading', 'Wood shop rules'),
  field('p_rules', 'paragraph', '', {
    body: 'The table saw, band saw and planer may only be used after an induction with a shop steward. Guards stay on. Loose sleeves, cords and jewellery come off. If a machine sounds wrong, stop it and tell a steward.',
  }),
  field('c_induction', 'checkbox', 'I have completed the wood shop induction', {
    required: true,
    assignedTo: 's_member',
  }),
  field('c_protection', 'checkbox', 'I will wear eye and ear protection at every machine', {
    required: true,
    assignedTo: 's_member',
  }),
  field('t_contact', 'text', 'Emergency contact name', { required: true, assignedTo: 's_member' }),
  field('t_phone', 'text', 'Emergency contact phone', { required: true, assignedTo: 's_member' }),
  field('x_experience', 'choice', 'Experience with table saws', {
    required: true,
    options: ['New to table saws', 'Some experience', 'Confident'],
    assignedTo: 's_member',
  }),
  field('d_induction', 'date', 'Date of the induction', {
    required: true,
    assignedTo: 's_steward',
  }),
  field('l_notes', 'longText', 'Steward notes', {
    body: 'Anything the next steward should know.',
    assignedTo: 's_steward',
  }),
  field('s_member', 'signature', 'Member'),
  field('s_steward', 'signature', 'Shop steward'),
];

const studioHireFields: TemplateField[] = [
  field('h_terms', 'heading', 'Studio hire terms'),
  field('p_terms', 'paragraph', '', {
    body: 'A hire covers one studio for one day, from opening until closing. Materials are not included. The studio is handed back swept, with tools on their shadow boards.',
  }),
  field('x_studio', 'choice', 'Studio', {
    required: true,
    options: ['Ceramics', 'Print room', 'Electronics bench'],
    assignedTo: 's_hirer',
  }),
  field('d_day', 'date', 'Hire date', { required: true, assignedTo: 's_hirer' }),
  field('l_project', 'longText', 'What will you be making?', { assignedTo: 's_hirer' }),
  field('c_clean', 'checkbox', 'I will hand the studio back clean', {
    required: true,
    assignedTo: 's_hirer',
  }),
  field('s_hirer', 'signature', 'Hirer'),
];

const membershipFields: TemplateField[] = [
  field('h_member', 'heading', 'Workshop membership terms'),
  field('p_member', 'paragraph', '', {
    body: 'Membership runs month to month. Members get bench space, shared hand tools and a locker. Power tools need a separate induction.',
  }),
  field('t_locker', 'text', 'Preferred locker number', { assignedTo: 's_member' }),
  field('c_rules', 'checkbox', 'I have read the house rules', {
    required: true,
    assignedTo: 's_member',
  }),
  field('s_member', 'signature', 'Member'),
];

/** A short wavy line, so seeded "drawn" signatures look hand-made. */
function scribble(waves: number): Point[][] {
  const stroke: Point[] = [];
  for (let step = 0; step <= 40; step += 1) {
    const progress = step / 40;
    stroke.push({
      x: 0.08 + progress * 0.84,
      y: 0.5 + Math.sin(progress * Math.PI * waves) * 0.28 * (1 - progress * 0.5),
    });
  }
  return [stroke];
}

const tokenOf = (url: string): string => url.slice(url.lastIndexOf('/') + 1);

export async function isEmpty(deps: Deps): Promise<boolean> {
  const rows = await deps.db.admin.query<{ count: number }>(
    'select count(*)::int as count from users',
  );
  return firstRow(rows).count === 0;
}

export async function seedDemoData(deps: Deps): Promise<void> {
  const admin = deps.db.admin;
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const addUser = async (user: { name: string; email: string }): Promise<string> =>
    firstRow(
      await admin.query<{ id: string }>(
        'insert into users (email, name, password_hash) values ($1, $2, $3) returning id',
        [user.email, user.name, passwordHash],
      ),
    ).id;
  const addWorkspace = async (name: string, accentColor: string): Promise<string> =>
    firstRow(
      await admin.query<{ id: string }>(
        'insert into workspaces (name, accent_color) values ($1, $2) returning id',
        [name, accentColor],
      ),
    ).id;
  const addMember = async (workspaceId: string, userId: string, role: Role): Promise<Scope> => {
    await admin.query('insert into memberships (workspace_id, user_id, role) values ($1, $2, $3)', [
      workspaceId,
      userId,
      role,
    ]);
    return { workspaceId, userId, role };
  };

  const mira = await addUser(DEMO_USERS.owner);
  const jonas = await addUser(DEMO_USERS.editor);
  const priya = await addUser(DEMO_USERS.viewer);
  const tomas = await addUser(DEMO_USERS.otherOwner);

  const fernhill = await addWorkspace('Fernhill Makerspace', '#0F5C5C');
  const harbor = await addWorkspace('Tinker Harbor Workshop', '#8A3B12');

  const fernhillOwner = await addMember(fernhill, mira, 'owner');
  const fernhillEditor = await addMember(fernhill, jonas, 'editor');
  await addMember(fernhill, priya, 'viewer');
  const harborOwner = await addMember(harbor, tomas, 'owner');
  await addMember(harbor, mira, 'viewer');

  const publish = async (
    scope: Scope,
    title: string,
    description: string,
    fields: TemplateField[],
  ) => {
    const template = await createTemplate(deps, scope, { title, description });
    await saveDraft(deps, scope, template.id, {
      title,
      description,
      fields,
      expectedRevision: template.draftRevision,
    });
    return { template, version: await publishTemplate(deps, scope, template.id) };
  };

  const woodShop = await publish(
    fernhillOwner,
    'Wood shop safety agreement',
    'Signed by a member and a steward before the member uses the wood shop machines.',
    woodShopFields,
  );
  const studioHire = await publish(
    fernhillEditor,
    'Studio day hire',
    'Terms for hiring a studio for one day.',
    studioHireFields,
  );

  // A draft that is ahead of its published version, to show "unpublished changes".
  await saveDraft(deps, fernhillEditor, studioHire.template.id, {
    title: 'Studio day hire',
    description: 'Terms for hiring a studio for one day.',
    fields: [
      ...studioHireFields.slice(0, 5),
      field('t_guests', 'text', 'Number of guests', { assignedTo: 's_hirer' }),
      ...studioHireFields.slice(5),
    ],
    expectedRevision: 2,
  });

  // A template that has never been published and is not ready yet.
  const loan = await createTemplate(deps, fernhillEditor, {
    title: 'Tool loan form',
    description: 'For borrowing hand tools overnight. Still being written.',
  });
  await saveDraft(deps, fernhillEditor, loan.id, {
    title: loan.title,
    description: loan.description,
    fields: [
      field('h_loan', 'heading', 'Tool loan'),
      field('t_tool', 'text', 'Which tool?', { required: true }),
    ],
    expectedRevision: loan.draftRevision,
  });

  const memberAnswers = [
    { fieldId: 'c_induction', value: 'true' },
    { fieldId: 'c_protection', value: 'true' },
    { fieldId: 't_contact', value: 'Sam Whitlock' },
    { fieldId: 't_phone', value: '555 0142' },
    { fieldId: 'x_experience', value: 'Some experience' },
  ];

  // Completed: both parties signed.
  const completed = await createRequest(deps, fernhillOwner, {
    templateVersionId: woodShop.version.id,
    title: 'Wood shop sign-off for Elif Demir',
    message: 'Welcome to the wood shop. Please read the rules and sign.',
    expiresInDays: 14,
    signers: [
      { blockId: 's_member', name: 'Elif Demir', email: 'elif@example.com' },
      { blockId: 's_steward', name: 'Kofi Mensah', email: 'kofi@example.com' },
    ],
  });
  for (const [index, link] of completed.links.entries()) {
    const token = tokenOf(link.url);
    await recordView(deps, token, 'seed');
    await submitSignature(
      deps,
      token,
      index === 0
        ? { answers: memberAnswers, signature: { kind: 'drawn', strokes: scribble(5) } }
        : {
            answers: [
              { fieldId: 'd_induction', value: '2025-03-14' },
              { fieldId: 'l_notes', value: 'Confident with push sticks. Supervise first rip cut.' },
            ],
            signature: { kind: 'typed', text: 'Kofi Mensah' },
          },
      'seed',
    );
  }

  // Partly signed: the member signed, the steward has not.
  const partly = await createRequest(deps, fernhillEditor, {
    templateVersionId: woodShop.version.id,
    title: 'Wood shop sign-off for Noor Haddad',
    message: '',
    expiresInDays: 14,
    signers: [
      { blockId: 's_member', name: 'Noor Haddad', email: 'noor@example.com' },
      { blockId: 's_steward', name: 'Kofi Mensah', email: 'kofi@example.com' },
    ],
  });
  const memberLink = firstRow(partly.links);
  await recordView(deps, tokenOf(memberLink.url), 'seed');
  await submitSignature(
    deps,
    tokenOf(memberLink.url),
    { answers: memberAnswers, signature: { kind: 'drawn', strokes: scribble(7) } },
    'seed',
  );

  // Awaiting: nobody has opened the link yet.
  await createRequest(deps, fernhillEditor, {
    templateVersionId: studioHire.version.id,
    title: 'Print room hire, Saturday',
    message: 'Here are the hire terms for Saturday. Sign before you arrive.',
    expiresInDays: 7,
    signers: [{ blockId: 's_hirer', name: 'Ines Carvalho', email: 'ines@example.com' }],
  });

  // Revoked.
  const withdrawn = await createRequest(deps, fernhillOwner, {
    templateVersionId: studioHire.version.id,
    title: 'Ceramics studio hire (cancelled booking)',
    message: '',
    expiresInDays: 7,
    signers: [{ blockId: 's_hirer', name: 'Bao Tran', email: 'bao@example.com' }],
  });
  await revokeRequest(deps, fernhillOwner, withdrawn.request.id);

  // Expired: created forty days ago with a seven-day limit.
  const longAgo: Deps = { ...deps, now: () => new Date(deps.now().getTime() - 40 * 86_400_000) };
  await createRequest(longAgo, fernhillEditor, {
    templateVersionId: studioHire.version.id,
    title: 'Electronics bench hire, last month',
    message: '',
    expiresInDays: 7,
    signers: [{ blockId: 's_hirer', name: 'Lena Fischer', email: 'lena@example.com' }],
  });

  // The second workspace has its own data, which the first must never see.
  const membership = await publish(
    harborOwner,
    'Workshop membership terms',
    'Signed once by every new member.',
    membershipFields,
  );
  const harborRequest = await createRequest(deps, harborOwner, {
    templateVersionId: membership.version.id,
    title: 'Membership for Arjun Patel',
    message: 'Welcome aboard.',
    expiresInDays: 30,
    signers: [{ blockId: 's_member', name: 'Arjun Patel', email: 'arjun@example.com' }],
  });
  await submitSignature(
    deps,
    tokenOf(firstRow(harborRequest.links).url),
    {
      answers: [
        { fieldId: 't_locker', value: '12' },
        { fieldId: 'c_rules', value: 'true' },
      ],
      signature: { kind: 'typed', text: 'Arjun Patel' },
    },
    'seed',
  );
}
