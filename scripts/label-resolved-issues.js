#!/usr/bin/env node

/**
 * Script to identify and label issues that are resolved in the main branch
 * This can be run manually or as part of automation
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Configuration
const CHANGELOG_PATHS = [
  'frontend/CHANGELOG.md',
  'backend/CHANGELOG.md'
];

const RESOLVED_KEYWORDS = [
  'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved',
  'close', 'closes', 'closed', 'implement', 'implements', 'implemented',
  'add', 'adds', 'added', 'complete', 'completes', 'completed'
];

/**
 * Extract issue numbers from changelog files
 */
function extractIssuesFromChangelogs() {
  const issues = new Set();
  
  for (const changelogPath of CHANGELOG_PATHS) {
    if (fs.existsSync(changelogPath)) {
      const content = fs.readFileSync(changelogPath, 'utf8');
      const matches = content.match(/#(\d+)/g);
      
      if (matches) {
        matches.forEach(match => {
          const issueNumber = match.replace('#', '');
          issues.add(parseInt(issueNumber));
        });
      }
    }
  }
  
  return Array.from(issues).sort((a, b) => a - b);
}

/**
 * Extract issue numbers from recent commit messages
 */
function extractIssuesFromCommits(sinceDays = 30) {
  const issues = new Set();
  
  try {
    // Get commits from the last X days
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - sinceDays);
    const since = sinceDate.toISOString().split('T')[0];
    
    const commits = execSync(`git log --since="${since}" --oneline --grep="#[0-9]" --all`, { encoding: 'utf8' });
    
    const matches = commits.match(/#(\d+)/g);
    if (matches) {
      matches.forEach(match => {
        const issueNumber = match.replace('#', '');
        issues.add(parseInt(issueNumber));
      });
    }
    
    // Also check for "fixes #123" patterns in commit messages
    const fixCommits = execSync(`git log --since="${since}" --oneline --grep="\\(${RESOLVED_KEYWORDS.join('\\|')}\\).*#[0-9]" --all`, { encoding: 'utf8' });
    
    const fixMatches = fixCommits.match(/#(\d+)/g);
    if (fixMatches) {
      fixMatches.forEach(match => {
        const issueNumber = match.replace('#', '');
        issues.add(parseInt(issueNumber));
      });
    }
  } catch (error) {
    console.log('Note: Could not extract issues from git commits (this is normal if run outside a git repository)');
  }
  
  return Array.from(issues).sort((a, b) => a - b);
}

/**
 * Check if an issue exists and get its current state
 */
async function checkIssueStatus(issueNumber, token, repository) {
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues/${issueNumber}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return { exists: false };
      }
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const issue = await response.json();
    return {
      exists: true,
      state: issue.state,
      title: issue.title,
      labels: issue.labels.map(label => label.name),
      isPullRequest: !!issue.pull_request
    };
  } catch (error) {
    console.error(`Error checking issue #${issueNumber}:`, error.message);
    return { exists: false, error: error.message };
  }
}

/**
 * Add label to an issue
 */
async function addLabelToIssue(issueNumber, label, token, repository, dryRun = false) {
  if (dryRun) {
    console.log(`DRY RUN: Would add label "${label}" to issue #${issueNumber}`);
    return true;
  }
  
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues/${issueNumber}/labels`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([label])
    });
    
    return response.ok;
  } catch (error) {
    console.error(`Error adding label to issue #${issueNumber}:`, error.message);
    return false;
  }
}

/**
 * Add comment to an issue
 */
async function addCommentToIssue(issueNumber, comment, token, repository, dryRun = false) {
  if (dryRun) {
    console.log(`DRY RUN: Would add comment to issue #${issueNumber}: ${comment.substring(0, 100)}...`);
    return true;
  }
  
  try {
    const response = await fetch(`https://api.github.com/repos/${repository}/issues/${issueNumber}/comments`, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ body: comment })
    });
    
    return response.ok;
  } catch (error) {
    console.error(`Error adding comment to issue #${issueNumber}:`, error.message);
    return false;
  }
}

/**
 * Main function to process resolved issues
 */
async function main() {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const dryRun = process.env.DRY_RUN === 'true';
  
  if (!token) {
    console.error('ERROR: GITHUB_TOKEN environment variable is required');
    process.exit(1);
  }
  
  if (!repository) {
    console.error('ERROR: GITHUB_REPOSITORY environment variable is required (format: owner/repo)');
    process.exit(1);
  }
  
  console.log(`🔍 Scanning for resolved issues in repository: ${repository}`);
  console.log(`🔧 Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE (changes will be made)'}`);
  
  // Extract issues from changelogs
  console.log('\n📋 Extracting issues from changelogs...');
  const changelogIssues = extractIssuesFromChangelogs();
  console.log(`Found ${changelogIssues.length} issues referenced in changelogs: ${changelogIssues.join(', ')}`);
  
  // Extract issues from recent commits
  console.log('\n📝 Extracting issues from recent commits...');
  const commitIssues = extractIssuesFromCommits(60); // Last 60 days
  console.log(`Found ${commitIssues.length} issues referenced in recent commits: ${commitIssues.join(', ')}`);
  
  // Combine and deduplicate
  const allIssues = [...new Set([...changelogIssues, ...commitIssues])].sort((a, b) => a - b);
  console.log(`\n🔗 Total unique issues to check: ${allIssues.length}`);
  
  let processedCount = 0;
  let labeledCount = 0;
  
  for (const issueNumber of allIssues) {
    console.log(`\n🔍 Checking issue #${issueNumber}...`);
    
    const status = await checkIssueStatus(issueNumber, token, repository);
    
    if (!status.exists) {
      console.log(`   ❌ Issue #${issueNumber} does not exist or is not accessible`);
      continue;
    }
    
    if (status.isPullRequest) {
      console.log(`   📋 #${issueNumber} is a pull request: ${status.title}`);
      console.log(`   📌 State: ${status.state}`);
      continue;
    }
    
    console.log(`   📝 Issue #${issueNumber}: ${status.title}`);
    console.log(`   📌 State: ${status.state}`);
    console.log(`   🏷️  Labels: ${status.labels.length > 0 ? status.labels.join(', ') : 'none'}`);
    
    if (status.state === 'open') {
      const hasResolvedLabel = status.labels.includes('resolved-in-main');
      
      if (!hasResolvedLabel) {
        console.log(`   ✅ Issue appears to be resolved but is still open. Adding label...`);
        
        const success = await addLabelToIssue(issueNumber, 'resolved-in-main', token, repository, dryRun);
        
        if (success) {
          labeledCount++;
          
          const comment = `🤖 This issue has been automatically labeled as \`resolved-in-main\` because it was referenced in the changelog or recent commits, indicating it has been resolved in the main branch.

If this is correct, you may want to close this issue. If this labeling is incorrect, please remove the label and let us know.

**References found in:**
${changelogIssues.includes(issueNumber) ? '- 📋 Changelog files' : ''}
${commitIssues.includes(issueNumber) ? '- 📝 Recent commit messages' : ''}`;
          
          await addCommentToIssue(issueNumber, comment, token, repository, dryRun);
          console.log(`   ✅ Successfully labeled issue #${issueNumber}`);
        } else {
          console.log(`   ❌ Failed to label issue #${issueNumber}`);
        }
      } else {
        console.log(`   ℹ️  Issue already has 'resolved-in-main' label`);
      }
    } else {
      console.log(`   ✅ Issue is already closed`);
    }
    
    processedCount++;
    
    // Rate limiting: small delay between requests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log(`\n🎉 Processing complete!`);
  console.log(`   📊 Issues processed: ${processedCount}`);
  console.log(`   🏷️  Issues labeled: ${labeledCount}`);
  
  if (dryRun) {
    console.log(`   ℹ️  This was a dry run - no actual changes were made`);
  }
}

// Run the script
if (require.main === module) {
  main().catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });
}

module.exports = {
  extractIssuesFromChangelogs,
  extractIssuesFromCommits,
  checkIssueStatus,
  addLabelToIssue,
  addCommentToIssue
};