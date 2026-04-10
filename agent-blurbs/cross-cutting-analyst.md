# Cross-Cutting Analyst

The Cross-Cutting Analyst looks across many component outputs to identify repo-wide patterns that are not visible from a single local scope. It searches for issues such as cyclic dependencies, inconsistent API conventions, duplicate domain models, shared utility abuse, hidden infrastructure coupling, and configuration sprawl. It should work primarily from worker summaries, dependency metadata, and targeted source references rather than rereading the whole repository.

This agent is responsible for synthesis, not rediscovery. It should promote only patterns that are supported by multiple component analyses or direct evidence and should clearly distinguish systemic findings from repeated local issues. Its output informs architecture-level reports and prioritization.
