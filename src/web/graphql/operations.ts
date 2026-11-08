import { graphql } from './tada';

export const FieldParts = graphql(`
  fragment FieldParts on Field @_unmask {
    id
    kind
    label
    body
    required
    options
    assignedTo
  }
`);

export const SignatureParts = graphql(`
  fragment SignatureParts on Signature @_unmask {
    kind
    text
    strokes {
      points {
        x
        y
      }
    }
  }
`);

export const ViewerQuery = graphql(`
  query Viewer {
    viewer {
      id
      name
      email
      memberships {
        role
        workspace {
          id
          name
          accentColor
        }
      }
    }
  }
`);

export const LoginMutation = graphql(`
  mutation Login($email: String!, $password: String!) {
    login(email: $email, password: $password) {
      id
      memberships {
        workspace {
          id
        }
      }
    }
  }
`);

export const LogoutMutation = graphql(`
  mutation Logout {
    logout
  }
`);

export const TemplatesQuery = graphql(`
  query Templates($workspaceId: ID!, $after: String) {
    workspace(id: $workspaceId) {
      id
      templates(first: 20, after: $after) {
        endCursor
        hasNextPage
        items {
          id
          title
          description
          updatedAt
          hasUnpublishedChanges
          latestVersion {
            id
            number
          }
        }
      }
    }
  }
`);

export const CreateTemplateMutation = graphql(`
  mutation CreateTemplate($workspaceId: ID!, $title: String!, $description: String!) {
    createTemplate(workspaceId: $workspaceId, title: $title, description: $description) {
      id
    }
  }
`);

export const TemplateQuery = graphql(
  `
    query Template($workspaceId: ID!, $templateId: ID!) {
      workspace(id: $workspaceId) {
        id
        template(id: $templateId) {
          id
          title
          description
          draftRevision
          hasUnpublishedChanges
          draftFields {
            ...FieldParts
          }
          versions {
            id
            number
            publishedAt
          }
        }
      }
    }
  `,
  [FieldParts],
);

export const SaveDraftMutation = graphql(`
  mutation SaveDraft($workspaceId: ID!, $templateId: ID!, $input: DraftInput!) {
    saveTemplateDraft(workspaceId: $workspaceId, templateId: $templateId, input: $input) {
      id
      draftRevision
    }
  }
`);

export const PublishTemplateMutation = graphql(`
  mutation PublishTemplate($workspaceId: ID!, $templateId: ID!) {
    publishTemplate(workspaceId: $workspaceId, templateId: $templateId) {
      id
      number
    }
  }
`);

export const RequestsQuery = graphql(`
  query Requests($workspaceId: ID!, $after: String, $status: RequestStatus) {
    workspace(id: $workspaceId) {
      id
      requests(first: 20, after: $after, status: $status) {
        endCursor
        hasNextPage
        items {
          id
          title
          status
          createdAt
          signerCount
          signedCount
          version {
            id
            number
            title
          }
          signers {
            id
            name
          }
        }
      }
    }
  }
`);

export const PublishedTemplatesQuery = graphql(
  `
    query PublishedTemplates($workspaceId: ID!) {
      workspace(id: $workspaceId) {
        id
        templates(first: 50) {
          items {
            id
            title
            latestVersion {
              id
              number
              signatureBlocks {
                ...FieldParts
              }
            }
          }
        }
      }
    }
  `,
  [FieldParts],
);

export const CreateRequestMutation = graphql(`
  mutation CreateRequest($workspaceId: ID!, $input: NewRequestInput!) {
    createSigningRequest(workspaceId: $workspaceId, input: $input) {
      request {
        id
      }
      links {
        signerId
        label
        name
        url
      }
    }
  }
`);

export const RequestQuery = graphql(
  `
    query Request($workspaceId: ID!, $requestId: ID!) {
      workspace(id: $workspaceId) {
        id
        request(id: $requestId) {
          id
          title
          message
          status
          createdAt
          expiresAt
          completedAt
          revokedAt
          pdfUrl
          version {
            id
            number
            title
            description
            fields {
              ...FieldParts
            }
          }
          signers {
            id
            blockId
            label
            name
            email
            viewedAt
            signedAt
            signature {
              ...SignatureParts
            }
            answers {
              fieldId
              value
            }
          }
          events {
            seq
            kind
            occurredAt
            hash
            actorName
          }
        }
      }
    }
  `,
  [FieldParts, SignatureParts],
);

export const HistoryCheckQuery = graphql(`
  query HistoryCheck($workspaceId: ID!, $requestId: ID!) {
    workspace(id: $workspaceId) {
      id
      request(id: $requestId) {
        id
        historyCheck {
          intact
          checkedEvents
          problem
        }
      }
    }
  }
`);

export const RevokeRequestMutation = graphql(`
  mutation RevokeRequest($workspaceId: ID!, $requestId: ID!) {
    revokeSigningRequest(workspaceId: $workspaceId, requestId: $requestId) {
      id
      status
    }
  }
`);

export const ReissueLinkMutation = graphql(`
  mutation ReissueLink($workspaceId: ID!, $signerId: ID!) {
    reissueSignerLink(workspaceId: $workspaceId, signerId: $signerId) {
      signerId
      label
      name
      url
    }
  }
`);

export const SettingsQuery = graphql(`
  query Settings($workspaceId: ID!) {
    workspace(id: $workspaceId) {
      id
      name
      accentColor
      role
      members {
        id
        name
        email
        role
      }
    }
  }
`);

export const UpdateBrandingMutation = graphql(`
  mutation UpdateBranding($workspaceId: ID!, $name: String!, $accentColor: String!) {
    updateWorkspaceBranding(workspaceId: $workspaceId, name: $name, accentColor: $accentColor) {
      id
      name
      accentColor
    }
  }
`);

export const SigningSessionQuery = graphql(
  `
    query SigningSession($token: String!) {
      signingSession(token: $token) {
        state
        workspaceName
        accentColor
        requestTitle
        message
        expiresAt
        versionNumber
        documentTitle
        documentDescription
        yourBlockId
        fields {
          ...FieldParts
        }
        parties {
          blockId
          label
          name
          signedAt
          isYou
          signature {
            ...SignatureParts
          }
        }
        answers {
          fieldId
          value
        }
      }
    }
  `,
  [FieldParts, SignatureParts],
);

export const RecordViewMutation = graphql(`
  mutation RecordView($token: String!) {
    recordSigningView(token: $token)
  }
`);

export const SubmitSignatureMutation = graphql(`
  mutation SubmitSignature($token: String!, $input: SubmissionInput!) {
    submitSignature(token: $token, input: $input)
  }
`);
