# Contributing to ProtSpace

Thanks for your interest in contributing! All types of contributions are welcome: bug reports, feature requests, documentation improvements, and code contributions.

## Table of Contents

- [Contributing to ProtSpace](#contributing-to-protspace)
  - [Table of Contents](#table-of-contents)
  - [Quick Start](#quick-start)
  - [Development Workflow](#development-workflow)
  - [Reporting Issues](#reporting-issues)
    - [Bug Reports](#bug-reports)
    - [Feature Requests](#feature-requests)
    - [Questions](#questions)
  - [Code Contributions](#code-contributions)
    - [Monorepo Structure](#monorepo-structure)
    - [Making Changes](#making-changes)
    - [Code Quality Standards](#code-quality-standards)
    - [Testing](#testing)
  - [Documentation](#documentation)
  - [Pull Request Process](#pull-request-process)
  - [Commit Message Guidelines](#commit-message-guidelines)
  - [Code of Conduct](#code-of-conduct)
  - [Getting Help](#getting-help)

## Quick Start

**Prerequisites:** Node.js v22+, pnpm v10.24.0+

```bash
# Install dependencies
npm install -g pnpm
pnpm install

# Start development
pnpm dev          # App + docs
pnpm dev:app      # App only
pnpm dev:docs     # Docs only (localhost:5174)

# Before committing (matches the installed Git hook, including docs validation)
pnpm precommit
```

## Development Workflow

1. **Fork and clone** the repository
2. **Create a branch** from `main` with a descriptive name
3. **Make your changes** following code standards
4. **Run quality checks:** `pnpm precommit`
5. **Commit** using [conventional commits](#commit-message-guidelines)
6. **Push** and open a pull request

## Reporting Issues

### Bug Reports

Before reporting a bug:

- Search [existing issues](https://github.com/tsenoner/protspace/issues?q=label%3Abug) to avoid duplicates
- Verify you're using the latest version
- Confirm the issue is reproducible

**Required information:**

- **Clear title** describing the issue
- **Environment:** Browser/Node version, OS, package versions
- **Steps to reproduce:** Detailed, numbered steps
- **Expected behavior:** What should happen
- **Actual behavior:** What actually happens
- **Code sample/screenshot:** If applicable
- **Error messages:** Full stack trace if available

**Security vulnerabilities:** Contact maintainers privately; do not open public issues.

[Create bug report →](https://github.com/tsenoner/protspace/issues/new)

### Feature Requests

Before suggesting an enhancement:

- Search [existing issues](https://github.com/tsenoner/protspace/issues) for similar requests
- Consider if it fits the project scope
- Ensure it benefits most users, not just specific use cases

**Required information:**

- **Clear title** describing the feature
- **Problem statement:** What need does this address?
- **Proposed solution:** Detailed description of the feature
- **Alternatives considered:** Other approaches you've evaluated
- **Use cases:** Real-world scenarios where this is needed
- **Examples:** Screenshots, mockups, or references from other projects

[Create feature request →](https://github.com/tsenoner/protspace/issues/new)

### Questions

For general questions:

1. Check [existing issues](https://github.com/tsenoner/protspace/issues)
2. Search the [documentation](https://github.com/tsenoner/protspace/tree/main/docs)
3. If unresolved, [open a new issue](https://github.com/tsenoner/protspace/issues/new) with context and environment details

## Code Contributions

> **Legal Notice:** By contributing, you confirm that you authored 100% of the content, have the necessary rights, and agree that the contribution may be provided under the project license.

### Monorepo Structure

```
packages/
├── core/          # Core web components (Lit)
├── utils/         # Utility functions
app/               # Demo application + landing page
docs/              # Documentation site (VitePress)
```

**Working on individual packages:**

```bash
cd packages/core
pnpm dev          # Watch mode for development
pnpm build        # Build package
pnpm lint         # Check code quality
pnpm type-check   # Validate TypeScript types
```

### Making Changes

**Development commands:**

```bash
pnpm dev          # Start all development servers
pnpm build        # Build all packages
pnpm test         # Run test suites
pnpm clean        # Clean build artifacts
```

**Code quality checks:**

```bash
pnpm precommit    # Mirror the installed pre-commit hook, including docs validation

# The exact hook path is `pnpm precommit`. Use these as targeted spot checks when you do not need the full hook:
pnpm quality      # Run the shared static-quality gate (types + Knip)
pnpm format       # Auto-format with Prettier
pnpm lint:fix     # Auto-fix linting issues with ESLint
pnpm type-check   # Validate TypeScript compilation
pnpm knip         # Find unused files, exports, and imports
pnpm knip:dependencies  # Validate dependency declarations
pnpm test:ci      # Run the CI test suite locally
pnpm docs:build   # Verify the documentation build
```

### Code Quality Standards

**Automated CI checks** (all PRs must pass):

1. Code formatting (Prettier)
2. Linting (ESLint)
3. Type checking (TypeScript)
4. Build compilation
5. Test suite execution
6. Documentation build

**Code style requirements:**

- Use `import type` for TypeScript type-only imports
- Avoid `any` types; use proper TypeScript types
- Minimize `console` usage; prefer `console.warn`/`console.error` only
- Write JSDoc comments for public APIs and exported functions
- Keep functions focused and maintainable
- Follow existing patterns in the codebase

### Messaging Consistency

- Prefer `app/src/lib/notify.ts` for app-level transient notifications.
- Avoid new browser `alert()` calls in runtime code.
- Update docs and tests in the same PR when user-facing messaging or event contracts change.

**Configuration files:**

- `.prettierrc` - Formatting rules
- `eslint.config.mjs` - Linting rules
- `tsconfig.json` - TypeScript configuration

**Recommended IDE setup (VSCode):**

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true
  }
}
```

**Required extensions:** ESLint, Prettier, TypeScript Language Features

### Testing

```bash
pnpm test         # Run tests in watch mode
pnpm test:ci      # Run the non-watch CI test suite
pnpm test:e2e     # Run Playwright browser coverage
```

## Documentation

**Working on docs:**

```bash
pnpm dev:docs      # Start dev server (localhost:5174)
pnpm docs:build    # Build static site
pnpm docs:preview  # Preview production build
pnpm docs:images   # Generate all documentation images (screenshots, animations, GIFs)
```

**Documentation standards:**

- Follow Markdown best practices
- Include practical code examples
- Keep API documentation synchronized with code
- Add JSDoc comments to TypeScript interfaces and functions
- Update README.md for significant features
- Use clear, concise language
- Ensure accessibility for new users
- Keep the messaging model in `docs/developers/messaging.md` aligned with runtime behavior

## Pull Request Process

1. **Ensure all checks pass:**
   - Run `pnpm precommit` locally (same checks as the Git hook)
   - Verify CI checks are green
   - Resolve any failing tests

2. **PR requirements:**
   - Clear, descriptive title following [commit conventions](#commit-message-guidelines)
   - Description explaining the changes and rationale
   - Reference related issues (e.g., "Fixes #123")
   - Screenshots/examples for UI changes
   - Documentation updates if applicable

3. **Review process:**
   - Maintainers will review your PR
   - Address feedback in new commits
   - Once approved, maintainers will merge

4. **Best practices:**
   - Keep PRs focused on a single concern
   - Break large changes into smaller, reviewable PRs
   - Ensure backward compatibility unless explicitly breaking
   - Update tests for changed functionality

## Commit Message Guidelines

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**

- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `style` - Formatting, missing semicolons, etc. (no code change)
- `refactor` - Code restructuring (no feature change or bug fix)
- `perf` - Performance improvement
- `test` - Adding or updating tests
- `build` - Build system or dependencies
- `ci` - CI configuration changes
- `chore` - Maintenance tasks

**Scope:** Optional, indicates component (e.g., `scatter-plot`, `legend`, `utils`)

**Examples:**

```
feat(scatter-plot): add zoom controls for data exploration
fix(legend): resolve color scale rendering issue
docs(api): update data loading examples with new format
refactor(utils): simplify color conversion logic
test(core): add integration tests for data loader
```

**Rules:**

- Use imperative, present tense ("add" not "added" or "adds")
- Don't capitalize first letter
- No period at the end
- Body/footer optional but recommended for complex changes
- Reference issues in footer: `Fixes #123` or `Closes #456`
- Breaking changes: Include `BREAKING CHANGE:` in footer

## Code of Conduct

This project follows our [Code of Conduct](https://github.com/tsenoner/protspace/blob/main/CODE_OF_CONDUCT.md). We expect all contributors to:

- Be respectful and constructive
- Welcome diverse perspectives
- Focus on what's best for the community
- Show empathy towards others

Report unacceptable behavior to project maintainers.

---

## Getting Help

- 📖 [Documentation](https://github.com/tsenoner/protspace/tree/main/docs)
- 🐛 [Bug Reports](https://github.com/tsenoner/protspace/issues?q=label%3Abug)
- 💡 [Feature Requests](https://github.com/tsenoner/protspace/issues?q=label%3Aenhancement)
