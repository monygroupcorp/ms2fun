#!/usr/bin/env node

/**
 * Verify Phase 2 seed data completeness
 * Run: node scripts/verify-seed-data.mjs
 */

import { promises as fs } from "fs";
import { ethers } from "ethers";

const RPC_URL = "http://127.0.0.1:8545";
const CONFIG_PATH = "src/config/contracts.local.json";

async function main() {
    console.log("🔍 Verifying Phase 2 Seed Data\n");

    // Load config
    const config = JSON.parse(await fs.readFile(CONFIG_PATH, "utf8"));
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

    // Verify vaults
    console.log("Vaults:");
    console.log(`  Expected: 2`);
    console.log(`  Actual:   ${config.vaults.length}`);
    console.log(`  ✓ ${config.vaults.length === 2 ? "PASS" : "FAIL"}\n`);

    // Verify ERC404 instances
    console.log("ERC404 Instances:");
    console.log(`  Expected: 3`);
    console.log(`  Actual:   ${config.instances.erc404.length}`);
    console.log(`  ✓ ${config.instances.erc404.length === 3 ? "PASS" : "FAIL"}`);

    for (const instance of config.instances.erc404) {
        const code = await provider.getCode(instance.address);
        const exists = code !== "0x" && code !== "0x0";
        console.log(`    - ${instance.name}: ${exists ? "✓" : "✗"}`);
    }
    console.log("");

    // Verify ERC1155 instances
    console.log("ERC1155 Instances:");
    console.log(`  Expected: 3`);
    console.log(`  Actual:   ${config.instances.erc1155.length}`);
    console.log(`  ✓ ${config.instances.erc1155.length === 3 ? "PASS" : "FAIL"}`);

    for (const instance of config.instances.erc1155) {
        const code = await provider.getCode(instance.address);
        const exists = code !== "0x" && code !== "0x0";
        console.log(`    - ${instance.name}: ${exists ? "✓" : "✗"}`);
    }
    console.log("");

    // Verify global messages
    const messageRegistryAbi = JSON.parse(
        await fs.readFile("./contracts/out/GlobalMessageRegistry.sol/GlobalMessageRegistry.json", "utf8")
    ).abi;

    const messageRegistry = new ethers.Contract(
        config.contracts.GlobalMessageRegistry,
        messageRegistryAbi,
        provider
    );

    const messageCount = await messageRegistry.getMessageCount();

    console.log("Global Messages:");
    console.log(`  Expected: 15-20+`);
    console.log(`  Actual:   ${messageCount.toString()}`);
    console.log(`  ✓ ${messageCount.toNumber() >= 15 ? "PASS" : "WARN - May need more activity"}\n`);

    // Summary
    console.log("═══════════════════════════════════════");
    const allPassed =
        config.vaults.length === 2 &&
        config.instances.erc404.length === 3 &&
        config.instances.erc1155.length === 3 &&
        messageCount.toNumber() >= 10;

    if (allPassed) {
        console.log("✅ Phase 2 Seed Data: VERIFIED");
    } else {
        console.log("⚠️  Phase 2 Seed Data: INCOMPLETE");
        console.log("   Run: npm run chain:start");
    }
    console.log("═══════════════════════════════════════\n");
}

main().catch(err => {
    console.error("❌ Verification failed:", err.message);
    process.exit(1);
});
