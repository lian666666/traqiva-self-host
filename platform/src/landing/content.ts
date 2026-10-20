import { SELF_HOST_REPOSITORY } from '../deploymentPrompt';
export const LANDING_REPOSITORY=SELF_HOST_REPOSITORY;
export const LANDING_DOCS=`${LANDING_REPOSITORY}/blob/main/platform/docs/CAPABILITIES.md`;
export const LANDING_CLI_DOCS=`${LANDING_REPOSITORY}/blob/main/platform/cli/README.md`;
export function installCommand(origin:string){return `npm install --global ${origin}/downloads/traqiva-cli-0.1.0.tgz`;}
export function localExample(origin:string){return `${installCommand(origin)}\n\ntraqiva engine install --url ${origin}\ntraqiva engine status\ntraqiva setup --agent codex --print\n\n# Use a synthetic file to test compression and recovery.\ntraqiva compress ./build.log`;}
export function cloudExample(origin:string){return `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  apiKey: process.env.OPENAI_API_KEY,\n  baseURL: "${origin}/v1",\n  defaultHeaders: {\n    "x-traqiva-key": process.env.TRAQIVA_KEY\n  }\n});\n\n// Choose a model available in your own provider account.\nconst response = await client.chat.completions.create({\n  model: "YOUR_PROVIDER_MODEL",\n  messages: [{ role: "user", content: "Hello, Traqiva." }]\n});`;}
