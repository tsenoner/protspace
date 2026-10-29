## MODIFIED Requirements

### Requirement: Feedback action in header

The site header SHALL present a prominent Feedback button that opens a `mailto:` to the support
inbox, available on both desktop and mobile navigation. The explore page, which shows no site
header, SHALL offer the same `mailto:` in its app bar as an icon link named "Feedback" with the
tooltip "Feedback", and on a phone as the More sheet's Feedback row, which closes the sheet as the
mail client opens.

#### Scenario: Header feedback button present

- **WHEN** a page that renders the header is displayed
- **THEN** a "Feedback" button is shown in the navigation, and its target is a `mailto:` to `hello@protspace.app` whose subject identifies feedback

#### Scenario: Feedback on the explore page

- **WHEN** the explore page is open on a desktop, or its More sheet is open on a phone
- **THEN** a link named "Feedback" is offered with the same `mailto:` target
- **AND** on a phone, activating it closes the sheet

## ADDED Requirements

### Requirement: Every notification on the explore page can be dismissed

Every notification the explore page shows SHALL carry a close button named "Dismiss notification",
beside any action the notification offers, so a user can remove it before it times out.

#### Scenario: A notification with an action

- **WHEN** removing the filter shows the "Filter removed" notification with its Undo action
- **THEN** the notification also shows a button named "Dismiss notification"
