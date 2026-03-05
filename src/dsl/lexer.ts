// ── L-Script DSL Lexer ──────────────────────────────────────────────

export enum TokenType {
  // Keywords
  TYPE = "TYPE",
  LLM = "LLM",

  // Identifiers & literals
  IDENTIFIER = "IDENTIFIER",
  STRING = "STRING",
  TRIPLE_STRING = "TRIPLE_STRING",
  NUMBER = "NUMBER",

  // Symbols
  LBRACE = "LBRACE",       // {
  RBRACE = "RBRACE",       // }
  LPAREN = "LPAREN",       // (
  RPAREN = "RPAREN",       // )
  LBRACKET = "LBRACKET",   // [
  RBRACKET = "RBRACKET",   // ]
  COLON = "COLON",         // :
  COMMA = "COMMA",         // ,
  ARROW = "ARROW",         // ->
  EQUALS = "EQUALS",       // =
  PIPE = "PIPE",           // |

  // Special
  TEMPLATE_VAR = "TEMPLATE_VAR",  // {{var}}
  COMMENT = "COMMENT",
  EOF = "EOF",
}

export interface Token {
  type: TokenType;
  value: string;
  line: number;
  column: number;
}

const KEYWORDS: Record<string, TokenType> = {
  type: TokenType.TYPE,
  llm: TokenType.LLM,
};

export class LexerError extends Error {
  constructor(
    message: string,
    public readonly line: number,
    public readonly column: number,
  ) {
    super(`Lexer error at ${line}:${column}: ${message}`);
    this.name = "LexerError";
  }
}

export class Lexer {
  private pos = 0;
  private line = 1;
  private column = 1;
  private tokens: Token[] = [];

  constructor(private source: string) {}

  tokenize(): Token[] {
    this.pos = 0;
    this.line = 1;
    this.column = 1;
    this.tokens = [];

    while (this.pos < this.source.length) {
      this.skipWhitespace();
      if (this.pos >= this.source.length) break;

      const ch = this.source[this.pos];

      // Single-line comment
      if (ch === "/" && this.peek(1) === "/") {
        this.readComment();
        continue;
      }

      // Triple-quoted string
      if (ch === '"' && this.peek(1) === '"' && this.peek(2) === '"') {
        this.readTripleString();
        continue;
      }

      // Regular string
      if (ch === '"') {
        this.readString();
        continue;
      }

      // Template variable {{...}}
      if (ch === "{" && this.peek(1) === "{") {
        this.readTemplateVar();
        continue;
      }

      // Number
      if (this.isDigit(ch) || (ch === "-" && this.isDigit(this.peek(1) ?? ""))) {
        this.readNumber();
        continue;
      }

      // Arrow ->
      if (ch === "-" && this.peek(1) === ">") {
        this.addToken(TokenType.ARROW, "->", this.line, this.column);
        this.advance();
        this.advance();
        continue;
      }

      // Symbols
      if (this.readSymbol(ch)) {
        continue;
      }

      // Identifiers and keywords
      if (this.isAlpha(ch) || ch === "_") {
        this.readIdentifier();
        continue;
      }

      throw new LexerError(`Unexpected character '${ch}'`, this.line, this.column);
    }

    this.addToken(TokenType.EOF, "", this.line, this.column);
    return this.tokens;
  }

  private skipWhitespace(): void {
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];
      if (ch === "\n") {
        this.line++;
        this.column = 1;
        this.pos++;
      } else if (ch === "\r") {
        this.pos++;
        if (this.pos < this.source.length && this.source[this.pos] === "\n") {
          this.pos++;
        }
        this.line++;
        this.column = 1;
      } else if (ch === " " || ch === "\t") {
        this.column++;
        this.pos++;
      } else {
        break;
      }
    }
  }

  private readComment(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    // Skip //
    this.advance();
    this.advance();

    while (this.pos < this.source.length && this.source[this.pos] !== "\n") {
      value += this.source[this.pos];
      this.advance();
    }

    this.addToken(TokenType.COMMENT, value.trim(), startLine, startCol);
  }

  private readString(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    // Skip opening "
    this.advance();

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos];

      if (ch === "\\") {
        this.advance();
        if (this.pos < this.source.length) {
          const escaped = this.source[this.pos];
          switch (escaped) {
            case "n": value += "\n"; break;
            case "t": value += "\t"; break;
            case "\\": value += "\\"; break;
            case '"': value += '"'; break;
            default: value += "\\" + escaped;
          }
          this.advance();
        }
        continue;
      }

      if (ch === '"') {
        this.advance();
        this.addToken(TokenType.STRING, value, startLine, startCol);
        return;
      }

      if (ch === "\n") {
        this.line++;
        this.column = 1;
        this.pos++;
        value += "\n";
        continue;
      }

      value += ch;
      this.advance();
    }

    throw new LexerError("Unterminated string", startLine, startCol);
  }

  private readTripleString(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    // Skip opening """
    this.advance();
    this.advance();
    this.advance();

    // Skip optional newline after opening """
    if (this.pos < this.source.length && this.source[this.pos] === "\n") {
      this.line++;
      this.column = 1;
      this.pos++;
    } else if (this.pos < this.source.length && this.source[this.pos] === "\r") {
      this.pos++;
      if (this.pos < this.source.length && this.source[this.pos] === "\n") {
        this.pos++;
      }
      this.line++;
      this.column = 1;
    }

    while (this.pos < this.source.length) {
      if (
        this.source[this.pos] === '"' &&
        this.peek(1) === '"' &&
        this.peek(2) === '"'
      ) {
        // Skip closing """
        this.advance();
        this.advance();
        this.advance();

        // Trim trailing newline before closing """
        if (value.endsWith("\n")) {
          value = value.slice(0, -1);
        }
        if (value.endsWith("\r")) {
          value = value.slice(0, -1);
        }

        // Dedent: find minimum indentation and remove it
        value = this.dedent(value);

        this.addToken(TokenType.TRIPLE_STRING, value, startLine, startCol);
        return;
      }

      const ch = this.source[this.pos];
      if (ch === "\n") {
        value += ch;
        this.line++;
        this.column = 1;
        this.pos++;
      } else if (ch === "\r") {
        this.pos++;
        if (this.pos < this.source.length && this.source[this.pos] === "\n") {
          this.pos++;
        }
        value += "\n";
        this.line++;
        this.column = 1;
      } else {
        value += ch;
        this.advance();
      }
    }

    throw new LexerError("Unterminated triple-quoted string", startLine, startCol);
  }

  private dedent(text: string): string {
    const lines = text.split("\n");
    // Find minimum indentation of non-empty lines
    let minIndent = Infinity;
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (indent < minIndent) minIndent = indent;
    }

    if (minIndent === Infinity || minIndent === 0) return text;

    return lines.map((line) => {
      if (line.trim().length === 0) return line;
      return line.slice(minIndent);
    }).join("\n");
  }

  private readTemplateVar(): void {
    const startLine = this.line;
    const startCol = this.column;

    // Skip {{
    this.advance();
    this.advance();

    let name = "";
    while (this.pos < this.source.length) {
      if (this.source[this.pos] === "}" && this.peek(1) === "}") {
        this.advance();
        this.advance();
        this.addToken(TokenType.TEMPLATE_VAR, name.trim(), startLine, startCol);
        return;
      }
      name += this.source[this.pos];
      this.advance();
    }

    throw new LexerError("Unterminated template variable", startLine, startCol);
  }

  private readNumber(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    if (this.source[this.pos] === "-") {
      value += "-";
      this.advance();
    }

    while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
      value += this.source[this.pos];
      this.advance();
    }

    // Decimal part
    if (this.pos < this.source.length && this.source[this.pos] === "." && this.isDigit(this.peek(1) ?? "")) {
      value += ".";
      this.advance();
      while (this.pos < this.source.length && this.isDigit(this.source[this.pos])) {
        value += this.source[this.pos];
        this.advance();
      }
    }

    this.addToken(TokenType.NUMBER, value, startLine, startCol);
  }

  private readSymbol(ch: string): boolean {
    const symbolMap: Record<string, TokenType> = {
      "{": TokenType.LBRACE,
      "}": TokenType.RBRACE,
      "(": TokenType.LPAREN,
      ")": TokenType.RPAREN,
      "[": TokenType.LBRACKET,
      "]": TokenType.RBRACKET,
      ":": TokenType.COLON,
      ",": TokenType.COMMA,
      "=": TokenType.EQUALS,
      "|": TokenType.PIPE,
    };

    const type = symbolMap[ch];
    if (type !== undefined) {
      this.addToken(type, ch, this.line, this.column);
      this.advance();
      return true;
    }
    return false;
  }

  private readIdentifier(): void {
    const startLine = this.line;
    const startCol = this.column;
    let value = "";

    while (
      this.pos < this.source.length &&
      (this.isAlphaNum(this.source[this.pos]) || this.source[this.pos] === "_")
    ) {
      value += this.source[this.pos];
      this.advance();
    }

    const keyword = KEYWORDS[value];
    if (keyword !== undefined) {
      this.addToken(keyword, value, startLine, startCol);
    } else {
      this.addToken(TokenType.IDENTIFIER, value, startLine, startCol);
    }
  }

  private addToken(type: TokenType, value: string, line: number, column: number): void {
    this.tokens.push({ type, value, line, column });
  }

  private advance(): void {
    this.pos++;
    this.column++;
  }

  private peek(offset: number): string | undefined {
    const idx = this.pos + offset;
    return idx < this.source.length ? this.source[idx] : undefined;
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isAlpha(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isAlphaNum(ch: string): boolean {
    return this.isAlpha(ch) || this.isDigit(ch);
  }
}
