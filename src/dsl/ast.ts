// ── L-Script DSL AST Node Definitions ───────────────────────────────

export interface TypeFieldNode {
  name: string;
  type: string;              // "string", "number", "boolean"
  isArray: boolean;          // string[] → true
  constraints?: Record<string, number | string>;  // min=1, max=10, maxLength=100
  enumValues?: string[];     // "positive" | "negative" | "neutral"
}

export interface TypeDeclarationNode {
  kind: "TypeDeclaration";
  name: string;
  fields: TypeFieldNode[];
}

export interface LLMFunctionNode {
  kind: "LLMFunction";
  name: string;
  parameters: Array<{ name: string; type: string }>;
  returnType: string;
  body: {
    model?: string;
    temperature?: number;
    system?: string;
    prompt?: string;         // The raw prompt template with {{vars}}
    output?: string;         // e.g. "json_mode"
  };
}

export type ASTNode = TypeDeclarationNode | LLMFunctionNode;

export interface Program {
  declarations: ASTNode[];
}
