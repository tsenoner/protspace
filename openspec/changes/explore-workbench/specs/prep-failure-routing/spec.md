## MODIFIED Requirements

### Requirement: Notifications support an optional action

The notification primitive SHALL accept up to two optional actions, a primary `action` and a
`secondaryAction`, each either a link (a label and an href) or a callback (a label and an
`onClick`), and SHALL render them as the toast's action controls, the secondary one beside the
primary. Activating either SHALL dismiss the toast and SHALL let the same notification show again
at once, so a Retry that fails again can say so.

#### Scenario: Action forwarded to the toast

- **WHEN** a notification is emitted with an `action` of `{ label, href }`
- **THEN** the toast is created with an action control bearing that label
- **AND** activating it navigates to the href — `mailto:` links via the current
  window, `http(s)` links in a new tab with `noopener`

#### Scenario: A callback and a secondary action

- **WHEN** a notification is emitted with an `action` of `{ label, onClick }` and a
  `secondaryAction` of `{ label, href }`
- **THEN** the toast shows both controls, the first running the callback and the second opening the
  link

#### Scenario: No action when omitted

- **WHEN** a notification is emitted without an `action`
- **THEN** the toast is created without an action control
