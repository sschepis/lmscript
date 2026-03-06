# DSL Reference

[← Back to Index](./README.md)

---

## Table of Contents

1. [Overview](#overview)
2. [File Format](#file-format)
3. [Type Declarations](#type-declarations)
4. [LLM Function Declarations](#llm-function-declarations)
5. [String Literals](#string-literals)
6. [Template Variables](#template-variables)
7. [Comments](#comments)
8. [Compilation Pipeline](#compilation-pipeline)
9. [CLI Usage](#cli-usage)
10. [Programmatic Usage](#programmatic-usage)
11. [Grammar Reference](#grammar-reference)

---

## Overview

L-Script includes a domain-specific language (DSL) for declaring typed LLM functions in `.ls` files. The DSL compiles down to the same [`LScriptFunction`](../src/types.ts:55) objects used by the TypeScript API, so `.ls` files and TypeScript definitions are fully interchangeable at runtime.

The pipeline is:

```
.ls source → Lexer → Tokens → Parser → AST → Compiler → CompiledModule
```

---

## File Format

L-Script files use the `.ls` extension and contain two kinds of declarations:

1. **Type declarations** — Define output schemas (compiled to Zod schemas)
2. **LLM function declarations** — Define typed LLM functions (compiled to `LScriptFunction` objects)

### Example File

```ls
// security-review.ls

type Critique = {
  score: number(min=1, max=10),
  vulnerabilities: string[],
  suggested_fix: string
}

llm SecurityReviewer(code: string) -> Critique {
  model: "gpt-4o"
  temperature: 0.2

  system: "You are a senior security researcher. Be pedantic and skeptical."

  prompt:
    """
    Review the following function for security flaws:
    {{code}}
    """
}
```

---

## Type Declarations

Type declarations define the output schema for LLM functions. They compile to Zod schemas.

### Syntax

```
type <Name> = {
  <field_name>: <type>,
  ...
}
```

### Supported Field Types

| Type | DSL Syntax | Compiles To |
|---|---|---|
| String | `string` | `z.string()` |
| Number | `number` | `z.number()` |
| Boolean | `boolean` | `z.boolean()` |
| String array | `string[]` | `z.array(z.string())` |
| Number array | `number[]` | `z.array(z.number())` |
| Enum | `"a" \| "b" \| "c"` | `z.enum(["a", "b", "c"])` |
| Optional | `string?` | `z.string().optional()` |
| With default | `string = "val"` | `z.string().default("val")` |

### Constraints

Numeric and string types support constraints via parenthesized key-value pairs:

```ls
type Analysis = {
  score: number(min=1, max=10),
  summary: string(maxLength=200),
  description: string(minLength=10)
}
```

| Constraint | Applies To | Compiles To |
|---|---|---|
| `min=N` | `number` | `z.number().min(N)` |
| `max=N` | `number` | `z.number().max(N)` |
| `minLength=N` | `string` | `z.string().min(N)` |
| `maxLength=N` | `string` | `z.string().max(N)` |

### Enum Fields

Enum fields use pipe-separated string literals:

```ls
type Result = {
  sentiment: "positive" | "negative" | "neutral",
  priority: "low" | "medium" | "high" | "critical"
}
```

### Array Fields

Append `[]` to any type to make it an array:

```ls
type Report = {
  findings: string[],
  scores: number[],
  tags: string[]
}
```

### Optional Fields

Append `?` to a field name to make it optional. Optional fields compile to `.optional()` in Zod:

```ls
type UserProfile = {
  name: string,
  email: string,
  nickname: string?,         // Optional — may be omitted from output
  bio: string?               // Optional
}
```

Compiles to:

```typescript
z.object({
  name: z.string(),
  email: z.string(),
  nickname: z.string().optional(),
  bio: z.string().optional(),
})
```

### Default Values

Use `= value` after the type to set a default value. Fields with defaults compile to `.default(value)` in Zod:

```ls
type AnalysisConfig = {
  language: string = "en",        // Defaults to "en" if not provided
  max_items: number = 10,         // Defaults to 10
  include_details: boolean = true // Defaults to true
}
```

Compiles to:

```typescript
z.object({
  language: z.string().default("en"),
  max_items: z.number().default(10),
  include_details: z.boolean().default(true),
})
```

### Combining Optional and Default

You can combine optional markers with constraints:

```ls
type Report = {
  title: string,
  summary: string?,                        // Optional, no default
  score: number(min=0, max=100) = 50,      // Default 50, constrained
  tags: string[] = [],                      // Default empty array
  priority: "low" | "medium" | "high" = "medium"  // Enum with default
}
```

### Commas

Commas between fields are optional but recommended for readability.

---

## LLM Function Declarations

LLM function declarations define typed LLM calls that compile to [`LScriptFunction`](../src/types.ts:55) objects.

### Syntax

```
llm <FunctionName>(<param>: <type>, ...) -> <ReturnType> {
  model: "<model-id>"
  temperature: <number>
  system: "<system prompt>"
  prompt:
    """
    <prompt template with {{param}} variables>
    """
}
```

### Body Fields

| Field | Required | Type | Description |
|---|---|---|---|
| `model` | No | String | Model identifier (default: `"gpt-4o"`) |
| `temperature` | No | Number | Sampling temperature (default: runtime default) |
| `system` | No | String | System prompt |
| `prompt` | No | String | Prompt template (can use `{{param}}` variables) |

### Parameters

Functions declare their parameters in the signature. Each parameter has a name and a type:

```ls
llm Translator(text: string) -> Translation { ... }
llm Reviewer(code: string, language: string) -> Review { ... }
```

**Note**: The current compiler treats all parameters as `string` at runtime. Multi-parameter functions receive the single input string and replace all `{{paramName}}` occurrences.

### Return Type

The return type must reference a previously declared `type`. If the type is not found, the compiler throws a [`CompileError`](../src/dsl/compiler.ts:14).

```ls
type MyOutput = { ... }

// ✓ Valid — MyOutput is declared above
llm MyFunc(input: string) -> MyOutput { ... }

// ✗ Error — UnknownType is not declared
llm BadFunc(input: string) -> UnknownType { ... }
```

---

## String Literals

### Single-Line Strings

```ls
system: "You are a helpful assistant."
model: "gpt-4o"
```

Escape sequences: `\"`, `\\`, `\n`, `\t`

### Triple-Quoted Strings

For multi-line content, use triple-quoted strings (`"""`):

```ls
prompt:
  """
  Review the following code for security vulnerabilities:
  {{code}}

  Focus on:
  - Input validation
  - SQL injection
  - Authentication bypass
  """
```

Triple-quoted strings:
- **Auto-dedent**: Common leading whitespace is automatically removed
- **Trim boundaries**: Leading newline after opening `"""` and trailing newline before closing `"""` are stripped
- Support multi-line content without escape sequences

---

## Template Variables

Use `{{variableName}}` syntax inside prompts to reference function parameters:

```ls
llm Summarize(text: string) -> Summary {
  prompt:
    """
    Summarize the following text in 3 sentences:
    {{text}}
    """
}
```

At runtime, `{{text}}` is replaced with the actual input value when [`fn.prompt(input)`](../src/types.ts:66) is called.

---

## Comments

Single-line comments start with `//`:

```ls
// This is a comment
type Critique = {
  score: number(min=1, max=10),  // Inline comments are fine too
}
```

Comments are tokenized as `COMMENT` tokens but filtered out during parsing.

---

## Compilation Pipeline

The DSL compilation happens in four stages:

### 1. Lexer ([`Lexer`](../src/dsl/lexer.ts:56))

Converts source text to a stream of [`Token`](../src/dsl/lexer.ts:33) objects. Token types include:

| Token Type | Examples |
|---|---|
| `TYPE`, `LLM` | Keywords |
| `IDENTIFIER` | `Critique`, `score`, `string` |
| `STRING` | `"gpt-4o"` |
| `TRIPLE_STRING` | `"""..."""` |
| `NUMBER` | `0.2`, `10` |
| `TEMPLATE_VAR` | `{{code}}` |
| `LBRACE`, `RBRACE`, `COLON`, etc. | Symbols |
| `QUESTION` | `?` (optional field marker) |
| `EQUALS` | `=` (default value / type assignment) |
| `ARROW` | `->` |
| `PIPE` | `\|` |
| `COMMENT` | `// ...` |

Throws [`LexerError`](../src/dsl/lexer.ts:45) with line/column information on invalid input.

### 2. Parser ([`Parser`](../src/dsl/parser.ts:23))

Converts tokens to an AST ([`Program`](../src/dsl/ast.ts:33)) containing:

- [`TypeDeclarationNode`](../src/dsl/ast.ts:11) — Type definitions with fields, types, constraints, enums
- [`LLMFunctionNode`](../src/dsl/ast.ts:17) — Function definitions with parameters, return type, body

Throws [`ParseError`](../src/dsl/parser.ts:12) with line/column information on syntax errors.

### 3. Compiler ([`compile()`](../src/dsl/compiler.ts:24))

Two-pass compilation:

1. **Pass 1**: Compile all type declarations to Zod schemas
2. **Pass 2**: Compile all LLM functions (resolving return types from the type map)

Throws [`CompileError`](../src/dsl/compiler.ts:14) when a function references an undefined type.

### 4. CompiledModule ([`CompiledModule`](../src/dsl/compiler.ts:9))

The output is a `CompiledModule` with:

```typescript
interface CompiledModule {
  types: Map<string, z.ZodType>;                              // Type name → Zod schema
  functions: Map<string, LScriptFunction<string, z.ZodType>>; // Function name → LScriptFunction
}
```

---

## CLI Usage

The [`lsc`](../src/cli.ts:1) command-line tool provides four commands for working with `.ls` files:

### `lsc parse <file.ls>`

Parse a `.ls` file and display discovered types and functions:

```bash
npm run cli:parse -- examples/security-review.ls
```

Output:
```
📋 Parsed L-Script file "examples/security-review.ls"

Types (2):
  📦 Critique
     Schema: { "type": "object", ... }
  📦 Analysis
     Schema: { "type": "object", ... }

Functions (2):
  ⚡ SecurityReviewer
     Model:       gpt-4o
     System:      You are a senior security researcher...
     Temperature: 0.2
  ⚡ AnalyzeFeedback
     Model:       gpt-4o
     System:      You are a Senior Product Manager.
     Temperature: 0.3
```

### `lsc compile <file>`

Dry-run compilation of a TypeScript module showing execution manifest:

```bash
npm run cli:compile -- src/examples/security-reviewer.ts
```

### `lsc list <file>`

List all exported `LScriptFunction` names in a TypeScript module:

```bash
npm run cli:list -- src/examples/security-reviewer.ts
```

### `lsc validate <file>`

Validate that all exported functions have well-formed Zod schemas:

```bash
npm run cli:validate -- src/examples/security-reviewer.ts
```

---

## Programmatic Usage

### Compiling from Source String

```typescript
import { compileFile } from "lmscript";

const source = `
type Greeting = {
  message: string,
  language: string
}

llm Greeter(name: string) -> Greeting {
  model: "gpt-4o"
  system: "You are a friendly greeter."
  prompt: "Greet {{name}} warmly."
}
`;

const module = compileFile(source);

// Access compiled types
const greetingSchema = module.types.get("Greeting"); // z.ZodType

// Access compiled functions
const greeterFn = module.functions.get("Greeter");   // LScriptFunction

// Execute the compiled function
const result = await runtime.execute(greeterFn!, "Alice");
console.log(result.data); // { message: "...", language: "..." }
```

### Step-by-Step Compilation

For advanced use cases, you can use the individual stages:

```typescript
import { Lexer, Parser, compile } from "lmscript";

// Step 1: Tokenize
const lexer = new Lexer(source);
const tokens = lexer.tokenize();

// Step 2: Parse
const parser = new Parser(tokens);
const ast = parser.parse();

// Step 3: Compile
const module = compile(ast);
```

---

## Grammar Reference

### Formal Grammar (EBNF-style)

```
program        = { type_decl | llm_decl } ;

type_decl      = "type" IDENTIFIER "=" "{" { type_field [","] } "}" ;
type_field     = IDENTIFIER ["?"] ":" ( enum_type | base_type [constraints] ["[" "]"] ) ["=" default_val] ;
enum_type      = STRING { "|" STRING } ;
base_type      = IDENTIFIER ;
default_val    = STRING | NUMBER | "true" | "false" | "[" "]" ;
constraints    = "(" constraint { "," constraint } ")" ;
constraint     = IDENTIFIER "=" ( NUMBER | STRING ) ;

llm_decl       = "llm" IDENTIFIER "(" params ")" "->" IDENTIFIER "{" llm_body "}" ;
params         = [ param { "," param } ] ;
param          = IDENTIFIER ":" IDENTIFIER ;
llm_body       = { body_key ":" body_value } ;
body_key       = "model" | "temperature" | "system" | "prompt" | "output" ;
body_value     = STRING | TRIPLE_STRING | NUMBER | IDENTIFIER ;

STRING         = '"' { char } '"' ;
TRIPLE_STRING  = '"""' { char } '"""' ;
NUMBER         = ["-"] digit { digit } ["." digit { digit }] ;
IDENTIFIER     = (letter | "_") { letter | digit | "_" } ;
COMMENT        = "//" { char } newline ;
TEMPLATE_VAR   = "{{" IDENTIFIER "}}" ;
```

---

## Next Steps

- [User Guide](./user-guide.md) — Core concepts and TypeScript API
- [API Reference](./api-reference.md) — Complete API documentation
- [Examples](./examples.md) — Annotated code examples
