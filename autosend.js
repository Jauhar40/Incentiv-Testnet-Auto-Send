import blessed from "blessed";
import chalk from "chalk";
import figlet from "figlet";
import { ethers } from "ethers";
import fs from "fs";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import axios from "axios";

const RPC_URL = "https://rpc1.testnet.incentiv.io";
const BUNDLER_URL = "https://bundler-testnet.incentiv.io/";
const CHAIN_ID = 28802;
const ENTRY_POINT = ethers.utils.getAddress("0x9b5d240EF1bc8B4930346599cDDFfBD7d7D56db9");

let walletInfo = { address: "N/A", balanceTCENT: "0.0000", activeAccount: "N/A" };
let transactionLogs = [];
let accounts = [];
let proxies = [];
let recipients = [];
let selectedWalletIndex = 0;
let nonceTracker = {};
let transferRunning = false;
let transferInterval = null;
let shouldStop = false;

let transferConfig = {
    transferMode: "random",
    tcentAmount: 0.05,
    gasReserve: 0.02,
    minPercentage: 50,
    maxPercentage: 100,
    maxIterations: 0,
    currentIteration: 0,
    multiWalletMode: true
};

const CONFIG_FILE = "config.json";

const BUNDLERHEADERS = {
    "accept": "*/*",
    "accept-encoding": "gzip, deflate, br, zstd",
    "accept-language": "id,en-US;q=0.9,en;q=0.8,ja;q=0.7",
    "cache-control": "max-age=0",
    "content-type": "application/json",
    "origin": "https://testnet.incentiv.io",
    "referer": "https://testnet.incentiv.io/",
    "sec-ch-ua": '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-site",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
};

function loadConfig() {
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, "utf8");
            const config = JSON.parse(data);
            transferConfig.transferMode = config.transferMode || "random";
            transferConfig.tcentAmount = Number(config.tcentAmount) || 0.05;
            transferConfig.gasReserve = Number(config.gasReserve) || 0.02;
            transferConfig.minPercentage = Number(config.minPercentage) || 50;
            transferConfig.maxPercentage = Number(config.maxPercentage) || 100;
            transferConfig.maxIterations = Number(config.maxIterations) || 0;
            transferConfig.currentIteration = Number(config.currentIteration) || 0;
            transferConfig.multiWalletMode = config.multiWalletMode !== false;
        } else {
            addLog("No config file found, using default settings.", "info");
        }
    } catch (error) {
        addLog(`Failed to load config: ${error.message}`, "error");
    }
}

function saveConfig() {
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(transferConfig, null, 2));
        addLog("Configuration saved successfully.", "success");
    } catch (error) {
        addLog(`Failed to save config: ${error.message}`, "error");
    }
}

function loadTokens() {
    try {
        if (fs.existsSync("token.js")) {
            const tokenData = fs.readFileSync("token.js", "utf8");
            const tokens = JSON.parse(tokenData);
            addLog(`Loaded ${Object.keys(tokens).length} tokens from token.js`, "success");
            return tokens;
        } else {
            addLog("No token.js found, will perform login for all accounts.", "info");
            return {};
        }
    } catch (error) {
        addLog(`Failed to load tokens: ${error.message}`, "error");
        return {};
    }
}

function saveTokens(tokens) {
    try {
        fs.writeFileSync("token.js", JSON.stringify(tokens, null, 2));
        addLog("Tokens saved to token.js", "success");
    } catch (error) {
        addLog(`Failed to save tokens: ${error.message}`, "error");
    }
}

function getShortAddress(address) {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "N/A";
}

function addLog(message, type = "info") {
    const timestamp = new Date().toLocaleTimeString("id-ID", { timeZone: "Asia/Jakarta" });
    let coloredMessage;
    switch (type) {
        case "error": coloredMessage = chalk.redBright(message); break;
        case "success": coloredMessage = chalk.greenBright(message); break;
        case "warn": coloredMessage = chalk.magentaBright(message); break;
        case "wait": coloredMessage = chalk.yellowBright(message); break;
        case "info": coloredMessage = chalk.whiteBright(message); break;
        case "delay": coloredMessage = chalk.cyanBright(message); break;
        default: coloredMessage = chalk.white(message);
    }
    const logMessage = `[${timestamp}] ${coloredMessage}`;
    transactionLogs.push(logMessage);
    if (transactionLogs.length > 50) transactionLogs.shift();
    updateLogs();
}

function loadAccounts() {
    try {
        const data = fs.readFileSync("pk.txt", "utf8");
        const tokenData = loadTokens();
        accounts = data.split("\n").map(line => line.trim()).filter(line => line).map(privateKey => {
            const wallet = new ethers.Wallet(privateKey);
            const eoaAddress = wallet.address.toLowerCase();
            const savedToken = tokenData[eoaAddress];
            return {
                privateKey,
                smartAddress: savedToken ? savedToken.smartAddress : null,
                token: savedToken ? savedToken.token : null
            };
        });
        if (accounts.length === 0) throw new Error("No private keys found in pk.txt");
        const preActivated = accounts.filter(a => a.smartAddress && a.token).length;
        addLog(`Loaded ${accounts.length} accounts from pk.txt`, "success");
        if (preActivated > 0) {
            addLog(`${preActivated} accounts already have saved tokens`, "info");
        }
        addLog(`Multi-wallet mode: ${transferConfig.multiWalletMode ? 'ENABLED' : 'DISABLED'}`, "info");
    } catch (error) {
        addLog(`Failed to load accounts: ${error.message}`, "error");
        accounts = [];
    }
}

function loadProxies() {
    try {
        if (fs.existsSync("proxy.txt")) {
            const data = fs.readFileSync("proxy.txt", "utf8");
            proxies = data.split("\n").map(proxy => proxy.trim()).filter(proxy => proxy);
            if (proxies.length === 0) throw new Error("No proxy found in proxy.txt");
            addLog(`Loaded ${proxies.length} proxies from proxy.txt`, "success");
        } else {
            addLog("No proxy.txt found, running without proxy.", "info");
        }
    } catch (error) {
        addLog(`Failed to load proxy: ${error.message}`, "info");
        proxies = [];
    }
}

function loadRecipients() {
    try {
        if (fs.existsSync("wallet.txt")) {
            const data = fs.readFileSync("wallet.txt", "utf8");
            recipients = data.split("\n")
                .map(line => line.trim())
                .filter(line => line.length > 0 && line.startsWith("0x"))
                .map(addr => {
                    try {
                        return ethers.utils.getAddress(addr);
                    } catch (err) {
                        addLog(`Invalid address in wallet.txt ${addr} - ${err.message}`, "warn");
                        return null;
                    }
                })
                .filter(addr => addr !== null);
            if (recipients.length === 0) throw new Error("No valid recipient addresses found in wallet.txt");
            addLog(`Loaded ${recipients.length} recipient addresses from wallet.txt`, "success");
            if (transferConfig.multiWalletMode && accounts.length > 0 && accounts.length !== recipients.length) {
                addLog(`WARNING: Multi-wallet mode enabled but accounts (${accounts.length}) != recipients (${recipients.length})`, "warn");
                addLog("For proper multi-wallet operation, ensure equal number of accounts and recipients", "warn");
            }
        } else {
            addLog("No wallet.txt found, cannot perform transfers.", "error");
        }
    } catch (error) {
        addLog(`Failed to load recipients: ${error.message}`, "error");
        recipients = [];
    }
}

function createAgent(proxyUrl) {
    if (!proxyUrl) return null;
    if (proxyUrl.startsWith("socks")) {
        return new SocksProxyAgent(proxyUrl);
    } else {
        return new HttpsProxyAgent(proxyUrl);
    }
}

function getProvider(rpcUrl, chainId, proxyUrl) {
    const agent = createAgent(proxyUrl);
    const options = { pollingInterval: 500 };
    if (agent) options.fetchOptions = { agent };
    const provider = new ethers.providers.JsonRpcProvider(rpcUrl, { chainId, name: "Incentiv Testnet" }, options);
    return provider;
}

async function makeBundlerCall(method, params, proxyUrl, maxRetries = 3) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const payload = {
                jsonrpc: "2.0",
                method,
                params,
                id: Math.floor(Math.random() * 1000000)
            };
            const agent = createAgent(proxyUrl);
            const response = await axios.post(BUNDLER_URL, payload, {
                httpsAgent: agent,
                headers: BUNDLERHEADERS,
                timeout: 30000,
                validateStatus: (status) => status >= 200 && status < 300
            });
            if (response.data.error) {
                const errMsg = response.data.error.message || JSON.stringify(response.data.error);
                throw new Error(errMsg);
            }
            return response.data;
        } catch (error) {
            lastError = error;
            if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.response?.status === 502) {
                addLog(`Connection issue (attempt ${attempt}/${maxRetries}): ${error.message}`, "warn");
                if (attempt < maxRetries) {
                    await sleep(3000 * attempt);
                    continue;
                }
            }
            throw error;
        }
    }
    throw new Error(`Bundler call failed after ${maxRetries} attempts: ${lastError.message}`);
}

async function makeApiCall(url, method, data, proxyUrl, token = null) {
    try {
        let headers = {
            "accept": "*/*",
            "accept-encoding": "gzip, deflate, br, zstd",
            "connection": "keep-alive",
            "origin": "https://testnet.incentiv.io",
            "referer": "https://testnet.incentiv.io/",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36"
        };
        if (method === "POST" && data) headers["content-type"] = "application/json";
        if (token) headers["token"] = token;
        const agent = createAgent(proxyUrl);
        const response = await axios({ method, url, data, headers, httpsAgent: agent, timeout: 20000 });
        return response.data;
    } catch (error) {
        addLog(`API call failed ${url}: ${error.message}`, "error");
        throw error;
    }
}

async function sleep(ms) {
    if (shouldStop) return;
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function loginAccount(account, proxyUrl) {
    try {
        if (account.smartAddress && account.token) {
            addLog(`Account already logged in: ${getShortAddress(account.smartAddress)}`, "info");
            return;
        }
        const wallet = new ethers.Wallet(account.privateKey);
        const address = ethers.utils.getAddress(wallet.address);
        addLog(`Logging in for account ${getShortAddress(address)}`, "wait");
        const challengeRes = await makeApiCall(
            `https://api.testnet.incentiv.io/api/user/challenge?type=BROWSER_EXTENSION&address=${address}`,
            "GET", null, proxyUrl
        );
        if (!challengeRes.result || !challengeRes.result.challenge) {
            throw new Error("Challenge response invalid or address not registered. Please register on the website.");
        }
        const challenge = challengeRes.result.challenge;
        const signature = await wallet.signMessage(challenge);
        const loginPayload = { type: "BROWSER_EXTENSION", challenge, signature };
        const loginRes = await makeApiCall(
            "https://api.testnet.incentiv.io/api/user/login", "POST", loginPayload, proxyUrl
        );
        if (!loginRes.result || !loginRes.result.address || !loginRes.result.token) {
            throw new Error("Login response invalid. Please check if the address is registered.");
        }
        account.smartAddress = ethers.utils.getAddress(loginRes.result.address);
        account.token = loginRes.result.token;
        const tokenData = loadTokens();
        tokenData[address.toLowerCase()] = {
            smartAddress: account.smartAddress,
            token: account.token
        };
        saveTokens(tokenData);
        addLog(`Login Successfully, Smart Address: ${getShortAddress(account.smartAddress)}`, "success");
    } catch (error) {
        addLog(`Login failed for account: ${error.message}`, "error");
        throw error;
    }
}

function calculateRandomAmount(balance, gasReserve, minPercentage, maxPercentage) {
    const availableBalance = balance - gasReserve;
    if (availableBalance <= 0) {
        throw new Error("Insufficient balance after gas reserve");
    }
    const randomPercentage = minPercentage + Math.random() * (maxPercentage - minPercentage);
    const amount = (availableBalance * randomPercentage) / 100;
    return Number(amount.toFixed(6));
}

async function performTransfer(account, amount, recipientAddress, proxyUrl, provider) {
    const code = await provider.getCode(account.smartAddress);
    const isDeployed = code !== "0x";
    if (!isDeployed) {
        addLog(`Wallet ${getShortAddress(account.smartAddress)} not deployed - SKIPPING (needs first transaction from website)`, "warn");
        throw new Error("Wallet not deployed - please make first transaction from website to deploy smart wallet");
    }
    addLog(`Smart wallet is deployed - proceeding with transfer`, "success");
    const transferAmount = ethers.utils.parseEther(amount.toString());
    const currentBalance = await provider.getBalance(account.smartAddress);
    if (currentBalance.lt(transferAmount.add(ethers.utils.parseEther("0.01")))) {
        throw new Error("Insufficient TCENT balance for transfer and gas");
    }
    if (!recipientAddress || !ethers.utils.isAddress(recipientAddress)) {
        throw new Error("Invalid recipient address");
    }
    if (recipientAddress.toLowerCase() === account.smartAddress.toLowerCase()) {
        throw new Error("Cannot transfer to self");
    }
    addLog(`Transferring ${amount} TCENT to ${getShortAddress(recipientAddress)}`, "warn");
    let currentNonce;
    try {
        const entryPointContract = new ethers.Contract(
            ENTRY_POINT,
            ["function getNonce(address sender, uint192 key) view returns (uint256)"],
            provider
        );
        const nonce = await entryPointContract.getNonce(account.smartAddress, 0);
        if (!nonceTracker[account.smartAddress]) {
            nonceTracker[account.smartAddress] = nonce;
        } else {
            nonceTracker[account.smartAddress] = ethers.BigNumber.from(nonceTracker[account.smartAddress]);
            if (nonceTracker[account.smartAddress].lt(nonce)) {
                nonceTracker[account.smartAddress] = nonce;
            }
        }
        currentNonce = nonceTracker[account.smartAddress];
    } catch (nonceError) {
        throw nonceError;
    }
    const executeAbi = ["function execute(address target, uint256 value, bytes data)"];
    const executeInterface = new ethers.utils.Interface(executeAbi);
    const callData = executeInterface.encodeFunctionData("execute", [
        recipientAddress,
        transferAmount,
        "0x"
    ]);
    const userOp = {
        sender: account.smartAddress,
        nonce: ethers.utils.hexValue(currentNonce),
        callData: callData,
        signature: "0xfffffffffffffffffffffffffffffff0000000000000000000000000000000007aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1c"
    };
    try {
        addLog(`Estimating gas for transfer...`, "wait");
        const gasEstimate = await makeBundlerCall("eth_estimateUserOperationGas", [userOp, ENTRY_POINT], proxyUrl, 3);
        if (!gasEstimate.result) {
            throw new Error(`Gas estimation failed: ${JSON.stringify(gasEstimate)}`);
        }
        addLog(`Gas estimation successful!`, "success");
        const feeData = await provider.getFeeData();
        const maxFeePerGas = feeData?.maxFeePerGas || ethers.utils.parseUnits("1.5", "gwei");
        const maxPriorityFeePerGas = feeData?.maxPriorityFeePerGas || ethers.utils.parseUnits("1.0", "gwei");
        const completeUserOp = {
            sender: account.smartAddress,
            nonce: ethers.utils.hexValue(currentNonce),
            callData: callData,
            callGasLimit: gasEstimate.result.callGasLimit,
            verificationGasLimit: gasEstimate.result.verificationGasLimit,
            preVerificationGas: gasEstimate.result.preVerificationGas,
            maxFeePerGas: ethers.utils.hexValue(maxFeePerGas),
            maxPriorityFeePerGas: ethers.utils.hexValue(maxPriorityFeePerGas),
            signature: "0x"
        };
        const wallet = new ethers.Wallet(account.privateKey);
        const entryPointContract = new ethers.Contract(
            ENTRY_POINT,
            ["function getUserOpHash(tuple(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature) userOp) view returns (bytes32)"],
            provider
        );
        const userOpForHash = {
            sender: completeUserOp.sender,
            nonce: ethers.BigNumber.from(completeUserOp.nonce),
            initCode: "0x",
            callData: completeUserOp.callData,
            accountGasLimits: ethers.utils.hexConcat([
                ethers.utils.hexZeroPad(completeUserOp.verificationGasLimit, 16),
                ethers.utils.hexZeroPad(completeUserOp.callGasLimit, 16)
            ]),
            preVerificationGas: ethers.BigNumber.from(completeUserOp.preVerificationGas),
            gasFees: ethers.utils.hexConcat([
                ethers.utils.hexZeroPad(completeUserOp.maxPriorityFeePerGas, 16),
                ethers.utils.hexZeroPad(completeUserOp.maxFeePerGas, 16)
            ]),
            paymasterAndData: "0x",
            signature: "0x"
        };
        const userOpHash = await entryPointContract.getUserOpHash(userOpForHash);
        const signature = await wallet.signMessage(ethers.utils.arrayify(userOpHash));
        completeUserOp.signature = signature;
        addLog(`UserOp for deployed wallet ready, submitting...`, "info");
        const bundlerResponse = await makeBundlerCall("eth_sendUserOperation", [completeUserOp, ENTRY_POINT], proxyUrl, 3);
        if (!bundlerResponse.result) {
            throw new Error(`Transfer failed: ${JSON.stringify(bundlerResponse)}`);
        }
        const txHash = bundlerResponse.result;
        addLog(`Transfer submitted successfully. Hash: ${getShortHash(txHash)}`, "success");
        nonceTracker[account.smartAddress] = currentNonce.add(1);
        return txHash;
    } catch (error) {
        addLog(`Transfer failed: ${error.message}`, "error");
        throw error;
    }
}

function getShortHash(hash) {
    return `${hash.slice(0, 6)}...${hash.slice(-4)}`;
}

async function runAutoTransfer() {
    if (accounts.length === 0) {
        addLog("No valid accounts found.", "error");
        return;
    }
    const activeAccounts = accounts.filter(a => a.smartAddress);
    if (activeAccounts.length === 0) {
        addLog("No active accounts found. Please activate accounts first.", "error");
        return;
    }
    if (recipients.length === 0) {
        addLog("No recipient addresses found. Please check wallet.txt file.", "error");
        return;
    }
    if (transferConfig.multiWalletMode && activeAccounts.length !== recipients.length) {
        addLog("ERROR: Multi-wallet mode requires equal number of accounts and recipients!", "error");
        addLog(`Active accounts: ${activeAccounts.length}, Recipients: ${recipients.length}`, "error");
        addLog("Please fix pk.txt and wallet.txt files to have matching entries", "error");
        return;
    }
    if (transferConfig.maxIterations > 0 && transferConfig.currentIteration >= transferConfig.maxIterations) {
        addLog(`Maximum iterations (${transferConfig.maxIterations}) reached. Stopping auto transfer.`, "warn");
        transferRunning = false;
        updateStatus();
        safeRender();
        return;
    }
    transferConfig.currentIteration++;
    saveConfig();
    addLog(`=== STARTING ITERATION ${transferConfig.currentIteration} ===`, "info");
    addLog(`Active accounts: ${activeAccounts.length}`, "info");
    addLog(`Recipients: ${recipients.length}`, "info");
    addLog(`Transfer mode: ${transferConfig.transferMode}`, "info");
    addLog(`Multi-wallet mode: ${transferConfig.multiWalletMode ? "ENABLED" : "DISABLED"}`, "info");
    if (transferConfig.transferMode === "random") {
        addLog(`Random amount: ${transferConfig.minPercentage}% - ${transferConfig.maxPercentage}% of balance (minus ${transferConfig.gasReserve} TCENT gas reserve)`, "info");
    }
    addLog(`IMPORTANT: Only deployed wallets will be processed. Undeployed wallets will be skipped.`, "warn");
    addLog(`To deploy wallet: Make at least one transaction from the Incentiv website first.`, "info");
    transferRunning = true;
    shouldStop = false;
    updateMenu();
    let transferErrors = 0;
    try {
        for (let accountIndex = 0; accountIndex < accounts.length && !shouldStop; accountIndex++) {
            try {
                const account = accounts[accountIndex];
                const proxyUrl = proxies[accountIndex % proxies.length] || null;
                const provider = getProvider(RPC_URL, CHAIN_ID, proxyUrl);
                addLog(`Starting processing for account ${accountIndex + 1}`, "info");
                if (!account.smartAddress) {
                    try {
                        await loginAccount(account, proxyUrl);
                    } catch (e) {
                        addLog(`Skipping account ${accountIndex + 1}: Login failed`, "error");
                        transferErrors++;
                        continue;
                    }
                }
                addLog(`Processing account ${accountIndex + 1}: ${getShortAddress(account.smartAddress)}`, "wait");
                let targetRecipient;
                if (transferConfig.multiWalletMode) {
                    if (accountIndex < recipients.length) {
                        targetRecipient = recipients[accountIndex];
                        addLog(`Multi-wallet mode: Account ${accountIndex + 1} -> Recipient ${accountIndex + 1} (${getShortAddress(targetRecipient)})`, "info");
                    } else {
                        addLog(`Account ${accountIndex + 1}: No matching recipient found. Skipping.`, "warn");
                        continue;
                    }
                } else {
                    let recipientIndex;
                    do {
                        recipientIndex = Math.floor(Math.random() * recipients.length);
                    } while (recipients[recipientIndex].toLowerCase() === account.smartAddress.toLowerCase());
                    targetRecipient = recipients[recipientIndex];
                    addLog(`Random mode: Account ${accountIndex + 1} -> Random recipient (${getShortAddress(targetRecipient)})`, "info");
                }
                let amount;
                const currentBalance = await provider.getBalance(account.smartAddress);
                const currentBalanceFormatted = Number(ethers.utils.formatEther(currentBalance));
                if (transferConfig.transferMode === "fixed") {
                    amount = transferConfig.tcentAmount.toFixed(3);
                    addLog(`Account ${accountIndex + 1}: Transferring ${amount} TCENT (Fixed Amount)`, "warn");
                } else if (transferConfig.transferMode === "random") {
                    if (currentBalanceFormatted < transferConfig.gasReserve + 0.001) {
                        addLog(`Account ${accountIndex + 1}: Insufficient balance (${currentBalanceFormatted.toFixed(4)} TCENT). Skipping.`, "warn");
                        continue;
                    }
                    try {
                        amount = calculateRandomAmount(
                            currentBalanceFormatted,
                            transferConfig.gasReserve,
                            transferConfig.minPercentage,
                            transferConfig.maxPercentage
                        );
                        const percentage = ((amount / (currentBalanceFormatted - transferConfig.gasReserve)) * 100).toFixed(1);
                        addLog(`Account ${accountIndex + 1}: Transferring ${amount} TCENT (${percentage}% of available balance, Random Amount)`, "warn");
                    } catch (error) {
                        addLog(`Account ${accountIndex + 1}: ${error.message}. Skipping.`, "warn");
                        continue;
                    }
                } else {
                    if (currentBalanceFormatted < transferConfig.gasReserve + 0.001) {
                        addLog(`Account ${accountIndex + 1}: Insufficient balance (${currentBalanceFormatted.toFixed(4)} TCENT). Skipping.`, "warn");
                        continue;
                    }
                    const transferAmount = Math.max(0, currentBalanceFormatted - transferConfig.gasReserve);
                    amount = transferAmount.toFixed(3);
                    addLog(`Account ${accountIndex + 1}: Transferring ${amount} TCENT (Send All, Reserve: ${transferConfig.gasReserve})`, "warn");
                }
                try {
                    await performTransfer(account, amount, targetRecipient, proxyUrl, provider);
                } catch (error) {
                    addLog(`Account ${accountIndex + 1}: Transfer Failed: ${error.message}. Skipping to next.`, "error");
                    transferErrors++;
                }
                await updateWallets();
                if (accountIndex < accounts.length - 1 && !shouldStop) {
                    addLog("Waiting 30 seconds before next account...", "delay");
                    await sleep(30000);
                }
            } catch (accountError) {
                transferErrors++;
                addLog(`Error processing account ${accountIndex + 1}: ${accountError.message}. Skipping to next account.`, "error");
                if (accountIndex < accounts.length - 1 && !shouldStop) {
                    await sleep(10000);
                }
            }
        }
        addLog(`=== ITERATION ${transferConfig.currentIteration} COMPLETED ===`, "info");
        if (transferErrors > 0) {
            addLog(`Iteration completed with ${transferErrors} errors.`, "warn");
        } else {
            addLog(`Iteration completed successfully!`, "success");
        }
        if (!shouldStop) {
            if (transferConfig.maxIterations > 0 && transferConfig.currentIteration >= transferConfig.maxIterations) {
                addLog(`Maximum iterations (${transferConfig.maxIterations}) reached. Auto transfer completed.`, "success");
            } else {
                addLog("Starting next iteration immediately...", "info");
                setTimeout(runAutoTransfer, 1000);
            }
        }
    } catch (error) {
        addLog(`Auto transfer failed: ${error.message}`, "error");
    } finally {
        if (shouldStop) {
            if (transferInterval) {
                clearTimeout(transferInterval);
                transferInterval = null;
            }
            transferRunning = false;
            shouldStop = false;
            addLog("Auto transfer stopped successfully.", "success");
            updateMenu();
            updateStatus();
            safeRender();
        } else {
            if (transferConfig.maxIterations <= 0 || transferConfig.currentIteration < transferConfig.maxIterations) {
                updateMenu();
                updateStatus();
                safeRender();
            } else {
                transferRunning = false;
                updateMenu();
                updateStatus();
                safeRender();
            }
        }
        nonceTracker = {};
    }
}

// ============ UI LAYOUT OPTIMIZED ============
const screen = blessed.screen({
    smartCSR: true,
    title: "INCENTIV TESTNET V2"
});

const headerBox = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 6,
    content: "",
    tags: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "cyan" } }
});

const menuBox = blessed.list({
    label: " Main Menu ",
    top: 6,
    left: 0,
    width: "30%",  // Diperkecil dari 40 ke 30%
    height: "56%",
    keys: true,
    vi: true,
    mouse: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "cyan" }, selected: { bg: "cyan", fg: "black" }, item: { fg: "white" } },
    items: [
        "Active All Account",
        "Start Auto Transfer",
        "Stop Auto Transfer",
        "Set Transfer Config",
        "Toggle Transfer Mode",
        "Toggle Multi-Wallet Mode",
        "Set Random Percentage Range",
        "Set Max Iterations",
        "Reset Iteration Counter",
        "Refresh",
        "Clear Logs",
        "Exit"
    ],
    padding: { left: 1, top: 1 },
    hidden: false
});

const walletBox = blessed.list({
    label: " Wallet Information ",
    top: 6,
    left: "30%",  // Sesuaikan dari 40 ke 30%
    width: "70%",  // Diperbesar dari 60%-40 ke 70%
    height: "56%",
    keys: true,
    vi: true,
    mouse: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "magenta" } },
    padding: { left: 1, top: 1 }
});

const statusBox = blessed.box({
    label: " Status ",
    top: "62%",
    left: 0,
    width: "100%",
    height: 5,  // Diperkecil dari 6 ke 5
    content: "",
    tags: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "cyan" } },
    padding: { left: 1, top: 1 }
});

const logBox = blessed.log({
    label: " Transaction Logs ",
    bottom: 0,
    left: 0,
    width: "100%",
    height: "33%",  // Diperbesar dari 32% ke 33%
    keys: true,
    vi: true,
    mouse: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "magenta" } },
    scrollable: true,
    alwaysScroll: true,
    padding: { left: 1, top: 1 }
});

const configForm = blessed.form({
    label: " Enter Transfer Amount (TCENT) ",
    top: "center",
    left: "center",
    width: 35,
    height: 15,
    keys: true,
    mouse: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "blue" } },
    padding: { left: 1, top: 1 },
    hidden: true
});

const configInput = blessed.textbox({
    parent: configForm,
    top: 1,
    left: 1,
    width: "90%",
    height: 3,
    inputOnFocus: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "white" }, focus: { border: { fg: "green" } } }
});

const iterationForm = blessed.form({
    label: " Set Max Iterations (0 = Unlimited) ",
    top: "center",
    left: "center",
    width: 40,
    height: 15,
    keys: true,
    mouse: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "blue" } },
    padding: { left: 1, top: 1 },
    hidden: true
});

const iterationInput = blessed.textbox({
    parent: iterationForm,
    top: 1,
    left: 1,
    width: "90%",
    height: 3,
    inputOnFocus: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "white" }, focus: { border: { fg: "green" } } }
});

const percentageForm = blessed.form({
    label: " Set Random Percentage Range (Min%-Max%) ",
    top: "center",
    left: "center",
    width: 50,
    height: 18,
    keys: true,
    mouse: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "blue" } },
    padding: { left: 1, top: 1 },
    hidden: true
});

const minPercentageInput = blessed.textbox({
    parent: percentageForm,
    label: "Min %:",
    top: 1,
    left: 1,
    width: "90%",
    height: 3,
    inputOnFocus: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "white" }, focus: { border: { fg: "green" } } }
});

const maxPercentageInput = blessed.textbox({
    parent: percentageForm,
    label: "Max %:",
    top: 5,
    left: 1,
    width: "90%",
    height: 3,
    inputOnFocus: true,
    border: { type: "line" },
    style: { fg: "white", bg: "default", border: { fg: "white" }, focus: { border: { fg: "green" } } }
});

screen.append(headerBox);
screen.append(menuBox);
screen.append(walletBox);
screen.append(statusBox);
screen.append(logBox);
screen.append(configForm);
screen.append(iterationForm);
screen.append(percentageForm);

async function updateWalletData() {
    const walletDataPromises = accounts.map(async (account, i) => {
        try {
            const proxyUrl = proxies[i % proxies.length] || null;
            const provider = getProvider(RPC_URL, CHAIN_ID, proxyUrl);
            let formattedEntry;
            let shortAddr;
            let tcentBal = "0.000000";
            if (account.smartAddress) {
                shortAddr = getShortAddress(account.smartAddress);
                const nativeBalance = await provider.getBalance(account.smartAddress);
                tcentBal = Number(ethers.utils.formatEther(nativeBalance)).toFixed(2);
                const code = await provider.getCode(account.smartAddress);
                const isDeployed = code !== "0x";
                let recipientInfo = "";
                if (transferConfig.multiWalletMode && i < recipients.length) {
                    recipientInfo = ` -> ${getShortAddress(recipients[i])}`;
                }
                formattedEntry = i === selectedWalletIndex
                    ? `${chalk.bold.magentaBright(shortAddr)} ${chalk.bold.cyanBright(tcentBal.padEnd(10))} ${isDeployed ? chalk.green("✓") : chalk.red("✗")}${chalk.yellow(recipientInfo)}`
                    : `${shortAddr} ${tcentBal.padEnd(10)} ${isDeployed ? chalk.green("✓") : chalk.red("✗")}${chalk.gray(recipientInfo)}`;
            } else {
                const wallet = new ethers.Wallet(account.privateKey);
                shortAddr = getShortAddress(wallet.address);
                formattedEntry = i === selectedWalletIndex
                    ? `${chalk.bold.magentaBright(shortAddr)} Not Logged In`
                    : `${shortAddr} Not Logged In`;
            }
            if (i === selectedWalletIndex) {
                walletInfo.address = shortAddr;
                walletInfo.activeAccount = `Account ${i + 1}`;
                walletInfo.balanceTCENT = tcentBal;
            }
            return formattedEntry;
        } catch (error) {
            addLog(`Failed to fetch wallet data for account ${i + 1}: ${error.message}`, "error");
            return i === selectedWalletIndex ? "N/A 0.000000" : "N/A 0.000000";
        }
    });
    try {
        const walletData = await Promise.all(walletDataPromises);
        addLog("Wallet data updated.", "success");
        return walletData;
    } catch (error) {
        addLog(`Wallet data update failed: ${error.message}`, "error");
        return [];
    }
}

async function updateWallets() {
    try {
        const walletData = await updateWalletData();
        const header = transferConfig.multiWalletMode
            ? `${chalk.bold.cyan("Smart Address".padEnd(20))} ${chalk.bold.cyan("TCENT".padEnd(10))} ${chalk.bold.cyan("Status")} ${chalk.bold.cyan("-> Recipient")}`
            : `${chalk.bold.cyan("Smart Address".padEnd(20))} ${chalk.bold.cyan("TCENT".padEnd(10))} ${chalk.bold.cyan("Status")}`;
        const separator = chalk.gray("-".repeat(70));
        walletBox.setItems([header, separator, ...walletData]);
        walletBox.select(0);
        safeRender();
    } catch (error) {
        addLog(`Failed to update wallet data: ${error.message}`, "error");
    }
}

function updateStatus() {
    try {
        const status = transferRunning ? chalk.yellowBright("Running") : chalk.green("Idle");
        let modeText;
        if (transferConfig.transferMode === "fixed") {
            modeText = `Fixed: ${transferConfig.tcentAmount} TCENT`;
        } else if (transferConfig.transferMode === "random") {
            modeText = `Random: ${transferConfig.minPercentage}-${transferConfig.maxPercentage}% (Gas: ${transferConfig.gasReserve})`;
        } else {
            modeText = `All (Reserve: ${transferConfig.gasReserve})`;
        }
        const multiWalletText = transferConfig.multiWalletMode ? "Multi-Wallet" : "Random";
        const iterationText = transferConfig.maxIterations > 0
            ? `${transferConfig.currentIteration}/${transferConfig.maxIterations}`
            : `${transferConfig.currentIteration}/∞`;
        const statusText = `Status: ${status} | Active Account: ${getShortAddress(walletInfo.address)} | Total Accounts: ${accounts.length} | Transfer: ${modeText} | Mode: ${multiWalletText} | Iteration: ${iterationText}`;
        statusBox.setContent(statusText);
        safeRender();
    } catch (error) {
        addLog(`Status update error: ${error.message}`, "error");
    }
}

function updateLogs() {
    try {
        logBox.add(transactionLogs.length > 0 ? transactionLogs[transactionLogs.length - 1] : chalk.gray("No logs available."));
        logBox.scrollTo(transactionLogs.length);
        safeRender();
    } catch (error) {
        addLog(`Log update failed: ${error.message}`, "error");
    }
}

function updateMenu() {
    const transferModeLabel = transferConfig.transferMode === "fixed"
        ? "Fixed Amount"
        : transferConfig.transferMode === "random"
        ? "Random Amount"
        : "Send All";
    const items = [
        "Active All Account",
        transferRunning ? "Stop Auto Transfer" : "Start Auto Transfer",
        "Set Transfer Config",
        `Toggle Transfer Mode (${transferModeLabel})`,
        `Toggle Multi-Wallet Mode (${transferConfig.multiWalletMode ? "Enabled" : "Disabled"})`,
        "Set Random Percentage Range",
        "Set Max Iterations",
        "Reset Iteration Counter",
        "Refresh",
        "Clear Logs",
        "Exit"
    ];
    menuBox.setItems(items);
    safeRender();
}

function clearTransactionLogs() {
    transactionLogs = [];
    logBox.setContent("");
    logBox.scrollTo(0);
    addLog("Transaction logs cleared.", "success");
}

function toggleMultiWalletMode() {
    transferConfig.multiWalletMode = !transferConfig.multiWalletMode;
    addLog(`Multi-wallet mode ${transferConfig.multiWalletMode ? "ENABLED" : "DISABLED"}`, "success");
    if (transferConfig.multiWalletMode) {
        addLog("Multi-wallet mode: Each account will send to corresponding recipient by index", "info");
        addLog("Ensure pk.txt and wallet.txt have equal number of entries", "warn");
    } else {
        addLog("Multi-wallet mode disabled: Recipients will be chosen randomly", "info");
    }
    saveConfig();
    updateMenu();
    updateStatus();
    updateWallets();
}

function toggleTransferMode() {
    if (transferConfig.transferMode === "fixed") {
        transferConfig.transferMode = "random";
    } else if (transferConfig.transferMode === "random") {
        transferConfig.transferMode = "all";
    } else {
        transferConfig.transferMode = "fixed";
    }
    addLog(`Transfer mode switched to: ${transferConfig.transferMode}`, "success");
    saveConfig();
    updateMenu();
    updateStatus();
}

function resetIterationCounter() {
    transferConfig.currentIteration = 0;
    saveConfig();
    addLog("Iteration counter reset to 0", "success");
    updateStatus();
}

function showPercentageForm() {
    percentageForm.show();
    minPercentageInput.clearValue();
    maxPercentageInput.clearValue();
    minPercentageInput.setValue(transferConfig.minPercentage.toString());
    maxPercentageInput.setValue(transferConfig.maxPercentage.toString());
    setTimeout(() => {
        if (percentageForm.visible) {
            screen.focusPush(minPercentageInput);
            safeRender();
        }
    }, 100);
}

menuBox.on("select", async (item) => {
    const action = item.getText();
    switch (action) {
        case "Active All Account":
            await activeAllAccounts();
            break;
        case "Start Auto Transfer":
            if (!transferRunning) {
                await runAutoTransfer();
            }
            break;
        case "Stop Auto Transfer":
            if (transferRunning) {
                shouldStop = true;
                addLog("Stopping auto transfer. Please wait for ongoing processes to complete.", "info");
            }
            break;
        case "Set Transfer Config":
            showConfigForm();
            break;
        case "Toggle Transfer Mode (Fixed Amount)":
        case "Toggle Transfer Mode (Random Amount)":
        case "Toggle Transfer Mode (Send All)":
            toggleTransferMode();
            break;
        case "Toggle Multi-Wallet Mode (Enabled)":
        case "Toggle Multi-Wallet Mode (Disabled)":
            toggleMultiWalletMode();
            break;
        case "Set Random Percentage Range":
            showPercentageForm();
            break;
        case "Set Max Iterations":
            showIterationForm();
            break;
        case "Reset Iteration Counter":
            resetIterationCounter();
            break;
        case "Refresh":
            await updateWallets();
            addLog("Data refreshed.", "success");
            break;
        case "Clear Logs":
            clearTransactionLogs();
            break;
        case "Exit":
            addLog("Exiting application", "info");
            process.exit(0);
    }
});

function showConfigForm() {
    configForm.show();
    configInput.clearValue();
    configInput.setValue(transferConfig.tcentAmount.toString());
    setTimeout(() => {
        if (configForm.visible) {
            screen.focusPush(configInput);
            safeRender();
        }
    }, 100);
}

function showIterationForm() {
    iterationForm.show();
    iterationInput.clearValue();
    iterationInput.setValue(transferConfig.maxIterations.toString());
    setTimeout(() => {
        if (iterationForm.visible) {
            screen.focusPush(iterationInput);
            safeRender();
        }
    }, 100);
}

configForm.on("submit", () => {
    const value = parseFloat(configInput.getValue().trim());
    if (isNaN(value) || value <= 0) {
        addLog("Invalid input. Please enter a positive number.", "error");
        configInput.clearValue();
        return;
    }
    transferConfig.tcentAmount = Number(value.toFixed(3));
    addLog(`Transfer Amount set to ${transferConfig.tcentAmount} TCENT`, "success");
    saveConfig();
    configForm.hide();
    menuBox.show();
    setTimeout(() => {
        if (menuBox.visible) {
            screen.focusPush(menuBox);
            safeRender();
        }
    }, 100);
});

iterationForm.on("submit", () => {
    const value = parseInt(iterationInput.getValue().trim());
    if (isNaN(value) || value < 0) {
        addLog("Invalid input. Please enter a non-negative integer.", "error");
        iterationInput.clearValue();
        return;
    }
    transferConfig.maxIterations = value;
    addLog(`Max iterations set to ${transferConfig.maxIterations === 0 ? "Unlimited" : transferConfig.maxIterations}`, "success");
    saveConfig();
    iterationForm.hide();
    menuBox.show();
    setTimeout(() => {
        if (menuBox.visible) {
            screen.focusPush(menuBox);
            safeRender();
            updateStatus();
        }
    }, 100);
});

percentageForm.on("submit", () => {
    const minValue = parseFloat(minPercentageInput.getValue().trim());
    const maxValue = parseFloat(maxPercentageInput.getValue().trim());
    if (isNaN(minValue) || isNaN(maxValue) || minValue < 0 || maxValue > 100 || minValue > maxValue) {
        addLog("Invalid input. Min must be >= 0, Max must be <= 100, and Min must be <= Max.", "error");
        return;
    }
    transferConfig.minPercentage = minValue;
    transferConfig.maxPercentage = maxValue;
    addLog(`Random percentage range set to ${transferConfig.minPercentage}% - ${transferConfig.maxPercentage}%`, "success");
    saveConfig();
    percentageForm.hide();
    menuBox.show();
    setTimeout(() => {
        if (menuBox.visible) {
            screen.focusPush(menuBox);
            safeRender();
            updateStatus();
        }
    }, 100);
});

configInput.key("enter", () => { configForm.submit(); });
iterationInput.key("enter", () => { iterationForm.submit(); });
minPercentageInput.key("enter", () => { screen.focusPush(maxPercentageInput); });
maxPercentageInput.key("enter", () => { percentageForm.submit(); });

configForm.key("escape", () => {
    configForm.hide();
    menuBox.show();
    setTimeout(() => {
        if (menuBox.visible) {
            screen.focusPush(menuBox);
            safeRender();
        }
    }, 100);
});

iterationForm.key("escape", () => {
    iterationForm.hide();
    menuBox.show();
    setTimeout(() => {
        if (menuBox.visible) {
            screen.focusPush(menuBox);
            safeRender();
        }
    }, 100);
});

percentageForm.key("escape", () => {
    percentageForm.hide();
    menuBox.show();
    setTimeout(() => {
        if (menuBox.visible) {
            screen.focusPush(menuBox);
            safeRender();
        }
    }, 100);
});

async function activeAllAccounts() {
    if (accounts.length === 0) {
        addLog("No valid accounts found.", "error");
        return;
    }
    const accountsToActivate = accounts.filter(a => !a.smartAddress || !a.token);
    const alreadyActivated = accounts.length - accountsToActivate.length;
    if (alreadyActivated > 0) {
        addLog(`${alreadyActivated} accounts already activated (loaded from token.js)`, "info");
    }
    if (accountsToActivate.length === 0) {
        addLog("All accounts are already activated.", "success");
        await updateWallets();
        return;
    }
    addLog(`Starting activation for ${accountsToActivate.length} remaining accounts.`, "info");
    let activationErrors = 0;
    try {
        for (let i = 0; i < accounts.length; i++) {
            const account = accounts[i];
            if (account.smartAddress && account.token) {
                continue;
            }
            const proxyUrl = proxies[i % proxies.length] || null;
            const wallet = new ethers.Wallet(account.privateKey);
            const eoaAddress = wallet.address;
            try {
                addLog(`Processing activation for account ${i + 1}: ${getShortAddress(eoaAddress)}`, "wait");
                addLog(`Account ${i + 1}: Using Proxy: ${proxyUrl || "none"}`, "info");
                await loginAccount(account, proxyUrl);
                if (i < accounts.length - 1) {
                    await sleep(2000);
                }
            } catch (accountError) {
                activationErrors++;
                addLog(`Activation failed for account ${i + 1}: ${accountError.message}. Skipping to next account.`, "error");
                if (i < accounts.length - 1) {
                    await sleep(2000);
                }
            }
        }
        await updateWallets();
        if (activationErrors > 0) {
            addLog(`Activation completed with ${activationErrors} errors.`, "warn");
        } else {
            addLog("All remaining accounts activated successfully.", "success");
        }
    } catch (error) {
        addLog(`Unexpected error during activation: ${error.message}`, "error");
    }
}

screen.key(["escape", "q", "C-c"], () => {
    addLog("Exiting application", "info");
    process.exit(0);
});

let renderQueue = [];
let isRendering = false;

function safeRender() {
    renderQueue.push(true);
    if (isRendering) return;
    isRendering = true;
    setTimeout(() => {
        try {
            screen.render();
        } catch (error) {
            addLog(`UI render error: ${error.message}`, "error");
        }
        renderQueue.shift();
        isRendering = false;
        if (renderQueue.length > 0) safeRender();
    }, 50);
}

async function initialize() {
    try {
        loadConfig();
        loadAccounts();
        loadProxies();
        loadRecipients();
        updateMenu();
        updateStatus();
        await updateWallets();
        updateLogs();
        safeRender();
        
        // Header simple dan jelas
        headerBox.setContent(
            `{center}${chalk.bold.cyan('╔═══════════════════════════════════════════════╗')}\n` +
            `${chalk.bold.cyan('║')}      ${chalk.bold.cyanBright('INCENTIV TESTNET V2')}           ${chalk.bold.cyan('║')}\n` +
            `${chalk.bold.cyan('║')}            ${chalk.bold.yellow('Auto Send')}                ${chalk.bold.cyan('║')}\n` +
            `${chalk.bold.cyan('╚═══════════════════════════════════════════════╝')}{/center}`
        );
        safeRender();
        
        menuBox.focus();
    } catch (error) {
        addLog(`Initialization error: ${error.message}`, "error");
    }
    setInterval(() => { updateStatus(); }, 1000);
}

initialize();
