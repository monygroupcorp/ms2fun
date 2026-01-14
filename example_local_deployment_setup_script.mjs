import { spawn, execSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { ethers } from "ethers";
import http from "http";
import { URL } from "url";

const RPC_URL_LOCAL = "http://127.0.0.1:8545";
const FRONTEND_DIR = "app-colasseum";
const CONFIG_PATH = path.join(FRONTEND_DIR, "config.json");
const LOG_STORE_PATH = path.join(FRONTEND_DIR, "activity-log.json");

const DEPLOYER_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const PLAYER_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const USER_WALLET_ADDRESS = "0x1821bd18cbdd267ce4e389f893ddfe7beb333ab6";
const CHARITY_ADDRESS = USER_WALLET_ADDRESS;
const CHARITY_GENEROSITY_BPS = 1_000; // 10%
const APPRAISAL_VALUE = ethers.parseEther("0.2");
const FIXED_CHANCE_PRICE = ethers.parseUnits("1", "gwei");
const DEFAULT_LORE = "Genesis Trial";

const CONTROL_PORT = 8788;
const LIVE_RELOAD_PORT = "3333";
const TIME_WARP_PATH = "/colasseum-warp";
const LOG_CAPTURE_PATH = "/colasseum-log";
const MILADY_PROXY_PATH = "/milady-metadata";
const MILADY_METADATA_BASE = "https://www.miladymaker.net/milady/json";
const MILADY_IMAGE_BASE = "https://www.miladymaker.net/milady";
const MILADY_CONTRACT_ADDRESS = "0x5af0d9827e0c53e4799bb226655a1de152a425a5";

const main = async () => {
    let anvil, serve, timeWarpServer;

    const cleanup = async () => {
        console.log("\n--- Shutting down Colasseum betatype ---");
        if (timeWarpServer) timeWarpServer.close();
        if (anvil) anvil.kill();
        if (serve) serve.kill();
        console.log("Cleanup complete.");
        process.exit(0);
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    try {
        console.log("--- Building Contracts ---");
        execSync("forge build", { stdio: "inherit" });

        if (!process.env.MAINNET_RPC_URL) {
            throw new Error("ERROR: MAINNET_RPC_URL environment variable is not set.");
        }

        console.log("--- Starting Anvil fork ---");
        anvil = spawn("anvil", ["--fork-url", process.env.MAINNET_RPC_URL, "--chain-id", "1337"], { stdio: "ignore" });

        const provider = new ethers.JsonRpcProvider(RPC_URL_LOCAL);
        await waitForAnvil(provider);
        timeWarpServer = startControlServer(provider);

        const deployer = new ethers.Wallet(DEPLOYER_PRIVATE_KEY, provider);
        let nonce = await deployer.getNonce();

        await provider.send("anvil_setBalance", [PLAYER_ADDRESS, "0x56BC75E2D63100000"]);
        await provider.send("anvil_setBalance", [USER_WALLET_ADDRESS, "0x56BC75E2D63100000"]);
        console.log(`✅ Primed player ${PLAYER_ADDRESS} and user ${USER_WALLET_ADDRESS} with 100 ETH each.`);

        const oracleArtifact = JSON.parse(await fs.readFile("./out/ranmilio.sol/MockBeaconOracle.json"));
        const OracleFactory = new ethers.ContractFactory(oracleArtifact.abi, oracleArtifact.bytecode, deployer);
        const oracle = await OracleFactory.deploy({ nonce: nonce++ });
        await oracle.waitForDeployment();
        const oracleAddress = await oracle.getAddress();

        const verifierArtifact = JSON.parse(await fs.readFile("./out/Verifier.sol/Groth16Verifier.json"));
        const VerifierFactory = new ethers.ContractFactory(verifierArtifact.abi, verifierArtifact.bytecode, deployer);
        const verifier = await VerifierFactory.deploy({ nonce: nonce++ });
        await verifier.waitForDeployment();
        const verifierAddress = await verifier.getAddress();

        const colasseumArtifact = JSON.parse(await fs.readFile("./out/FortressColasseum.sol/FortressColasseum.json"));
        const ColasseumFactory = new ethers.ContractFactory(colasseumArtifact.abi, colasseumArtifact.bytecode, deployer);
        const colasseum = await ColasseumFactory.deploy(oracleAddress, verifierAddress, CHARITY_ADDRESS, CHARITY_GENEROSITY_BPS, { nonce: nonce++ });
        await colasseum.waitForDeployment();
        const colasseumAddress = await colasseum.getAddress();

        const nftArtifact = JSON.parse(await fs.readFile("./out/MockNFT.sol/CoolNFT.json"));
        const NftFactory = new ethers.ContractFactory(nftArtifact.abi, nftArtifact.bytecode, deployer);
        const nft = await NftFactory.deploy({ nonce: nonce++ });
        await nft.waitForDeployment();
        const nftAddress = await nft.getAddress();

        const debugArtifact = JSON.parse(await fs.readFile("./out/ColasseumDebug.sol/ColasseumDebug.json"));
        const DebugFactory = new ethers.ContractFactory(debugArtifact.abi, debugArtifact.bytecode, deployer);
        const debug = await DebugFactory.deploy(colasseumAddress, { nonce: nonce++ });
        await debug.waitForDeployment();
        const debugAddress = await debug.getAddress();

        console.log(`✅ MockBeaconOracle deployed at ${oracleAddress}`);
        console.log(`✅ Groth16Verifier deployed at ${verifierAddress}`);
        console.log(`✅ Colasseum deployed at ${colasseumAddress}`);
        console.log(`✅ CoolNFT deployed at ${nftAddress}`);
        console.log(`✅ ColasseumDebug deployed at ${debugAddress}`);

        const latestBlock = await provider.getBlock("latest");
        const oracleSeed = ethers.solidityPackedKeccak256([
            "string",
            "uint256"
        ], ["colasseum-betatype", latestBlock.timestamp]);
        await (await oracle.setSeed(oracleSeed, { nonce: nonce++ })).wait();
        console.log(`✅ Oracle initialized with seed ${oracleSeed}`);

        const userMintPreviewId = await nft.previewNextId();
        await (await nft.mint(USER_WALLET_ADDRESS, { nonce: nonce++ })).wait();
        console.log(`✅ Minted showcase bottle #${userMintPreviewId} to ${USER_WALLET_ADDRESS}`);

        const TRIAL_NFT_ID = await nft.previewNextId();
        await (await nft.mint(deployer.address, { nonce: nonce++ })).wait();
        await (await nft.approve(colasseumAddress, TRIAL_NFT_ID, { nonce: nonce++ })).wait();

        const depositAmount = (APPRAISAL_VALUE * 5n) / 100n;
        const challengeTx = await colasseum.challenge(
            nftAddress,
            TRIAL_NFT_ID,
            APPRAISAL_VALUE,
            DEFAULT_LORE,
            { value: depositAmount, nonce: nonce++ }
        );
        await challengeTx.wait();
        const createdTrialId = Number(await colasseum.nextTrialId()) - 1;
        console.log(`✅ Genesis trial #${createdTrialId} created with lore "${DEFAULT_LORE}".`);

        const config = {
            hubAddress: colasseumAddress,
            colasseumAddress,
            nftAddress,
            oracleAddress,
            verifierAddress,
            debugAddress,
            timeWarpUrl: `http://127.0.0.1:${CONTROL_PORT}${TIME_WARP_PATH}`,
            logCaptureUrl: `http://127.0.0.1:${CONTROL_PORT}${LOG_CAPTURE_PATH}`,
            miladyProxyUrl: `http://127.0.0.1:${CONTROL_PORT}${MILADY_PROXY_PATH}`,
            rpcUrl: RPC_URL_LOCAL,
            chainId: 1337,
            oracleSeed,
            deployerAddress: deployer.address,
            playerAddress: PLAYER_ADDRESS,
            userWallet: USER_WALLET_ADDRESS,
            charityAddress: CHARITY_ADDRESS,
            charityGenerosityBps: CHARITY_GENEROSITY_BPS,
            ticketPriceWei: FIXED_CHANCE_PRICE.toString(),
            appraisalWei: APPRAISAL_VALUE.toString(),
            genesisTrialId: createdTrialId,
            lore: DEFAULT_LORE,
            version: Date.now()
        };
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`✅ Wrote betatype config to ${CONFIG_PATH}`);

        printInstructions(colasseumAddress, nftAddress, oracleAddress, verifierAddress, debugAddress);

        const enableLiveReload = process.env.COLASSEUM_LIVE_RELOAD !== "false";
        const LIVE_RELOAD_PORT = "3333";
        const frontendServerArgs = enableLiveReload
            ? ["browser-sync", "start", "--server", FRONTEND_DIR, "--files", "app-colasseum/index.html,app-colasseum/styles/**/*,app-colasseum/components/**/*,app-colasseum/*.js", "--no-open", "--no-ui", "--no-notify", "--port", LIVE_RELOAD_PORT]
            : ["serve", "--no-etag", FRONTEND_DIR];
        serve = spawn("npx", frontendServerArgs, { stdio: "inherit" });
        serve.on("error", (err) => {
            console.error("Failed to start web server.", err);
            cleanup();
        });
        if (enableLiveReload) {
            console.log("ℹ︎ BrowserSync live reload enabled on port 3000 (change COLASSEUM_LIVE_RELOAD=false to disable).");
        }
    } catch (error) {
        console.error("❌ Betatype setup failed:", error);
        await cleanup();
    }
};

const waitForAnvil = async (provider) => {
    for (let i = 0; i < 30; i++) {
        try {
            await provider.getNetwork();
            console.log("✅ Anvil is ready.");
            return;
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
    throw new Error("Anvil did not start within 30 seconds.");
};

const printInstructions = (colasseum, nft, oracle, verifier, debug) => {
    console.log("\n👉 IMPORTANT: export MAINNET_RPC_URL before running this script.");
    console.log("\n---------------------------------------------------------");
    console.log("        ⚔️  Colasseum Betatype Initialized  ⚔️");
    console.log("---------------------------------------------------------");
    console.log(`Colasseum address: ${colasseum}`);
    console.log(`CoolNFT address: ${nft}`);
    console.log(`MockBeaconOracle address: ${oracle}`);
    console.log(`Groth16Verifier address: ${verifier}`);
    console.log(`ColasseumDebug address: ${debug}`);
    console.log(`Control API: http://127.0.0.1:${CONTROL_PORT}${TIME_WARP_PATH}`);
    console.log(`Milady metadata proxy: http://127.0.0.1:${CONTROL_PORT}${MILADY_PROXY_PATH}`);
    console.log("\n1. Add the Anvil RPC (http://127.0.0.1:8545) to MetaMask with chainId 1337.");
    console.log("2. Import a funded Anvil key (see README) to interact with the betatype.");
        console.log(`3. Visit http://127.0.0.1:${LIVE_RELOAD_PORT} to open the betatype frontend (BrowserSync will auto-reload on frontend changes).`);
};

main();

function startControlServer(provider) {
    const server = http.createServer(async (req, res) => {
        if (req.method === "OPTIONS" && (req.url === TIME_WARP_PATH || req.url === LOG_CAPTURE_PATH)) {
            res.writeHead(204, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "POST, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type"
            });
            res.end();
            return;
        }

        if (req.method === "POST" && req.url === TIME_WARP_PATH) {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                try {
                    const data = body ? JSON.parse(body) : {};
                    const requested = typeof data.timestamp === "number" ? data.timestamp : Math.floor(Date.now() / 1000);
                    if (!Number.isFinite(requested) || requested <= 0) {
                        throw new Error("timestamp must be a positive number");
                    }
                    const latestBlock = await provider.getBlock("latest");
                    const targetTs = Math.max(Math.floor(requested), Number(latestBlock.timestamp) + 1);
                    await provider.send("evm_setNextBlockTimestamp", [targetTs]);
                    await provider.send("evm_mine", []);
                    res.writeHead(200, {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    });
                    res.end(JSON.stringify({ ok: true, timestamp: targetTs }));
                } catch (err) {
                    res.writeHead(500, {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    });
                    res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
                }
            });
            return;
        }

        if (req.method === "POST" && req.url === LOG_CAPTURE_PATH) {
            let body = "";
            req.on("data", (chunk) => (body += chunk));
            req.on("end", async () => {
                try {
                    const data = body ? JSON.parse(body) : [];
                    const existing = await readExistingLogs();
                    const combined = Array.isArray(existing) ? existing.concat(data) : data;
                    await fs.writeFile(LOG_STORE_PATH, JSON.stringify(combined, null, 2));
                    res.writeHead(200, {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    });
                    res.end(JSON.stringify({ ok: true, count: combined.length }));
                } catch (err) {
                    res.writeHead(500, {
                        "Content-Type": "application/json",
                        "Access-Control-Allow-Origin": "*"
                    });
                    res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
                }
            });
            return;
        }

        if (req.method === "GET" && req.url.startsWith(MILADY_PROXY_PATH)) {
            const requestUrl = new URL(req.url, `http://${req.headers.host}`);
            proxyMiladyResource(requestUrl, res);
            return;
        }

        res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        res.end();
    });

    server.listen(CONTROL_PORT, () => {
        console.log(`✅ Betatype control server on http://127.0.0.1:${CONTROL_PORT}`);
    });

    return server;
}

async function readExistingLogs() {
    try {
        const raw = await fs.readFile(LOG_STORE_PATH, "utf8");
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

async function proxyMiladyResource(requestUrl, res) {
    try {
        const tokenId = requestUrl.searchParams.get("tokenId");
        const contractParam = requestUrl.searchParams.get("contract");
        const resource = (requestUrl.searchParams.get("resource") || "metadata").toLowerCase();
        if (!contractParam || contractParam.toLowerCase() !== MILADY_CONTRACT_ADDRESS.toLowerCase()) {
            sendJson(res, 403, { ok: false, error: "Unsupported contract" });
            return;
        }
        if (!tokenId || !/^\d+$/.test(tokenId)) {
            sendJson(res, 400, { ok: false, error: "tokenId query param required" });
            return;
        }
        if (resource === "image") {
            await proxyMiladyImage(tokenId, res);
            return;
        }
        const payload = await fetchMiladyMetadataFromOrigin(tokenId);
        sendJson(res, 200, { ok: true, tokenId, ...payload });
    } catch (err) {
        console.error(`[MiladyProxy] ${err?.message || err}`);
        if (!res.writableEnded) {
            sendJson(res, 502, { ok: false, error: err?.message || "Failed to fetch upstream metadata" });
        }
    }
}

async function fetchMiladyMetadataFromOrigin(tokenId) {
    const metadataUrl = `${MILADY_METADATA_BASE}/${tokenId}`;
    const response = await fetch(metadataUrl, { headers: { Accept: "application/json" } });
    if (!response.ok) {
        throw new Error(`Metadata HTTP ${response.status}`);
    }
    const metadata = await response.json();
    const fallbackImage = `${MILADY_IMAGE_BASE}/${tokenId}.png`;
    const imageUrl = metadata.image || metadata.image_url || fallbackImage;
    return { metadataUrl, metadata, imageUrl };
}

async function proxyMiladyImage(tokenId, res) {
    const imageUrl = `${MILADY_IMAGE_BASE}/${tokenId}.png`;
    const upstream = await fetch(imageUrl);
    if (!upstream.ok) {
        throw new Error(`Image HTTP ${upstream.status}`);
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (res.writableEnded) return;
    res.writeHead(200, {
        "Content-Type": upstream.headers.get("content-type") || "image/png",
        "Cache-Control": "public, max-age=300",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(buffer);
}

function sendJson(res, statusCode, payload) {
    if (res.writableEnded) return;
    res.writeHead(statusCode, {
        "Content-Type": "application/json",
        "Cache-Control": statusCode === 200 ? "public, max-age=60" : "no-store",
        "Access-Control-Allow-Origin": "*"
    });
    res.end(JSON.stringify(payload));
}
