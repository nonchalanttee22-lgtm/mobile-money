import { Command } from "commander";
import { checkAuth } from "../api";
import { getConfig } from "../config";

export function registerAuthCommand(program: Command): void {
  const auth = program.command("auth").description("Authentication commands");

  auth
    .command("check")
    .description("Verify the API key is valid")
    .action(async () => {
      try {
        await checkAuth();
        const { apiUrl } = getConfig();
        console.log(`✓ API key valid — connected to ${apiUrl}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`✗ Auth failed: ${msg}`);
        process.exit(1);
      }
    });
}
