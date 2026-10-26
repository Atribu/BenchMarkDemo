import { debugCoralTravel } from "../src/lib/ota/coraltravel-debug";

debugCoralTravel().catch((error) => {
  console.error("[CORALTRAVEL] Debug failed:", error);
  process.exitCode = 1;
});