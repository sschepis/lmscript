// ── L-Script DSL Compiler (AST → LScriptFunction) ──────────────────

import { z } from "zod";
import type { LScriptFunction } from "../types.js";
import type { Program, TypeDeclarationNode, TypeFieldNode, LLMFunctionNode } from "./ast.js";
import { Lexer } from "./lexer.js";
import { Parser } from "./parser.js";

export interface CompiledModule {
  types: Map<string, z.ZodType>;
  functions: Map<string, LScriptFunction<string, z.ZodType>>;
}

export class CompileError extends Error {
  constructor(message: string) {
    super(`Compile error: ${message}`);
    this.name = "CompileError";
  }
}

/**
 * Compile a parsed Program AST into a CompiledModule.
 */
export function compile(program: Program): CompiledModule {
  const types = new Map<string, z.ZodType>();
  const functions = new Map<string, LScriptFunction<string, z.ZodType>>();

  // First pass: compile all type declarations
  for (const decl of program.declarations) {
    if (decl.kind === "TypeDeclaration") {
      const schema = compileTypeDeclaration(decl);
      types.set(decl.name, schema);
    }
  }

  // Second pass: compile all LLM functions (may reference types)
  for (const decl of program.declarations) {
    if (decl.kind === "LLMFunction") {
      const fn = compileLLMFunction(decl, types);
      functions.set(decl.name, fn);
    }
  }

  return { types, functions };
}

/**
 * Convenience: lex → parse → compile in one step.
 */
export function compileFile(source: string): CompiledModule {
  const lexer = new Lexer(source);
  const tokens = lexer.tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  return compile(program);
}

// ── Type compilation ────────────────────────────────────────────────

function compileTypeDeclaration(decl: TypeDeclarationNode): z.ZodType {
  const shape: Record<string, z.ZodType> = {};

  for (const field of decl.fields) {
    shape[field.name] = compileField(field);
  }

  return z.object(shape);
}

function compileField(field: TypeFieldNode): z.ZodType {
  let schema: z.ZodType;

  if (field.enumValues && field.enumValues.length > 0) {
    // Enum type
    schema = z.enum(field.enumValues as [string, ...string[]]);
  } else {
    schema = compileBaseType(field.type, field.constraints);
  }

  if (field.isArray) {
    schema = z.array(schema);
  }

  // Apply default value (makes field effectively optional with a fallback)
  if (field.defaultValue !== undefined) {
    schema = schema.default(field.defaultValue);
  }
  // Apply optional marker (only if no default, since .default() already implies optional)
  else if (field.optional) {
    schema = schema.optional();
  }

  return schema;
}

function compileBaseType(
  typeName: string,
  constraints?: Record<string, number | string>,
): z.ZodType {
  switch (typeName) {
    case "string": {
      let s = z.string();
      if (constraints) {
        if ("maxLength" in constraints) {
          s = s.max(Number(constraints.maxLength));
        }
        if ("minLength" in constraints) {
          s = s.min(Number(constraints.minLength));
        }
      }
      return s;
    }
    case "number": {
      let n = z.number();
      if (constraints) {
        if ("min" in constraints) {
          n = n.min(Number(constraints.min));
        }
        if ("max" in constraints) {
          n = n.max(Number(constraints.max));
        }
      }
      return n;
    }
    case "boolean":
      return z.boolean();
    default:
      // Could be a reference to a custom type, but at field level
      // we don't have the types map. For now, treat unknown as z.any()
      return z.any();
  }
}

// ── LLM function compilation ────────────────────────────────────────

function compileLLMFunction(
  node: LLMFunctionNode,
  types: Map<string, z.ZodType>,
): LScriptFunction<string, z.ZodType> {
  // Look up return type
  const schema = types.get(node.returnType);
  if (!schema) {
    throw new CompileError(
      `Return type '${node.returnType}' not found. Available types: ${[...types.keys()].join(", ") || "(none)"}`,
    );
  }

  // Build prompt function from template
  const promptTemplate = node.body.prompt ?? "";
  const paramNames = node.parameters.map((p) => p.name);

  const promptFn = (input: string): string => {
    // For a single-parameter function, replace {{paramName}} with the input
    let result = promptTemplate;
    for (const paramName of paramNames) {
      result = result.replace(new RegExp(`\\{\\{${paramName}\\}\\}`, "g"), input);
    }
    return result;
  };

  return {
    name: node.name,
    model: node.body.model ?? "gpt-4o",
    system: node.body.system ?? "",
    prompt: promptFn,
    schema,
    temperature: node.body.temperature,
  };
}
