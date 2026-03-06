// Security Review Agent — L-Script v0.1

type Critique = {
  score: number(min=1, max=10),
  vulnerabilities: string[],
  suggested_fix: string
}

type Analysis = {
  sentiment: "positive" | "negative" | "neutral",
  summary: string(maxLength=100),
  action_items: string[]
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

llm AnalyzeFeedback(raw_text: string) -> Analysis {
  model: "gpt-4o"
  temperature: 0.3
  
  system: "You are a Senior Product Manager."
  
  prompt:
    """
    Review this customer feedback: {{raw_text}}
    Focus specifically on technical debt and UI friction.
    """
}
