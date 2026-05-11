# FT Knowledge Base

Place `.md` or `.txt` files here to give the FT Generator Agent additional context
before it generates tests. These files are automatically read and included in the
LLM prompt.

## How it works

1. Drop files in this directory
2. The Generator Agent reads them before generating each test
3. Content is included in the prompt as "Knowledge Base" section

## Suggested files to add

### p0-p1-use-cases.md
Copy the P0/P1 workflow use cases from Confluence:
https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2823014029

Format:
```markdown
## Manage Address Workflow
### P0 Cases
- User can view their address list
- User can add a new address
- User can edit existing address
- User can delete an address

### P1 Cases
- Validation errors shown for invalid input
- Address type selection works (home/business)
```

### test-guidelines.md
Any team-specific test writing guidelines, naming conventions, or patterns.

### workflow-patterns.md
Common workflow patterns (step sequences, expected states) for the test generator to follow.

## Note
- Files are capped at 15,000 characters each
- Only `.md` and `.txt` files are read
- This directory is gitignored (your content stays local)
