import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const schema = z.object({
  name: z.string(),
  age: z.number().optional(),
});

console.log(JSON.stringify(zodToJsonSchema(schema, { target: "openApi3" }), null, 2));
