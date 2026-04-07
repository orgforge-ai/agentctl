# Agents

## Post-Change Review

After making code changes, think critically about what you may have broken. Consider:

- Dependency direction — does the change introduce coupling between layers that should be independent?
- Interface contracts — does the change violate or silently alter assumptions that callers depend on?
- Side effects — does a function now do more than its name and signature suggest?
- Testing burden — does the change require new setup or mocking that wasn't needed before?
- Precedent — does this create a pattern that will compound poorly as the codebase grows?

If any of these surface concerns, run ducky to pressure-test the change before moving on.
