import { OpenAIProvider } from "./src/providers/openai.js";
const p = new OpenAIProvider({ apiKey: "test" });
console.log("Ready");
