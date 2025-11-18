// src/utils/testEkubo.mjs
import "dotenv/config";
import { logUsdcPoolsSample } from "./ekubo.mjs";

async function main() {
  await logUsdcPoolsSample(10);
}

main().catch((err) => {
  console.error("❌ testEkubo failed:", err);
  process.exit(1);
});
