import { groq } from "@ai-sdk/groq";
import { generateText } from "ai";

const result = await generateText({
  model: groq("openai/gpt-oss-20b"),
  prompt: "Generate a 10 word poem",
});

console.log(result.text);
