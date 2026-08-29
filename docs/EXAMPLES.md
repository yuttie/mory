# mory Examples

This document provides practical examples of how to use mory's various features with real-world scenarios.

## Table of Contents

- [Basic Notes](#basic-notes)
- [Task Examples](#task-examples)
- [Event Examples](#event-examples)
- [Advanced Workflows](#advanced-workflows)
- [API Usage Examples](#api-usage-examples)

## Basic Notes

### Simple Note
```markdown
---
tags:
  - personal
  - journal
---

# Daily Reflection - December 1, 2023

Today was productive. Completed the quarterly review and started planning for next year.

## Key Insights:
- Focus on automation in Q1
- Team collaboration needs improvement
- Budget allocation for new tools

## Tomorrow's Priorities:
1. Review budget proposals
2. Schedule 1:1s with team members
3. Draft Q1 objectives
```

### Note with Links and Images
```markdown
---
tags:
  - research
  - technology
  - web-development
---

# Modern Web Development Stack

## Overview
Current state of web development tools and frameworks in 2023.

## Frontend Frameworks
- **React**: Still dominant, but competition is fierce
- **Vue.js**: Growing steadily, great developer experience
- **Svelte**: Innovative approach, smaller bundle sizes

## Architecture Diagram
![Web Architecture](./diagrams/web-architecture.png)

## Resources
- [MDN Web Docs](https://developer.mozilla.org/)
- [Can I Use](https://caniuse.com/)
- [Lighthouse Performance](https://lighthouse.googlechrome.com/)

## Next Steps
- [ ] Evaluate build tools
- [ ] Research state management
- [ ] Test performance metrics
```

## Task Examples

### Simple Todo Task
```markdown
---
tags:
  - work
  - development
task:
  status:
    kind: todo
  progress: 0
  importance: 3
  urgency: 2
  scheduled_dates:
    - "2023-12-01"
---

# Implement User Authentication

Add JWT-based authentication to the application.

## Requirements:
- Login/logout functionality
- Token refresh mechanism
- Protected route handling
- Session management

## Acceptance Criteria:
- [ ] User can log in with credentials
- [ ] Tokens expire after configured time
- [ ] Refresh tokens work correctly
- [ ] Protected routes redirect properly
```

### In-Progress Task with Subtasks
```markdown
---
tags:
  - project
  - documentation
task:
  status:
    kind: in_progress
  progress: 45
  importance: 4
  urgency: 3
  start_at: "2023-11-28T09:00:00+00:00"
  due_by: "2023-12-05T17:00:00+00:00"
  scheduled_dates:
    - "2023-11-28"
    - "2023-11-29"
    - "2023-12-01"
    - "2023-12-04"
---

# Complete API Documentation

Comprehensive documentation for all API endpoints.

## Progress Tracking:
- [x] Authentication endpoints
- [x] Notes API (CRUD operations)
- [x] Files API (upload/download)
- [ ] Tasks API v2
- [ ] Events API v2
- [ ] Error handling examples
- [ ] Rate limiting documentation

## Current Status:
Working on the Tasks API documentation. The complex status workflow needs clear examples and state diagrams.

## Blockers:
None currently, but need to coordinate with frontend team for UI screenshots.
```

### Waiting Task
```markdown
---
tags:
  - client
  - external
task:
  status:
    kind: waiting
    waiting_for: "Client approval on design mockups"
    expected_by: "2023-12-05T17:00:00+00:00"
    contact: "jane.doe@client.com"
    follow_up_at: "2023-12-03T10:00:00+00:00"
  progress: 75
  importance: 4
  urgency: 3
  scheduled_dates:
    - "2023-12-03"
---

# Homepage Redesign Implementation

Implement the new homepage design based on approved mockups.

## Current Status:
Development is 75% complete. All components are built and tested. Waiting for final client approval before deployment.

## Completed:
- [x] Header component with new navigation
- [x] Hero section with interactive elements
- [x] Feature cards with animations
- [x] Footer redesign
- [x] Mobile responsiveness
- [x] Performance optimization

## Pending Client Approval:
- Color scheme variations
- Typography adjustments
- Final content review

## Next Steps After Approval:
1. Make final adjustments based on feedback
2. Run complete QA testing
3. Deploy to staging environment
4. Schedule production deployment
```

### Completed Task
```markdown
---
tags:
  - infrastructure
  - devops
task:
  status:
    kind: done
    completed_at: "2023-11-30T16:45:00+00:00"
    completion_note: "Successfully deployed with zero downtime"
  progress: 100
  importance: 5
  urgency: 4
  start_at: "2023-11-27T09:00:00+00:00"
  due_by: "2023-11-30T17:00:00+00:00"
  deadline: "2023-11-30T23:59:59+00:00"
  scheduled_dates:
    - "2023-11-27"
    - "2023-11-28"
    - "2023-11-30"
---

# Database Migration to PostgreSQL 15

Migrate production database from PostgreSQL 13 to PostgreSQL 15.

## Completion Summary:
Successfully completed the database migration with zero downtime using blue-green deployment strategy.

## What Was Accomplished:
- [x] Performance testing on staging
- [x] Data backup and verification
- [x] Blue-green deployment setup
- [x] Migration scripts execution
- [x] Post-migration validation
- [x] Performance monitoring setup

## Results:
- **Downtime**: 0 minutes (seamless cutover)
- **Performance Improvement**: 15% faster queries on average
- **Data Integrity**: 100% verified
- **Rollback Plan**: Tested and ready (not needed)

## Lessons Learned:
1. Blue-green deployment was the right choice for zero downtime
2. Extensive testing paid off - no surprises during migration
3. Communication with stakeholders was crucial
4. Monitoring setup before migration helped identify improvements immediately

## Metrics After Migration:
- Query performance: +15% improvement
- Connection pooling: More efficient
- Backup time: -20% faster
- Index performance: Significant improvement on large tables
```

## Event Examples

### Single Meeting Event
```markdown
---
tags:
  - meeting
  - work
  - planning
events:
  sprint_planning:
    start: "2023-12-04T09:00:00+00:00"
    end: "2023-12-04T11:00:00+00:00"
    color: "#2196f3"
    note: "Sprint 15 planning session with entire development team"
---

# Sprint 15 Planning Meeting

Quarterly planning session for the next development sprint.

## Agenda:
1. **Sprint 14 Retrospective** (30 minutes)
   - What went well
   - What could be improved
   - Action items

2. **Sprint 15 Goal Setting** (45 minutes)
   - Review product backlog
   - Set sprint goal
   - Estimate story points

3. **Capacity Planning** (30 minutes)
   - Team availability
   - Holiday considerations
   - External dependencies

4. **Risk Assessment** (15 minutes)
   - Technical risks
   - Resource constraints
   - Timeline concerns

## Attendees:
- Development Team (5 people)
- Product Owner
- Scrum Master
- UX Designer

## Preparation:
- [ ] Review previous sprint metrics
- [ ] Update product backlog priorities
- [ ] Prepare velocity charts
- [ ] Check team calendar for conflicts
```

### Recurring Event Series
```markdown
---
tags:
  - meeting
  - recurring
  - health
events:
  daily_standup:
    end: "2023-12-31T23:59:59+00:00"
    color: "#4caf50"
    note: "Daily team synchronization meeting"
    times:
      - start: "2023-12-01T09:00:00+00:00"
        end: "2023-12-01T09:15:00+00:00"
      - start: "2023-12-04T09:00:00+00:00"
        end: "2023-12-04T09:15:00+00:00"
      - start: "2023-12-05T09:00:00+00:00"
        end: "2023-12-05T09:15:00+00:00"
      - start: "2023-12-06T09:00:00+00:00"
        end: "2023-12-06T09:15:00+00:00"
      - start: "2023-12-07T09:00:00+00:00"
        end: "2023-12-07T09:15:00+00:00"
      - start: "2023-12-08T09:00:00+00:00"
        end: "2023-12-08T09:15:00+00:00"
---

# Daily Standup Meetings

Regular team synchronization meetings held every weekday.

## Format:
Quick 15-minute standing meeting where each team member shares:
1. **Yesterday**: What I accomplished
2. **Today**: What I plan to work on
3. **Blockers**: Any impediments or help needed

## Guidelines:
- Keep updates brief and focused
- Save detailed discussions for after standup
- Be punctual and prepared
- Ask for help when needed

## Meeting Rotation:
- **Week 1**: Alice facilitates
- **Week 2**: Bob facilitates
- **Week 3**: Carol facilitates
- **Week 4**: David facilitates

## Success Metrics:
- Meeting duration ≤ 15 minutes
- All team members participate
- Blockers are identified and addressed
- Team coordination improves
```

### Personal Event with Multiple Time Zones
```markdown
---
tags:
  - personal
  - family
  - international
events:
  family_call:
    start: "2023-12-03T20:00:00+00:00"
    end: "2023-12-03T21:00:00+00:00"
    color: "#e91e63"
    note: "Monthly family video call across time zones"
  local_reminder:
    start: "2023-12-03T15:00:00-05:00"
    color: "#ff9800"
    note: "Same call in EST (my local time)"
---

# Monthly Family Video Call

Regular video call with family members across different time zones.

## Participants & Time Zones:
- **Me**: 3:00 PM EST (New York)
- **Mom & Dad**: 8:00 PM GMT (London)
- **Sister**: 9:00 PM CET (Berlin)
- **Brother**: 6:00 AM AEST (Sydney, next day)

## Typical Discussion Topics:
- Health and wellness updates
- Work and life changes
- Travel plans and adventures
- Family photos and memories
- Upcoming events and celebrations

## Technical Setup:
- **Platform**: Zoom (stable across time zones)
- **Backup**: WhatsApp video call
- **Screen sharing**: For photo sharing
- **Recording**: Optional, with everyone's consent

## Preparation:
- [ ] Send calendar invite 1 week ahead
- [ ] Test video/audio setup 30 minutes before
- [ ] Prepare photo updates or news to share
- [ ] Check internet connection stability
```

## Advanced Workflows

### Project Management Workflow
```markdown
---
tags:
  - project
  - workflow
  - management
task:
  status:
    kind: in_progress
  progress: 30
  importance: 5
  urgency: 4
  start_at: "2023-11-20T09:00:00+00:00"
  due_by: "2024-01-15T17:00:00+00:00"
  deadline: "2024-01-31T23:59:59+00:00"
  scheduled_dates:
    - "2023-12-01"
    - "2023-12-04"
    - "2023-12-08"
    - "2023-12-11"
    - "2023-12-15"
events:
  milestone_review:
    start: "2023-12-15T14:00:00+00:00"
    end: "2023-12-15T16:00:00+00:00"
    color: "#9c27b0"
    note: "Mid-project milestone review with stakeholders"
---

# Customer Portal Redesign Project

Complete redesign of the customer portal with modern UX/UI and improved performance.

## Project Overview:
A comprehensive 3-month project to redesign and rebuild the customer portal from scratch using modern technologies and improved user experience patterns.

## Phase 1: Discovery & Planning (COMPLETED)
- [x] User research and interviews
- [x] Competitive analysis
- [x] Technical architecture planning
- [x] Resource allocation
- [x] Timeline definition

## Phase 2: Design & Prototyping (IN PROGRESS)
- [x] Wireframe development
- [x] UI design system creation
- [ ] Interactive prototypes
- [ ] User testing and feedback
- [ ] Design refinement

## Phase 3: Development (PENDING)
- [ ] Frontend component library
- [ ] Backend API updates
- [ ] Database schema changes
- [ ] Integration testing
- [ ] Performance optimization

## Phase 4: Testing & Launch (PENDING)
- [ ] Quality assurance testing
- [ ] User acceptance testing
- [ ] Security audit
- [ ] Soft launch (beta users)
- [ ] Full production deployment

## Key Stakeholders:
- **Project Sponsor**: VP of Customer Experience
- **Product Owner**: Sarah Chen
- **Lead Designer**: Marcus Rodriguez
- **Lead Developer**: Jennifer Kim
- **QA Lead**: David Park

## Success Metrics:
- User satisfaction score: >4.5/5.0
- Page load time: <2 seconds
- Conversion rate: +25% improvement
- Support ticket reduction: -30%
- Mobile usage: +40% increase

## Risks & Mitigation:
1. **Scope Creep**: Weekly stakeholder reviews, strict change control
2. **Timeline Pressure**: Buffer time built in, agile methodology
3. **Technical Challenges**: POCs for complex features, expert consultation
4. **User Adoption**: Change management plan, training materials

## Communication Plan:
- **Daily**: Team standups
- **Weekly**: Stakeholder updates
- **Bi-weekly**: Executive reports
- **Monthly**: Board presentation
```

### Research and Documentation Workflow
```markdown
---
tags:
  - research
  - documentation
  - knowledge-base
task:
  status:
    kind: in_progress
  progress: 60
  importance: 4
  urgency: 2
  start_at: "2023-11-15T09:00:00+00:00"
  due_by: "2023-12-20T17:00:00+00:00"
  scheduled_dates:
    - "2023-11-15"
    - "2023-11-20"
    - "2023-11-27"
    - "2023-12-04"
    - "2023-12-11"
    - "2023-12-18"
---

# Machine Learning Best Practices Guide

Comprehensive guide documenting ML best practices, tools, and methodologies for the data science team.

## Research Areas Completed:
- [x] **Data Pipeline Architecture**
  - ETL vs ELT patterns
  - Real-time vs batch processing
  - Data quality frameworks
  - Monitoring and alerting

- [x] **Model Development Lifecycle**
  - Experiment tracking (MLflow, Weights & Biases)
  - Version control for models and data
  - Reproducibility requirements
  - Hyperparameter optimization strategies

- [x] **Model Evaluation & Validation**
  - Cross-validation strategies
  - Bias detection and mitigation
  - A/B testing frameworks
  - Model interpretability tools

## Research Areas In Progress:
- [ ] **Production Deployment**
  - Model serving architectures
  - Containerization strategies
  - Auto-scaling considerations
  - Blue-green deployment for ML

- [ ] **Monitoring & Maintenance**
  - Model drift detection
  - Performance degradation alerting
  - Automated retraining pipelines
  - Data quality monitoring

- [ ] **Ethics & Compliance**
  - Bias auditing procedures
  - Privacy preservation techniques
  - Regulatory compliance (GDPR, CCPA)
  - Responsible AI principles

## Documentation Structure:
1. **Introduction & Principles**
2. **Data Management**
   - Collection strategies
   - Storage solutions
   - Quality assurance
3. **Model Development**
   - Environment setup
   - Coding standards
   - Testing procedures
4. **Deployment & Operations**
   - Infrastructure requirements
   - Monitoring setup
   - Incident response
5. **Team Collaboration**
   - Code review processes
   - Knowledge sharing
   - Onboarding procedures

## Sources & References:
- Google's ML Engineering guide
- Uber's Michelangelo platform documentation
- Netflix's ML infrastructure papers
- Industry conference presentations
- Academic research papers

## Review Process:
- **Technical Review**: Data Science team leads
- **Business Review**: Product and Engineering VPs
- **Final Approval**: CTO and Head of Data Science

## Distribution Plan:
1. Internal wiki publication
2. Team training sessions
3. External blog post series
4. Conference presentation proposal
```

## API Usage Examples

### Authentication Flow
```bash
#!/bin/bash

# Store API base URL
API_BASE="http://localhost:3030"

# Login and get token
TOKEN=$(curl -s -X POST "${API_BASE}/login" \
  -H "Content-Type: application/json" \
  -d '{"user": "admin", "password": "mypassword"}')

echo "Token: $TOKEN"

# Use token for authenticated requests
AUTH_HEADER="Authorization: Bearer $TOKEN"
```

### Complete Note Management Workflow
```bash
#!/bin/bash

# Create a new note
NOTE_PATH="projects/$(date +%Y%m%d)-meeting-notes.md"
NOTE_CONTENT='---
tags:
  - meeting
  - project
---

# Project Kickoff Meeting

Initial meeting to discuss project requirements and timeline.

## Attendees:
- Project Manager
- Lead Developer
- Designer
- Client Representative

## Key Decisions:
- Technology stack: React + Node.js
- Timeline: 8 weeks
- Budget: $50,000
'

curl -X PUT "${API_BASE}/notes/${NOTE_PATH}" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"Save\": {\"content\": \"$NOTE_CONTENT\", \"message\": \"Add project kickoff notes\"}}"

# List all notes
echo "All notes:"
curl -H "$AUTH_HEADER" "${API_BASE}/notes" | jq '.[] | .path'

# Search for specific content
echo "Search results for 'project':"
curl -X POST "${API_BASE}/notes" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d '{"pattern": "project"}' | jq

# Get specific note
echo "Note content:"
curl -H "$AUTH_HEADER" "${API_BASE}/notes/${NOTE_PATH}"

# Rename note
NEW_PATH="meetings/2023-project-kickoff.md"
curl -X PUT "${API_BASE}/notes/${NEW_PATH}" \
  -H "$AUTH_HEADER" \
  -H "Content-Type: application/json" \
  -d "{\"Rename\": {\"from\": \"$NOTE_PATH\"}}"
```

### Task Management via API
```bash
#!/bin/bash

# Get all tasks in tree format
echo "Tasks (tree format):"
curl -H "$AUTH_HEADER" "${API_BASE}/v2/tasks?format=tree" | jq

# Get tasks with conditional GET (using ETag)
ETAG=$(curl -I -H "$AUTH_HEADER" "${API_BASE}/v2/tasks" | grep -i etag | cut -d' ' -f2)
echo "Current ETag: $ETAG"

# Subsequent request with If-None-Match
curl -H "$AUTH_HEADER" \
     -H "If-None-Match: $ETAG" \
     "${API_BASE}/v2/tasks"
# Returns 304 Not Modified if no changes

# Get specific task file
TASK_PATH=".tasks/complete-documentation-550e8400-e29b-41d4-a716-446655440000.md"
curl -H "$AUTH_HEADER" "${API_BASE}/v2/files/${TASK_PATH}"
```

### File Upload and Management
```bash
#!/bin/bash

# Upload an image file
IMAGE_UUID="550e8400-e29b-41d4-a716-446655440000"
curl -X POST "${API_BASE}/files" \
  -H "$AUTH_HEADER" \
  -F "${IMAGE_UUID}=@./screenshot.png"

# Get the uploaded file (will be optimized to WebP)
curl -H "$AUTH_HEADER" \
     -o "optimized-screenshot.webp" \
     "${API_BASE}/files/screenshot.png"

# Get file metadata only (HEAD request)
curl -I -H "$AUTH_HEADER" "${API_BASE}/v2/files/screenshot.png"
```

### Monitoring and Health Checks
```bash
#!/bin/bash

# Check current commit ID
COMMIT_ID=$(curl -H "$AUTH_HEADER" "${API_BASE}/v2/commits/head" | jq -r)
echo "Current repository state: $COMMIT_ID"

# Monitor for changes (simple polling script)
while true; do
  NEW_COMMIT=$(curl -s -H "$AUTH_HEADER" "${API_BASE}/v2/commits/head" | jq -r)
  if [ "$NEW_COMMIT" != "$COMMIT_ID" ]; then
    echo "Repository updated: $COMMIT_ID -> $NEW_COMMIT"
    COMMIT_ID=$NEW_COMMIT
    
    # Fetch updated data
    curl -H "$AUTH_HEADER" "${API_BASE}/notes" > /tmp/notes.json
    curl -H "$AUTH_HEADER" "${API_BASE}/v2/tasks" > /tmp/tasks.json
  fi
  
  sleep 30
done
```