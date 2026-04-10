# Design Doc: Hierarchical Multi-Agent System for Large-Scale Codebase Documentation and Review

## Overview

This document describes a generic multi-agent system for analyzing, documenting, and reviewing very large repositories that cannot be handled effectively within a single context window. The target environment is a large monorepo or multi-service repository, potentially containing millions of lines of code, inconsistent documentation, architectural drift, and widespread code quality issues.

The system uses a hierarchical design. A top-level orchestrator manages work decomposition, coverage, reconciliation, and escalation. A lower layer of workers performs isolated component analysis, documentation generation, and review. The core design goal is to make large-scale repository understanding tractable by enforcing bounded scope, structured outputs, and controlled synthesis.

## Problem Statement

Large repositories create several problems for agent-based analysis:

- The full codebase cannot fit in a single context window.
- Documentation is often partial, stale, or contradictory.
- Architectural issues are distributed across many components.
- Workers that roam freely through the repo duplicate effort and waste context.
- Free-form outputs do not merge cleanly across many agents.
- Broad judgments about "bad design" are unreliable without explicit evidence and validation.

A useful system must therefore decompose the repo into manageable units, assign workers narrow tasks, collect outputs in a machine-mergeable form, and synthesize repo-wide conclusions only after component-level evidence has been gathered.

## Goals

The system should:

- Generate updated technical context for large repositories.
- Produce or refresh component-level documentation.
- Identify code quality, API design, and architectural issues.
- Scale across many isolated work units in parallel.
- Minimize duplicated analysis across agents.
- Merge local findings into trustworthy global outputs.
- Track uncertainty, coverage, and contradictions explicitly.

## Non-Goals

The system is not intended to:

- Fully redesign the entire codebase in a single pass.
- Produce perfect architectural truth from one agent's opinion.
- Let every worker directly modify canonical documentation without review.
- Replace human technical leadership for major architectural decisions.
- Eliminate all ambiguity in systems with poor boundaries or weak ownership.

## Design Principles

### 1. Bound Scope Aggressively

Workers should operate on clearly defined components, not the whole repository. Broad exploration leads to wasted context and overlapping work.

### 2. Separate Facts from Judgments

The system must distinguish observed code facts from inferred conclusions, risks, and recommendations.

### 3. Require Structured Outputs

Outputs must be machine-readable and mergeable. Free-form summaries do not scale across dozens or hundreds of workers.

### 4. Treat Critique as Evidence-Backed

Claims about poor design, bad APIs, or architectural problems must be grounded in file-level or symbol-level evidence.

### 5. Validate High-Severity Findings

Important findings should not be accepted into the global report based on a single worker pass.

### 6. Synthesize Globally Only After Analyzing Locally

Repo-wide conclusions should emerge from multiple component analyses and targeted reconciliation, not from initial speculation.

## High-Level Architecture

The system uses a two-layer architecture with role specialization in the worker layer.

### Layer 1: Orchestrator

The orchestrator is the control plane. It should do minimal deep source reading. Its job is to:

- partition the repository into work units
- build and maintain a component graph
- assign work to workers
- track progress, confidence, and coverage
- prevent overlapping exploration
- merge structured outputs
- detect contradictions and missing areas
- trigger follow-up passes
- escalate cross-cutting issues for validation

The orchestrator should treat worker outputs as evidence packets, not truth.

### Layer 2: Workers

Workers operate on bounded scopes. They may be implemented as separate prompt templates or role modes.

Recommended worker roles:

- `Mapper`
- `Doc Writer`
- `Reviewer`
- `Validator`

A single runtime may reuse the same underlying model for these roles, but the prompts and output contracts should remain distinct.

## Why Components Are the Unit of Work

Directories are often poor proxies for real architecture. A better unit of work is a component defined by one or more of:

- package or module
- service
- deployable artifact
- build target
- API surface
- bounded domain area
- ownership boundary

The orchestrator should construct a component graph before assigning deeper analysis. Each component record should include:

- component id
- primary paths
- language and build system
- public entrypoints
- upstream dependencies
- downstream dependents
- test locations
- config locations
- candidate owners if available

This graph becomes the scheduling substrate for all worker tasks.

## Worker Roles

### 1. Mapper

The mapper is responsible for factual component understanding.

Outputs include:

- summary of responsibilities
- important entrypoints
- key types and interfaces
- runtime dependencies
- data flow
- configuration and operational concerns
- known gaps in existing docs
- confidence score
- open questions

The mapper should avoid broad evaluative claims unless the evidence is unusually strong.

### 2. Doc Writer

The doc writer converts mapped component understanding into human-facing documentation.

Responsibilities include:

- generating new component docs
- updating outdated docs
- standardizing terminology
- making implicit behavior explicit
- preserving uncertainty where behavior is not fully verified

The doc writer should not invent behavior that is not supported by mapper evidence.

### 3. Reviewer

The reviewer inspects a component for quality and design issues.

Review categories include:

- poor API boundaries
- dependency direction violations
- side effects hidden behind weak interfaces
- inconsistent error handling
- poor naming or abstraction boundaries
- testing gaps
- layering violations
- high coupling
- duplicated domain concepts
- unclear ownership or configuration sprawl

The reviewer must cite concrete evidence for each finding.

### 4. Validator

The validator confirms or rejects proposed findings, especially medium- and high-severity issues.

Responsibilities include:

- checking whether cited evidence supports the conclusion
- rejecting vague or weakly supported claims
- confirming severity where justified
- identifying cases where a finding depends on broader repo context not yet established

This role reduces false positives and overconfident critique.

## Control Plane Workflow

### Phase 1: Discovery

The orchestrator performs an initial indexing pass to derive the component graph.

Typical outputs:

- repository inventory
- component list
- dependency graph
- hotspot indicators
- likely documentation coverage map
- likely risk areas

Hotspots may be estimated using:

- size
- dependency centrality
- churn
- sparse testing
- absence of docs
- concentration of public interfaces

### Phase 2: Mapping

The orchestrator assigns mapper tasks to workers on isolated components or tightly coupled component clusters.

Each worker produces a structured component context packet.

### Phase 3: Documentation

The orchestrator schedules doc-writing tasks from mapper outputs. Documentation may be written to staging artifacts first rather than directly to canonical documentation locations.

### Phase 4: Review

Reviewer workers inspect components for bad practices, poor API design, and architectural risks. Findings are emitted in a structured schema.

### Phase 5: Validation

Validator workers confirm or reject significant findings. Low-value or weakly supported claims are discarded.

### Phase 6: Reconciliation

The orchestrator merges all component outputs into:

- component docs
- a repository architecture map
- a consolidated issue report
- a list of unresolved questions
- a coverage report

### Phase 7: Gap and Conflict Resolution

The orchestrator identifies:

- unreviewed components
- low-confidence outputs
- contradictory statements
- duplicated findings
- repo-wide patterns that need a targeted pass

Follow-up work is then scheduled as needed.

## Cross-Cutting Analysis

Some important problems are only visible once many component outputs are merged. Examples:

- cyclic dependencies
- inconsistent API conventions
- shared utility abuse
- duplicate domain models
- repeated error-handling anti-patterns
- hidden infrastructure coupling
- configuration sprawl

These should be handled in a dedicated cross-cutting analysis pass.

The cross-cutting analyst should consume:

- worker summaries
- dependency graph metadata
- selected source references only where needed

It should not reread the entire codebase. Its purpose is synthesis, not rediscovery.

## Output Schema

Workers should not return free-form prose only. A structured artifact is required.

Example:

```json
{
  "component_id": "billing/invoicing",
  "summary": "Handles invoice generation and invoice state transitions.",
  "responsibilities": [
    "Generate invoices from billing events",
    "Persist invoice lifecycle state",
    "Expose invoice query interfaces"
  ],
  "entrypoints": [
    "src/billing/invoicing/service.ts",
    "src/billing/invoicing/api.ts"
  ],
  "key_types_and_interfaces": [
    "InvoiceService",
    "InvoiceRepository",
    "Invoice"
  ],
  "runtime_dependencies": [
    "billing/events",
    "shared/db",
    "shared/logging"
  ],
  "data_flow": [
    "Billing events enter InvoiceService",
    "InvoiceRepository persists invoice state",
    "API layer exposes query results"
  ],
  "configuration": [
    "Uses DB connection from shared/db config",
    "Reads invoice retention settings from billing config"
  ],
  "operational_notes": [
    "Invoice generation is synchronous in request path"
  ],
  "known_gaps_in_docs": [
    "No current doc describes invoice state transitions"
  ],
  "design_issues": [
    {
      "severity": "high",
      "title": "Domain service directly depends on infrastructure repository implementation",
      "evidence": [
        "src/billing/invoicing/service.ts:InvoiceService",
        "src/shared/db/invoiceRepository.ts:SqlInvoiceRepository"
      ],
      "impact": "Tighter persistence coupling and harder isolation in tests",
      "recommendation": "Depend on a repository interface defined at the domain boundary"
    }
  ],
  "api_issues": [],
  "bad_practices": [],
  "open_questions": [
    "Is synchronous invoice generation required for correctness, or can it be deferred?"
  ],
  "confidence": 0.81
}
```

## Fact vs Inference Model

Every significant claim should be categorized as one of:

- `fact`
- `inference`
- `risk`
- `recommendation`

Example:

- Fact: `BillingService` imports `SqlInvoiceRepository`.
- Inference: the domain layer depends directly on infrastructure.
- Risk: the component is harder to test and more tightly coupled to persistence.
- Recommendation: introduce a domain-owned repository interface.

This model is important because it prevents the system from collapsing code observation and architectural judgment into one blurry statement.

## Task Contract

Every worker task should include:

- task id
- component id
- scope paths
- allowed adjacent reads
- role
- output schema
- time or token budget
- explicit non-goals
- escalation conditions

Example non-goals:

- do not redesign the entire subsystem
- do not inspect unrelated components
- do not infer runtime behavior without code evidence
- do not change canonical docs directly

This keeps workers focused and comparable.

## Scheduling Strategy

The orchestrator should schedule work based on component graph properties and risk prioritization.

Useful prioritization factors:

- public API exposure
- centrality in dependency graph
- missing or stale docs
- historical churn
- weak or missing tests
- large size
- frequent cross-component dependencies

A practical strategy is:

1. map the entire repo shallowly
2. prioritize hotspot components
3. document and review those first
4. expand outward to lower-risk areas

## Isolation and Overlap Rules

To prevent duplicated effort:

- each component should have a unique task owner at a time
- workers may inspect adjacent interfaces only when required
- cross-component reading should be logged explicitly
- overlapping assignments should be reserved for validation or conflict resolution only

The orchestrator should track adjacency reads because they often reveal hidden coupling and can later inform graph correction.

## Confidence and Uncertainty

Every worker output should include a confidence score and unresolved questions.

Confidence should be reduced when:

- entrypoints are ambiguous
- runtime behavior is hidden behind dynamic dispatch or reflection
- build system relationships are unclear
- code contradicts docs
- ownership boundaries are weak
- tests are sparse or misleading

Low-confidence outputs should trigger follow-up work rather than being silently merged as truth.

## Documentation Strategy

Documentation should be generated in layers.

Recommended output categories:

- component overview docs
- API docs
- operational notes
- architecture summaries
- issue reports
- open-question ledgers

Component docs should be generated first. Cross-component architecture docs should be synthesized later from validated component outputs.

Direct writes to canonical docs should be gated. A safe pattern is:

- worker writes structured draft
- orchestrator or doc synthesis pass transforms it
- reviewed output is committed into canonical docs

## Review Strategy

Because the repository may contain many bad practices, review must be disciplined or the system will generate noise.

Review findings should:

- reference files and symbols
- state impact, not just opinion
- distinguish local issues from systemic patterns
- avoid inflated severity without validation
- avoid repo-wide claims from component-local evidence alone

A single worker can propose severe findings, but the system should require a validation pass before accepting them into the consolidated architecture report.

## Failure Modes

The system should explicitly guard against these common failures:

### 1. Unbounded Wandering

Workers consume context exploring the repo instead of analyzing assigned scope.

Mitigation:

- strict scope contracts
- allowed adjacency rules
- token/time budgets

### 2. Duplicated Effort

Multiple workers rediscover the same component behavior.

Mitigation:

- component ownership registry
- orchestrator-managed scheduling
- structured intermediate memory

### 3. Overconfident Criticism

Workers label patterns as "bad architecture" without enough evidence.

Mitigation:

- fact/inference/risk separation
- validator role
- severity gating

### 4. Poor Merges

Outputs use inconsistent terms or schemas.

Mitigation:

- strict output format
- normalized terminology dictionary
- reconciliation pass

### 5. Premature Global Conclusions

The orchestrator extrapolates too much from a few components.

Mitigation:

- defer cross-cutting analysis until sufficient coverage exists
- require multi-component evidence for systemic claims

## Generic System Prompt Guidance

### Orchestrator Prompt

```text
You are a repository analysis orchestrator for very large codebases.

Your responsibilities are to decompose the repository into bounded components, assign isolated analysis tasks, track coverage, merge structured outputs, detect conflicts, and schedule follow-up passes.

Do not perform deep source analysis unless required to resolve contradictions or clarify task boundaries.

Treat worker outputs as evidence packets, not truth. Separate factual component mapping from evaluative review. Require citations, explicit uncertainty, and confidence scores. Prefer narrow, non-overlapping scopes.

Escalate cross-cutting issues only when supported by multiple component analyses or direct evidence.
```

### Worker Prompt

```text
You are a component analysis worker.

You are assigned a bounded scope and must stay within it unless reading adjacent interfaces is necessary to understand the component.

Your goals are:
1. identify the component's responsibilities and interfaces
2. summarize behavior and dependencies
3. identify documentation gaps
4. identify concrete code quality, API design, and architectural issues

Distinguish fact from inference from risk. Cite file paths and symbols for all material claims. Do not speculate beyond the evidence. Return structured output in the required schema.
```

### Validator Prompt

```text
You validate proposed findings from component workers.

Your task is to confirm or reject specific claims using code evidence. Do not rediscover the entire component unless necessary. Be conservative. Reject findings that are vague, weakly evidenced, or dependent on assumptions not established by the assigned scope.
```

## Recommended Operational Model

Although this is described as a two-layer system, the worker layer should include multiple specialized roles. The most practical deployment pattern is:

- Layer 1: orchestrator
- Layer 2: mappers, doc writers, reviewers, validators

This preserves a simple hierarchy while avoiding the failure mode of using one generic worker prompt for every task.

## Recommended Initial Implementation

For a first version, keep the system simple:

1. Build a component indexer and graph.
2. Define a strict worker output schema.
3. Implement mapper tasks first.
4. Add doc writer tasks from mapper outputs.
5. Add reviewer tasks.
6. Add validator tasks only for medium- and high-severity findings.
7. Add a reconciliation pass for cross-cutting analysis.

This sequencing reduces complexity while preserving the core scaling properties of the design.

## Conclusion

A large-scale repository cannot be documented and reviewed effectively by a single agent or by a loose swarm of unconstrained subagents. The system must operate as a managed analysis pipeline.

The orchestrator should decompose, schedule, track, reconcile, and escalate. Workers should operate on bounded components with strict output contracts. Facts, judgments, and recommendations must remain separated. High-severity findings should be validated before being accepted. Cross-cutting architecture conclusions should be synthesized only after sufficient local evidence has been collected.

That combination gives you a scalable foundation for repo-wide documentation refresh, code review, and architectural assessment without depending on a single context window.
