// ── DSL Enhancements Tests — Optional Fields, Default Values ────────
import { describe, it, expect } from "vitest";
import { Lexer, TokenType } from "../src/dsl/lexer.js";
import { Parser } from "../src/dsl/parser.js";
import { compile, compileFile } from "../src/dsl/compiler.js";
import type { TypeFieldNode, TypeDeclarationNode, Program } from "../src/dsl/ast.js";
import { z } from "zod";

// ── Helper: lex + parse a type declaration ──────────────────────────

function parseTypeSource(source: string): TypeDeclarationNode {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const decl = program.declarations[0];
  if (!decl || decl.kind !== "TypeDeclaration") {
    throw new Error("Expected a TypeDeclaration");
  }
  return decl;
}

function lexTokens(source: string) {
  return new Lexer(source).tokenize();
}

// ═══════════════════════════════════════════════════════════════════
// LEXER TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Lexer — DSL enhancements", () => {
  it("tokenizes ? as QUESTION token", () => {
    const tokens = lexTokens("?");
    expect(tokens[0].type).toBe(TokenType.QUESTION);
    expect(tokens[0].value).toBe("?");
  });

  it("tokenizes = as EQUALS token", () => {
    const tokens = lexTokens("=");
    expect(tokens[0].type).toBe(TokenType.EQUALS);
    expect(tokens[0].value).toBe("=");
  });

  it("tokenizes field with ? suffix correctly (e.g., name? : string)", () => {
    // In the DSL, the ? comes after the field name, before the colon
    const tokens = lexTokens("name? : string");
    const types = tokens.map((t) => t.type);
    expect(types).toContain(TokenType.IDENTIFIER);   // name
    expect(types).toContain(TokenType.QUESTION);      // ?
    expect(types).toContain(TokenType.COLON);          // :
    // "string" is an identifier
    expect(types.filter((t) => t === TokenType.IDENTIFIER).length).toBe(2);
  });

  it("tokenizes field with default value (e.g., name : string = \"hello\")", () => {
    const tokens = lexTokens('name : string = "hello"');
    const types = tokens.map((t) => t.type);
    expect(types).toContain(TokenType.IDENTIFIER);   // name, string
    expect(types).toContain(TokenType.COLON);          // :
    expect(types).toContain(TokenType.EQUALS);         // =
    expect(types).toContain(TokenType.STRING);         // "hello"
  });

  it("tokenizes QUESTION and EQUALS in a full type block", () => {
    const source = `type Foo = {
      bar? : string
      baz : number = 42
    }`;
    const tokens = lexTokens(source);
    const types = tokens.map((t) => t.type);
    expect(types).toContain(TokenType.QUESTION);
    expect(types).toContain(TokenType.EQUALS);
    // Two EQUALS: one for `type Foo =` and one for `= 42`
    expect(types.filter((t) => t === TokenType.EQUALS).length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PARSER TESTS — Optional Fields
// ═══════════════════════════════════════════════════════════════════

describe("Parser — optional fields", () => {
  it("parses field_name? : string as optional field", () => {
    const decl = parseTypeSource(`type T = { name? : string }`);
    expect(decl.fields).toHaveLength(1);
    expect(decl.fields[0].name).toBe("name");
    expect(decl.fields[0].type).toBe("string");
    expect(decl.fields[0].optional).toBe(true);
  });

  it("parses field_name? : number — optional works with number type", () => {
    const decl = parseTypeSource(`type T = { count? : number }`);
    expect(decl.fields[0].optional).toBe(true);
    expect(decl.fields[0].type).toBe("number");
  });

  it("parses non-optional field — optional is falsy", () => {
    const decl = parseTypeSource(`type T = { name : string }`);
    expect(decl.fields[0].optional).toBeFalsy();
  });

  it("parses multiple fields — mix of optional and required", () => {
    const decl = parseTypeSource(`type T = {
      required_field : string
      optional_field? : number
      another_required : boolean
    }`);
    expect(decl.fields).toHaveLength(3);
    expect(decl.fields[0].name).toBe("required_field");
    expect(decl.fields[0].optional).toBeFalsy();
    expect(decl.fields[1].name).toBe("optional_field");
    expect(decl.fields[1].optional).toBe(true);
    expect(decl.fields[2].name).toBe("another_required");
    expect(decl.fields[2].optional).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════
// PARSER TESTS — Default Values
// ═══════════════════════════════════════════════════════════════════

describe("Parser — default values", () => {
  it("parses field_name : string = \"default\" — captures string default", () => {
    const decl = parseTypeSource(`type T = { greeting : string = "hello" }`);
    expect(decl.fields[0].defaultValue).toBe("hello");
  });

  it("parses field_name : number = 42 — captures number default", () => {
    const decl = parseTypeSource(`type T = { count : number = 42 }`);
    expect(decl.fields[0].defaultValue).toBe(42);
  });

  it("parses field_name : boolean = true — captures boolean default", () => {
    const decl = parseTypeSource(`type T = { active : boolean = true }`);
    expect(decl.fields[0].defaultValue).toBe(true);
  });

  it("parses field_name : boolean = false — captures false default", () => {
    const decl = parseTypeSource(`type T = { disabled : boolean = false }`);
    expect(decl.fields[0].defaultValue).toBe(false);
  });

  it("no default value — defaultValue is undefined", () => {
    const decl = parseTypeSource(`type T = { name : string }`);
    expect(decl.fields[0].defaultValue).toBeUndefined();
  });

  it("parses field with decimal default", () => {
    const decl = parseTypeSource(`type T = { rate : number = 0.75 }`);
    expect(decl.fields[0].defaultValue).toBe(0.75);
  });
});

// ═══════════════════════════════════════════════════════════════════
// COMPILER TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Compiler — optional and default value handling", () => {
  it("optional field generates .optional() in Zod schema", () => {
    const source = `type T = { name? : string }`;
    const mod = compileFile(source);
    const schema = mod.types.get("T") as z.ZodObject<any>;
    expect(schema).toBeDefined();

    // Parsing with undefined should succeed (optional field)
    const result = schema.safeParse({});
    expect(result.success).toBe(true);

    // Parsing with a value should also succeed
    const result2 = schema.safeParse({ name: "test" });
    expect(result2.success).toBe(true);
  });

  it("default value generates .default(value) in Zod schema", () => {
    const source = `type T = { count : number = 42 }`;
    const mod = compileFile(source);
    const schema = mod.types.get("T") as z.ZodObject<any>;
    expect(schema).toBeDefined();

    // Parsing without the field should fill in the default
    const result = schema.parse({});
    expect(result.count).toBe(42);
  });

  it("default with string value fills in correctly", () => {
    const source = `type T = { greeting : string = "hello" }`;
    const mod = compileFile(source);
    const schema = mod.types.get("T") as z.ZodObject<any>;

    const result = schema.parse({});
    expect(result.greeting).toBe("hello");
  });

  it("default with boolean value fills in correctly", () => {
    const source = `type T = { active : boolean = true }`;
    const mod = compileFile(source);
    const schema = mod.types.get("T") as z.ZodObject<any>;

    const result = schema.parse({});
    expect(result.active).toBe(true);
  });

  it("field with default — provided value overrides default", () => {
    const source = `type T = { count : number = 42 }`;
    const mod = compileFile(source);
    const schema = mod.types.get("T") as z.ZodObject<any>;

    const result = schema.parse({ count: 100 });
    expect(result.count).toBe(100);
  });

  it("regular field — no .optional() or .default(), requires value", () => {
    const source = `type T = { name : string }`;
    const mod = compileFile(source);
    const schema = mod.types.get("T") as z.ZodObject<any>;

    // Missing required field should fail
    const result = schema.safeParse({});
    expect(result.success).toBe(false);

    // Providing the field should pass
    const result2 = schema.safeParse({ name: "test" });
    expect(result2.success).toBe(true);
  });

  it("full type block with mixed fields compiles correctly", () => {
    const source = `type Config = {
      name : string
      debug? : boolean
      retries : number = 3
      greeting : string = "hi"
    }`;
    const mod = compileFile(source);
    const schema = mod.types.get("Config") as z.ZodObject<any>;
    expect(schema).toBeDefined();

    // Only name is required
    const result = schema.parse({ name: "myapp" });
    expect(result.name).toBe("myapp");
    expect(result.retries).toBe(3);
    expect(result.greeting).toBe("hi");
    // debug is optional, should be undefined if not provided
    expect(result.debug).toBeUndefined();
  });

  it("optional field rejects wrong type", () => {
    const source = `type T = { count? : number }`;
    const mod = compileFile(source);
    const schema = mod.types.get("T") as z.ZodObject<any>;

    const result = schema.safeParse({ count: "not a number" });
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// INTEGRATION TEST — full pipeline
// ═══════════════════════════════════════════════════════════════════

describe("DSL Integration — lexer → parser → compiler", () => {
  it("full DSL source with optional fields and defaults produces valid compiled module", () => {
    const source = `
      type ReviewResult = {
        summary : string
        score : number = 5
        confidence? : number
        recommendation : string = "neutral"
        flagged : boolean = false
      }

      llm reviewCode(code: string) -> ReviewResult {
        model: "gpt-4o"
        temperature: 0.3
        system: "You are a code reviewer."
        prompt: """
          Review the following code:
          {{code}}
        """
      }
    `;

    // Full pipeline: lex → parse → compile
    const mod = compileFile(source);

    // Check type was compiled
    const schema = mod.types.get("ReviewResult");
    expect(schema).toBeDefined();

    // Check function was compiled
    const fn = mod.functions.get("reviewCode");
    expect(fn).toBeDefined();
    expect(fn!.name).toBe("reviewCode");
    expect(fn!.model).toBe("gpt-4o");
    expect(fn!.temperature).toBe(0.3);

    // Validate schema behavior — defaults fill in, required fields required
    const zodSchema = schema as z.ZodObject<any>;

    // With only required field (summary)
    const parsed = zodSchema.parse({ summary: "Looks good" });
    expect(parsed.summary).toBe("Looks good");
    expect(parsed.score).toBe(5);
    expect(parsed.recommendation).toBe("neutral");
    expect(parsed.flagged).toBe(false);
    expect(parsed.confidence).toBeUndefined();

    // Without summary → should fail
    const fail = zodSchema.safeParse({});
    expect(fail.success).toBe(false);
  });

  it("prompt function interpolates variables correctly", () => {
    const source = `
      type Output = {
        result : string
      }

      llm process(input: string) -> Output {
        model: "gpt-4o"
        system: "You process text."
        prompt: "Process this: {{input}}"
      }
    `;

    const mod = compileFile(source);
    const fn = mod.functions.get("process");
    expect(fn).toBeDefined();
    expect(fn!.prompt("hello world")).toBe("Process this: hello world");
  });
});
