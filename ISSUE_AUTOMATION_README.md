# Issue Resolution Automation Setup

This repository now includes automated tooling to identify and label issues that have been resolved in the main branch but are still marked as open in GitHub.

## Quick Start

The automation is now set up and will run automatically when changelog files are updated. No additional configuration is required.

### Manual Run

To manually run the automation:

1. Go to Actions tab in GitHub
2. Find "Label Resolved Issues" workflow
3. Click "Run workflow"
4. Optionally check "Run in dry-run mode" to test without making changes

### Local Testing

```bash
# Install dependencies (Node.js 18+ required)
export GITHUB_TOKEN="your_personal_access_token"
export GITHUB_REPOSITORY="yuttie/mory"

# Test in dry-run mode
export DRY_RUN="true"
node scripts/label-resolved-issues.js

# Run with actual changes
export DRY_RUN="false"
node scripts/label-resolved-issues.js
```

## How It Works

1. **Detects resolved issues** by scanning:
   - `frontend/CHANGELOG.md`
   - `backend/CHANGELOG.md`
   - Recent commit messages

2. **Checks GitHub API** to see if referenced issues are still open

3. **Adds `resolved-in-main` label** to open issues that appear resolved

4. **Posts explanation comment** so maintainers understand the labeling

## Example Workflow

When you:
1. Fix an issue and reference it in the changelog (e.g., "- Fix navigation bug (#123)")
2. Push changes to main branch
3. The automation runs and finds issue #123 is still open
4. It adds the `resolved-in-main` label and a comment
5. Maintainer can review and close the issue if appropriate

## Files Added

- `.github/workflows/label-resolved-issues.yml` - GitHub Action
- `scripts/label-resolved-issues.js` - Main script
- `docs/issue-resolution-automation.md` - Detailed documentation

## Benefits

- Prevents resolved issues from being forgotten
- Maintains clean issue tracker
- Reduces manual maintenance overhead
- Provides clear audit trail of automatic actions

## Safety Features

- Always adds labels (never closes issues automatically)
- Includes explanatory comments for transparency
- Supports dry-run mode for testing
- Rate-limited API calls to respect GitHub limits
- Only processes issues referenced in changelogs or recent commits