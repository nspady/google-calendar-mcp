# GitHub Actions Workflows

## `ci.yml`
**Triggers**: push to `main` or `feature/**`, pull requests to `main`

1. **test-and-coverage** (Node 20, 22, 24): undeclared-import check, type-check (`npm run lint`), build, and unit tests with coverage thresholds (`npm run test:coverage`). The coverage report is uploaded as an artifact from the Node 22 run.
2. **tool-description-analysis** (PRs only): compares tool-description token counts between the PR and its base branch and posts the report as a PR comment. Fork PRs get the report in the job log only, since their token cannot comment.

## `publish.yml`
Runs [release-please](https://github.com/googleapis/release-please) on `main`; when a release PR is merged it builds and publishes to npm.

## Running locally

```bash
npm run lint             # type-check
npm test                 # unit tests
npm run test:coverage    # unit tests with coverage thresholds
npm run analyze:tokens:compare   # token comparison (see scripts/analyze-tool-descriptions.ts for the baseline step)
```
