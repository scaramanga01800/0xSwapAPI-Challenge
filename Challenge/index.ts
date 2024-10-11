import { config as dotenv } from "dotenv";
import {
  createWalletClient,
  http,
  getContract,
  erc20Abi,
  parseUnits,
  maxUint256,
  publicActions,
  concat,
  numberToHex,
  size,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { scroll } from "viem/chains";
import { wethAbi } from "./abi/weth-abi";
const qs = require("qs");

// Load environment variables
dotenv();
const { PRIVATE_KEY, ZERO_EX_API_KEY, ALCHEMY_HTTP_TRANSPORT_URL } = process.env;

if (!PRIVATE_KEY) throw new Error("missing PRIVATE_KEY.");
if (!ZERO_EX_API_KEY) throw new Error("missing ZERO_EX_API_KEY.");
if (!ALCHEMY_HTTP_TRANSPORT_URL) throw new Error("missing ALCHEMY_HTTP_TRANSPORT_URL.");

// Set up the wallet client
const client = createWalletClient({
  account: privateKeyToAccount(`0x${PRIVATE_KEY}` as `0x${string}`),
  chain: scroll,
  transport: http(ALCHEMY_HTTP_TRANSPORT_URL),
}).extend(publicActions);

const [address] = await client.getAddresses();

// Set up contracts
const weth = getContract({
  address: "0x5300000000000000000000000000000000000004",
  abi: wethAbi,
  client,
});
const wsteth = getContract({
  address: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32",
  abi: erc20Abi,
  client,
});

// Set up headers for requests
const headers = new Headers({
  "Content-Type": "application/json",
  "0x-api-key": ZERO_EX_API_KEY,
  "0x-version": "v2",
});

const main = async () => {
  // Specify the sell amount
  const decimals = (await weth.read.decimals()) as number;
  const sellAmount = parseUnits("0.1", decimals);

  // 1. Fetch price (including monetization parameters)
  const priceParams = new URLSearchParams({
    chainId: client.chain.id.toString(),
    sellToken: weth.address,
    buyToken: wsteth.address,
    sellAmount: sellAmount.toString(),
    taker: client.account.address,
    affiliateAddress: client.account.address, // For affiliate fees
    affiliateFeeBps: "100", // 1% affiliate fee
  });

  const priceResponse = await fetch(
    "https://api.0x.org/swap/permit2/price?" + priceParams.toString(),
    {
      headers,
    }
  );
  const price = await priceResponse.json();
  console.log("Fetching price to swap 0.1 WETH for wstETH: ", price);

  // 2. Check if the taker needs to approve Permit2
  if (price.issues.allowance !== null) {
    try {
      const { request } = await weth.simulate.approve([price.issues.allowance.spender, maxUint256]);
      const hash = await weth.write.approve(request.args);
      console.log("Approved Permit2 to spend WETH.", await client.waitForTransactionReceipt({ hash }));
    } catch (error) {
      console.log("Error approving Permit2:", error);
    }
  } else {
    console.log("WETH already approved for Permit2.");
  }

  // 3. Fetch the quote
  const quoteParams = new URLSearchParams(priceParams);
  const quoteResponse = await fetch(
    "https://api.0x.org/swap/permit2/quote?" + quoteParams.toString(),
    {
      headers,
    }
  );
  const quote = await quoteResponse.json();
  console.log("Quote for the swap: ", quote);

  // 4. Sign the permit2.eip712 message
  let signature: Hex | undefined;
  if (quote.permit2?.eip712) {
    try {
      signature = await client.signTypedData(quote.permit2.eip712);
      console.log("Signed Permit2 message from quote response.");
    } catch (error) {
      console.error("Error signing permit2 coupon:", error);
    }

    // 5. Append signature to the transaction
    if (signature && quote?.transaction?.data) {
      const signatureLengthInHex = numberToHex(size(signature), { signed: false, size: 32 });
      quote.transaction.data = concat([quote.transaction.data as Hex, signatureLengthInHex as Hex, signature as Hex]);
    } else {
      throw new Error("Failed to obtain signature or transaction data.");
    }
  }

  // 6. Submit the transaction with the Permit2 signature
  if (signature && quote.transaction.data) {
    const nonce = await client.getTransactionCount({ address: client.account.address });
    const signedTransaction = await client.signTransaction({
      account: client.account,
      chain: client.chain,
      gas: quote?.transaction?.gas ? BigInt(quote?.transaction.gas) : undefined,
      to: quote?.transaction?.to,
      data: quote.transaction.data,
      value: quote?.transaction.value ? BigInt(quote.transaction.value) : undefined,
      gasPrice: quote?.transaction.gasPrice ? BigInt(quote?.transaction.gasPrice) : undefined,
      nonce: nonce,
    });

    const hash = await client.sendRawTransaction({ serializedTransaction: signedTransaction });
    console.log(`Transaction sent successfully. See details at: https://scrollscan.com/tx/${hash}`);
  } else {
    console.error("Failed to send the transaction.");
  }

  // Fetch and display liquidity sources on Scroll
  const sourcesResponse = await fetch("https://api.0x.org/sources?chainId=534353", { headers });
  const sources = await sourcesResponse.json();
  console.log("Liquidity sources for the Scroll chain:", sources);

  // Display buy/sell taxes (if present)
  if (quote.tokenMetadata) {
    const { buyToken, sellToken } = quote.tokenMetadata;
    if (buyToken?.buyTaxBps) console.log(`Buy Tax for the token: ${buyToken.buyTaxBps / 100}%`);
    if (sellToken?.sellTaxBps) console.log(`Sell Tax for the token: ${sellToken.sellTaxBps / 100}%`);
  }
};

main();
