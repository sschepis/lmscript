/**
 * Example: Conversational Programming Tutor — Multi-turn Sessions
 *
 * Demonstrates:
 *   - runtime.createSession() to create a conversational session
 *   - Multiple session.send() calls showing context builds up
 *   - session.getHistory() and session.getTokenCount()
 *   - Natural multi-turn conversation where the AI refers back to previous messages
 *
 * Usage:
 *   export OPENAI_API_KEY=sk-...
 *   npx tsx src/examples/conversational-tutor.ts
 */

import { z } from "zod";
import { LScriptRuntime, OpenAIProvider } from "../index.js";
import type { LScriptFunction, ChatMessage } from "../index.js";

// ── 1. Define the output schema ─────────────────────────────────────

const TutorResponseSchema = z.object({
  explanation: z.string(),
  code_example: z.string().optional(),
  difficulty_level: z.enum(["beginner", "intermediate", "advanced"]),
  follow_up_questions: z.array(z.string()),
  topics_covered: z.array(z.string()),
});

type TutorResponse = z.infer<typeof TutorResponseSchema>;

// ── 2. Define the L-Script function ─────────────────────────────────

const ProgrammingTutor: LScriptFunction<string, typeof TutorResponseSchema> = {
  name: "ProgrammingTutor",
  model: "gpt-4o",
  system:
    "You are an expert JavaScript/TypeScript programming tutor. " +
    "You explain concepts clearly with practical examples. " +
    "When the student asks follow-up questions, refer back to previous explanations " +
    "and build upon them. Adapt your difficulty level based on the student's questions. " +
    "Always provide code examples when relevant, and suggest follow-up questions " +
    "to deepen understanding.",
  prompt: (question: string) =>
    `Student question: ${question}`,
  schema: TutorResponseSchema,
  temperature: 0.5,
  maxRetries: 2,
};

// ── 3. Conversation questions (each builds on the previous) ─────────

const questions = [
  "What is a closure in JavaScript?",
  "Can you show me a practical use case for closures?",
  "How do closures relate to the module pattern?",
  "What are the memory implications of closures?",
];

// ── 4. Execute ──────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("╔═══════════════════════════════════════════════════╗");
    console.error("║  OPENAI_API_KEY is required to run this demo     ║");
    console.error("║                                                   ║");
    console.error("║  export OPENAI_API_KEY=sk-...                     ║");
    console.error("║  npx tsx src/examples/conversational-tutor.ts     ║");
    console.error("╚═══════════════════════════════════════════════════╝");
    process.exit(1);
  }

  const runtime = new LScriptRuntime({
    provider: new OpenAIProvider({ apiKey }),
    verbose: true,
  });

  console.log("\n🎓 Programming Tutor — Multi-turn Session Demo");
  console.log("═".repeat(60));
  console.log("Creating a conversational session with context tracking...\n");

  // Create a session — this maintains conversation history across sends
  const session = runtime.createSession(ProgrammingTutor, {
    maxTokens: 8192,
    pruneStrategy: "fifo",
  });

  const allTopics: string[] = [];
  let totalTokensUsed = 0;

  for (let i = 0; i < questions.length; i++) {
    const question = questions[i];

    console.log(`\n🗣️  Turn ${i + 1}/${questions.length}`);
    console.log("─".repeat(60));
    console.log(`📝 Student: "${question}"\n`);

    try {
      const result = await session.send(question);
      const data: TutorResponse = result.data;

      // Display the response
      console.log(`  📚 Difficulty: ${difficultyIcon(data.difficulty_level)} ${data.difficulty_level}`);
      console.log(`  💡 Explanation:`);
      wrapText(data.explanation, 55).forEach((line) => console.log(`     ${line}`));

      if (data.code_example) {
        console.log(`\n  💻 Code Example:`);
        console.log("  ┌" + "─".repeat(56) + "┐");
        data.code_example.split("\n").forEach((line) => {
          console.log(`  │ ${line.padEnd(55)}│`);
        });
        console.log("  └" + "─".repeat(56) + "┘");
      }

      console.log(`\n  ❓ Suggested Follow-ups:`);
      data.follow_up_questions.forEach((q) => console.log(`     • ${q}`));

      console.log(`\n  🏷️  Topics: ${data.topics_covered.join(", ")}`);
      allTopics.push(...data.topics_covered);

      // Session stats after each turn
      const tokenCount = session.getTokenCount();
      const historyLength = session.getHistory().length;
      totalTokensUsed += result.usage?.totalTokens ?? 0;

      console.log(`\n  📊 Session Stats:`);
      console.log(`     • Context tokens: ${tokenCount}`);
      console.log(`     • History messages: ${historyLength}`);
      console.log(`     • API tokens this turn: ${result.usage?.totalTokens ?? "N/A"}`);
      console.log(`     • Attempts: ${result.attempts}`);
    } catch (err) {
      console.error(`\n  ❌ Error on turn ${i + 1}:`, err);
    }
  }

  // ── Final conversation summary ──────────────────────────────────

  console.log("\n\n📋 Conversation Summary");
  console.log("═".repeat(60));

  const finalHistory = session.getHistory();
  const finalTokenCount = session.getTokenCount();
  const uniqueTopics = [...new Set(allTopics)];

  console.log(`  📊 Total turns:          ${questions.length}`);
  console.log(`  💬 History messages:      ${finalHistory.length}`);
  console.log(`  🔤 Context token count:  ${finalTokenCount}`);
  console.log(`  🪙 Total API tokens:     ${totalTokensUsed}`);
  console.log(`  🏷️  Unique topics covered: ${uniqueTopics.length}`);
  console.log(`     ${uniqueTopics.join(", ")}`);

  console.log("\n  📜 Message roles in history:");
  finalHistory.forEach((msg: ChatMessage, i: number) => {
    const roleIcon = msg.role === "user" ? "👤" : msg.role === "assistant" ? "🤖" : "⚙️";
    const preview = msg.content.slice(0, 60).replace(/\n/g, " ");
    console.log(`     ${i + 1}. ${roleIcon} [${msg.role}] ${preview}...`);
  });

  console.log("\n✅ Session demo complete!");
}

// ── Helpers ──────────────────────────────────────────────────────────

function difficultyIcon(level: string): string {
  switch (level) {
    case "beginner": return "🟢";
    case "intermediate": return "🟡";
    case "advanced": return "🔴";
    default: return "⚪";
  }
}

function wrapText(text: string, width: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 > width) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = currentLine ? `${currentLine} ${word}` : word;
    }
  }
  if (currentLine) lines.push(currentLine);
  return lines;
}

main();
