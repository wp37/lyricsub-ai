import { GoogleGenAI } from "@google/genai";
async function list() {
  const ai = new GoogleGenAI();
  const response = await ai.models.list();
  for await (const model of response) {
    if (model.name.includes("gemini")) {
      console.log(model.name, model.displayName);
    }
  }
}
list().catch(console.error);
