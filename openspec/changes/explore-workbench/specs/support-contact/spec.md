## MODIFIED Requirements

### Requirement: Feedback action in header

Home's site header, the docs' nav bar and the explore page's app bar SHALL each offer the same
Feedback menu: an icon button named "Feedback" that opens a menu named "Feedback" with "Email
hello@protspace.app" (a `mailto:` to the support inbox whose subject identifies feedback), "Copy
email address" (copies the address and confirms it) and "Open a GitHub issue" (a new issue on the
repository, in a new tab). A bare `mailto:` does nothing without a mail app, so the menu always
offers a way that works. The menu SHALL open by click, Enter or Space with focus on its first
entry, and Escape SHALL close it and return focus to the button. In the phone menus of Home and
the docs, and in the explore page's More sheet on a phone, the three entries SHALL be listed under
Feedback; in the More sheet a Feedback row unfolds them in place, and picking one closes the sheet
as it acts.

#### Scenario: The same menu on Home, in the docs and in Explore

- **WHEN** the user opens Feedback in Home's header, the docs' nav or Explore's app bar
- **THEN** a menu named "Feedback" lists "Email hello@protspace.app", "Copy email address" and
  "Open a GitHub issue", the first focused

#### Scenario: Copying the address

- **WHEN** the user picks "Copy email address"
- **THEN** `hello@protspace.app` is on the clipboard and the page confirms the copy

#### Scenario: Feedback on a phone

- **WHEN** the user unfolds the Feedback row of the explore page's More sheet on a phone
- **THEN** "Email hello@protspace.app", "Copy email address" and "Open a GitHub issue" are listed
  under it
- **AND** picking one closes the sheet and runs it

## ADDED Requirements

### Requirement: Every notification on the explore page can be dismissed

Every notification the explore page shows SHALL carry a close button named "Dismiss notification",
beside any action the notification offers, so a user can remove it before it times out.

#### Scenario: A notification with an action

- **WHEN** removing the filter shows the "Filter removed" notification with its Undo action
- **THEN** the notification also shows a button named "Dismiss notification"
