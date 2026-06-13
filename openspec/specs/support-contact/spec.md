# support-contact Specification

## Purpose

In-app paths to reach the support inbox (`hello@protspace.app`) for general contact, bug/error reporting, and privacy/legal requests. Bug reports are prefilled with context and offer a GitHub-issue fallback for users without a configured mail client; a top-level crash fallback replaces the blank-screen failure mode.

## Requirements

### Requirement: Support link construction

The system SHALL provide pure builder functions that construct `mailto:` links, prefilled GitHub-issue links, and bug-report bodies from a single source for the support address (`hello@protspace.app`) and the project's GitHub repository URL.

#### Scenario: Mailto link with subject and body

- **WHEN** a `mailto:` link is built with a subject and body
- **THEN** the result targets `hello@protspace.app` with `subject` and `body` query parameters, each URL-encoded

#### Scenario: Empty parameters omitted

- **WHEN** a `mailto:` or GitHub-issue link is built with an empty or absent subject or body
- **THEN** that empty query parameter is omitted from the resulting URL and the URL remains valid

#### Scenario: GitHub issue link is prefilled and labeled

- **WHEN** a GitHub-issue link is built with a title and body
- **THEN** the result targets the project repository's `/issues/new` endpoint with URL-encoded `title` and `body` and a `bug` label

#### Scenario: Bug context includes technical details

- **WHEN** a bug-report body is built for a given operation and error
- **THEN** the body contains free-text prompts for what happened and steps to reproduce, plus a technical block listing the operation, the error message, the page URL, and the browser string

#### Scenario: Long error text is truncated

- **WHEN** a bug-report body is built from an error whose message or stack exceeds the length cap
- **THEN** the error text is truncated below the cap so the resulting link stays within the practical `mailto` length limit

#### Scenario: Non-Error values are tolerated

- **WHEN** a bug-report body is built from a value that is not an `Error` (such as a string or unknown value)
- **THEN** the builder produces a body without throwing

### Requirement: General contact link in footer

The site footer SHALL present a Contact link that opens a `mailto:` to the support inbox.

#### Scenario: Footer contact link present

- **WHEN** a page that renders the footer is displayed
- **THEN** a "Contact" link is shown alongside the existing footer links, and its target is a `mailto:` to `hello@protspace.app`

### Requirement: Privacy contact section

The Privacy page SHALL provide a contact path for privacy and data requests.

#### Scenario: Privacy page exposes a contact

- **WHEN** the Privacy page is displayed
- **THEN** it includes a contact section with a `mailto:` to `hello@protspace.app` whose subject identifies a privacy request

### Requirement: Bug report action on failure notifications

Dataset-import and export failure notifications SHALL offer an action that opens a prefilled support email.

#### Scenario: Report action on import/export failure

- **WHEN** a dataset-import or export failure notification is shown
- **THEN** it includes a "Report this" action whose target is a `mailto:` prefilled with a bug subject and a bug-report body describing the failing operation and its error

#### Scenario: Notification action opens its target

- **WHEN** a notification's report action is activated
- **THEN** the action's `mailto:` target is opened in the current window

#### Scenario: Notifications without an action are unaffected

- **WHEN** a notification that defines no action is shown
- **THEN** it renders as before with no action button and existing deduplication behavior unchanged

### Requirement: Application crash fallback

The application SHALL render a recovery fallback instead of a blank screen when a render-time error escapes to the top level.

#### Scenario: Render crash shows fallback

- **WHEN** a render-time error propagates to the top-level error boundary
- **THEN** a fallback screen is shown with a Reload action, an "Email us" action, and an "Open a GitHub issue" action

#### Scenario: Crash report links carry context

- **WHEN** the crash fallback is shown
- **THEN** the "Email us" target is a `mailto:` and the "Open a GitHub issue" target is a GitHub-issue link, each prefilled with the current page and a truncated error/stack

### Requirement: Broken-link contact on not-found page

The 404 page SHALL offer a contact path prefilled with the attempted path.

#### Scenario: Not-found page offers email

- **WHEN** the 404 page is displayed
- **THEN** it includes a line linking to a `mailto:` whose body includes the attempted path
