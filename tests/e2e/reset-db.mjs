// Removes the throwaway e2e database so every end-to-end run starts empty.
import fs from "node:fs";
import path from "node:path";

fs.rmSync(path.resolve(process.cwd(), ".data/e2e"), { recursive: true, force: true });
