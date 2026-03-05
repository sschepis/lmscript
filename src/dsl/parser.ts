// ── L-Script DSL Parser ─────────────────────────────────────────────

import { TokenType, type Token } from "./lexer.js";
import type {
  Program,
  ASTNode,
  TypeDeclarationNode,
  TypeFieldNode,
  LLMFunctionNode,
} from "./ast.js";

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`Parse error at ${line}:${column}: ${message}`);
    this.name = "ParseError";
  }
}

export class Parser {
  private pos = 0;
  private filteredTokens: Token[];

  constructor(private tokens: Token[]) {
    // Filter out comments for parsing
    this.filteredTokens = tokens.filter((t) => t.type !== TokenType.COMMENT);
  }

  parse(): Program {
    const declarations: ASTNode[] = [];

    while (!this.isAtEnd()) {
      const token = this.current();

      if (token.type === TokenType.TYPE) {
        declarations.push(this.parseTypeDeclaration());
      } else if (token.type === TokenType.LLM) {
        declarations.push(this.parseLLMFunction());
      } else if (token.type === TokenType.EOF) {
        break;
      } else {
        throw this.error(`Unexpected token '${token.value}', expected 'type' or 'llm'`);
      }
    }

    return { declarations };
  }

  parseTypeDeclaration(): TypeDeclarationNode {
    this.expect(TokenType.TYPE, "type");
    const name = this.expect(TokenType.IDENTIFIER, "type name").value;
    this.expect(TokenType.EQUALS, "=");
    this.expect(TokenType.LBRACE, "{");

    const fields: TypeFieldNode[] = [];

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      fields.push(this.parseTypeField());

      // Optional comma between fields
      if (this.check(TokenType.COMMA)) {
        this.advance();
      }
    }

    this.expect(TokenType.RBRACE, "}");

    return { kind: "TypeDeclaration", name, fields };
  }

  parseTypeField(): TypeFieldNode {
    const name = this.expect(TokenType.IDENTIFIER, "field name").value;
    this.expect(TokenType.COLON, ":");

    // Check for enum type: "value1" | "value2" | ...
    if (this.check(TokenType.STRING)) {
      return this.parseEnumField(name);
    }

    const typeName = this.expect(TokenType.IDENTIFIER, "type name").value;

    // Check for constraints: type(min=1, max=10)
    let constraints: Record<string, number | string> | undefined;
    if (this.check(TokenType.LPAREN)) {
      constraints = this.parseConstraints();
    }

    // Check for array marker: []
    let isArray = false;
    if (this.check(TokenType.LBRACKET)) {
      this.advance();
      this.expect(TokenType.RBRACKET, "]");
      isArray = true;
    }

    return { name, type: typeName, isArray, constraints };
  }

  private parseEnumField(name: string): TypeFieldNode {
    const enumValues: string[] = [];

    // First value
    enumValues.push(this.expect(TokenType.STRING, "enum value").value);

    // Additional | "value" ...
    while (this.check(TokenType.PIPE)) {
      this.advance(); // skip |
      enumValues.push(this.expect(TokenType.STRING, "enum value").value);
    }

    return { name, type: "enum", isArray: false, enumValues };
  }

  private parseConstraints(): Record<string, number | string> {
    const constraints: Record<string, number | string> = {};

    this.expect(TokenType.LPAREN, "(");

    while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
      const key = this.expect(TokenType.IDENTIFIER, "constraint name").value;
      this.expect(TokenType.EQUALS, "=");

      // Value can be a number or string
      if (this.check(TokenType.NUMBER)) {
        constraints[key] = parseFloat(this.advance().value);
      } else if (this.check(TokenType.STRING)) {
        constraints[key] = this.advance().value;
      } else {
        throw this.error("Expected number or string for constraint value");
      }

      // Optional comma
      if (this.check(TokenType.COMMA)) {
        this.advance();
      }
    }

    this.expect(TokenType.RPAREN, ")");

    return constraints;
  }

  parseLLMFunction(): LLMFunctionNode {
    this.expect(TokenType.LLM, "llm");
    const name = this.expect(TokenType.IDENTIFIER, "function name").value;

    // Parse parameters
    this.expect(TokenType.LPAREN, "(");
    const parameters: Array<{ name: string; type: string }> = [];

    while (!this.check(TokenType.RPAREN) && !this.isAtEnd()) {
      const paramName = this.expect(TokenType.IDENTIFIER, "parameter name").value;
      this.expect(TokenType.COLON, ":");
      const paramType = this.expect(TokenType.IDENTIFIER, "parameter type").value;
      parameters.push({ name: paramName, type: paramType });

      if (this.check(TokenType.COMMA)) {
        this.advance();
      }
    }

    this.expect(TokenType.RPAREN, ")");

    // Parse return type
    this.expect(TokenType.ARROW, "->");
    const returnType = this.expect(TokenType.IDENTIFIER, "return type").value;

    // Parse body
    this.expect(TokenType.LBRACE, "{");
    const body = this.parseLLMBody();
    this.expect(TokenType.RBRACE, "}");

    return { kind: "LLMFunction", name, parameters, returnType, body };
  }

  private parseLLMBody(): LLMFunctionNode["body"] {
    const body: LLMFunctionNode["body"] = {};

    while (!this.check(TokenType.RBRACE) && !this.isAtEnd()) {
      const key = this.expect(TokenType.IDENTIFIER, "body key").value;
      this.expect(TokenType.COLON, ":");

      switch (key) {
        case "model":
          body.model = this.expectStringValue();
          break;
        case "temperature":
          body.temperature = parseFloat(this.expect(TokenType.NUMBER, "temperature value").value);
          break;
        case "system":
          body.system = this.expectStringValue();
          break;
        case "prompt":
          body.prompt = this.parsePromptValue();
          break;
        case "output":
          body.output = this.expect(TokenType.IDENTIFIER, "output mode").value;
          break;
        default:
          throw this.error(`Unknown body key '${key}'`);
      }
    }

    return body;
  }

  private expectStringValue(): string {
    if (this.check(TokenType.STRING)) {
      return this.advance().value;
    }
    if (this.check(TokenType.TRIPLE_STRING)) {
      return this.advance().value;
    }
    throw this.error("Expected string value");
  }

  private parsePromptValue(): string {
    if (this.check(TokenType.TRIPLE_STRING)) {
      return this.advance().value;
    }
    if (this.check(TokenType.STRING)) {
      return this.advance().value;
    }
    throw this.error("Expected string or triple-quoted string for prompt");
  }

  // ── Token navigation helpers ────────────────────────────────────

  private current(): Token {
    return this.filteredTokens[this.pos] ?? {
      type: TokenType.EOF,
      value: "",
      line: 0,
      column: 0,
    };
  }

  private check(type: TokenType): boolean {
    return this.current().type === type;
  }

  private advance(): Token {
    const token = this.current();
    this.pos++;
    return token;
  }

  private expect(type: TokenType, description: string): Token {
    const token = this.current();
    if (token.type !== type) {
      throw this.error(`Expected ${description} (${type}), got '${token.value}' (${token.type})`);
    }
    return this.advance();
  }

  private isAtEnd(): boolean {
    return this.current().type === TokenType.EOF;
  }

  private error(message: string): ParseError {
    const token = this.current();
    return new ParseError(message, token.line, token.column);
  }
}
