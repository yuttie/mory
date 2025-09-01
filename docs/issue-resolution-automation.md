# Issue Resolution Automation

This repository includes automated tooling to identify and label issues that have been resolved in the main branch but are still marked as open in GitHub.

## How it works

The automation system works by:

1. **Scanning changelogs** - Looks for issue references (like `#123`) in `frontend/CHANGELOG.md` and `backend/CHANGELOG.md`
2. **Scanning recent commits** - Examines git commit messages from the last 60 days for issue references
3. **Checking issue status** - Uses the GitHub API to check if referenced issues are still open
4. **Labeling resolved issues** - Automatically adds a `resolved-in-main` label to open issues that appear to be resolved
5. **Adding explanatory comments** - Leaves a comment explaining why the label was added

## Automation triggers

The automation runs automatically when:

- Changes are pushed to the `main` branch that modify either changelog file
- Manual trigger via GitHub Actions workflow dispatch

## Manual usage

You can also run the script manually:

```bash
# Set required environment variables
export GITHUB_TOKEN="your_token_here"
export GITHUB_REPOSITORY="yuttie/mory"

# Run in dry-run mode (no changes made)
export DRY_RUN="true"
node scripts/label-resolved-issues.js

# Run with actual changes
export DRY_RUN="false"
node scripts/label-resolved-issues.js
```

## Files

- `.github/workflows/label-resolved-issues.yml` - GitHub Action workflow
- `scripts/label-resolved-issues.js` - Main automation script

## Labels applied

When an issue is detected as resolved, the automation:

1. Adds the `resolved-in-main` label
2. Leaves a comment explaining the automatic labeling
3. Suggests that maintainers should close the issue if the labeling is correct

## Configuration

The script can be configured by modifying constants at the top of `scripts/label-resolved-issues.js`:

- `CHANGELOG_PATHS` - Which changelog files to scan
- `RESOLVED_KEYWORDS` - Keywords in commit messages that indicate resolution

## Benefits

This automation helps maintain a clean issue tracker by:

- Identifying issues that may have been forgotten about after resolution
- Providing a consistent way to mark resolved issues
- Reducing manual overhead for maintainers
- Ensuring the issue tracker accurately reflects the current state of the project