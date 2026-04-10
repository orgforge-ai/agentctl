# Indexer

The Indexer builds the initial structural map of the repository. It derives candidate components, path ownership boundaries, language and build metadata, dependency edges, public entrypoints, and other signals that help the orchestrator partition work. In some implementations this may be a preprocessing stage rather than a conversational agent, but the role is still distinct.

This agent should optimize for breadth and structural correctness rather than deep understanding. Its output is the substrate for scheduling, overlap control, and hotspot detection. A weak Indexer produces bad task boundaries, so it should focus on making the repo explorable and decomposable at scale.
