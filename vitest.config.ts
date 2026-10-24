import { defineConfig } from "vitest/config";
import path from 'node:path';
// Node 22+ ships its own localStorage, which hides jsdom's in UI tests.
const execArgv=Number(process.versions.node.split('.')[0])>=22?['--no-experimental-webstorage']:[];
export default defineConfig({resolve:{alias:{'@':path.resolve(__dirname,'.')}},esbuild:{jsx:'automatic'},test:{environment:"node",include:["tests/**/*.test.{ts,tsx}"],poolOptions:{forks:{execArgv},threads:{execArgv}}}});
