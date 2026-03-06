// Translation Agent — L-Script v0.1

type Translation = {
  original_language: string,
  target_language: string,
  translated_text: string,
  confidence: number(min=0, max=1),
  alternative_translations: string[]
}

llm Translator(text: string) -> Translation {
  model: "gpt-4o"
  temperature: 0.3
  system: "You are a professional translator. Detect the source language automatically."
  prompt:
    """
    Translate the following text to English:
    {{text}}
    """
}
