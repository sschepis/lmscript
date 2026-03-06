# L-Script (lmscript) Documentation

**A Typed Runtime for LLM Orchestration**

> *"We are not writing text; we are defining the topology of a thought process."*

---

## Documentation Index

| Document | Description |
|---|---|
| [Getting Started](./getting-started.md) | Installation, prerequisites, and your first LLM function |
| [User Guide](./user-guide.md) | Comprehensive walkthrough of core concepts and features |
| [Providers](./providers.md) | Configuring OpenAI, Anthropic, Gemini, Ollama, LM Studio, routers, and fallbacks |
| [Middleware & Pipelines](./middleware-and-pipelines.md) | Lifecycle hooks, multi-step pipelines, and output transformers |
| [DSL Reference](./dsl-reference.md) | L-Script `.ls` file syntax, grammar, and compilation |
| [Testing](./testing.md) | Mock providers, schema diffs, prompt snapshots, chaos/fuzz testing |
| [API Reference](./api-reference.md) | Complete TypeScript API: every class, interface, function, and type |
| [Examples](./examples.md) | Annotated code examples covering common use cases |
| [Advanced Topics](./advanced.md) | Parallel execution, sessions, cost tracking, caching, logging, budget enforcement |
| [New Features (v2)](./new-features.md) | Rate limiting, agent loops, RAG pipelines, multi-modal, telemetry, and more |

---

## What is L-Script?

L-Script treats LLMs as **typed, non-deterministic processors** that require formal interfaces. Instead of ad-hoc string prompting, you define **typed functions** with [Zod](https://zod.dev/) schemas that compile to structured API calls with automatic validation, retry logic, and provider abstraction.

### Three Pillars

| Pillar | What It Does |
|---|---|
| **Schema Enforcement** | Every LLM call validates output against a Zod schema. If the model drifts, the runtime catches it and retries. |
| **Context Management** | [`ContextStack`](../src/context.ts) manages conversation history with automatic FIFO or summarization pruning at token limits. |
| **Model Agnosticism** | Write logic once; swap providers (OpenAI, Anthropic, Gemini, Ollama, LM Studio) without changing function definitions. |

### Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        L-Script DSL                          │
│              .ls files → Lexer → Parser → AST                │
└──────────────────────┬───────────────────────────────────────┘
                       │ compile()
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                   LScriptFunction<I, O>                      │
│         name · model · system · prompt · schema              │
│         examples · tools · temperature · maxRetries          │
└──────────────────────┬───────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │ Pipeline │ │ Session  │ │ Parallel │
    │ .pipe()  │ │ .send()  │ │ execAll  │
    └────┬─────┘ └────┬─────┘ └────┬─────┘
         └────────────┬────────────┘
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                     LScriptRuntime                           │
│  middleware → cache → cost tracking → logger → validation    │
└──────────────────────┬───────────────────────────────────────┘
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
        ┌──────────┐ ┌─────┐ ┌──────────┐
        │  Router  │ │ FB  │ │  Direct  │
        │(pattern) │ │Chain│ │ Provider │
        └────┬─────┘ └──┬──┘ └────┬─────┘
             └───────────┼────────┘
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                      LLM Providers                           │
│   OpenAI · Anthropic · Gemini · Ollama · LM Studio · Mock   │
└──────────────────────────────────────────────────────────────┘
```

---

## Quick Links

- **GitHub**: [github.com/sschepis/lmscript](https://github.com/sschepis/lmscript)
- **npm**: `npm install lmscript`
- **License**: MIT
- **Node.js**: ≥ 18.0.0
