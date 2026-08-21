// The Alchemy NFT API is keyed off the same `MAINNET_RPC_URL` the chain reads use. Deriving that
// key by splitting on '/' and taking the last element — as three tools independently did — returns
// an empty string for a URL with a trailing slash or a query string. The request then 401s, the
// caller reads no data, and (before this) reported zero. Fail here instead, loudly, once.

export function alchemyKey(rpcUrl = process.env.MAINNET_RPC_URL) {
  if (!rpcUrl) throw new Error('MAINNET_RPC_URL required');
  let u;
  try { u = new URL(rpcUrl); } catch { throw new Error('MAINNET_RPC_URL is not a URL'); }
  if (!/alchemy/i.test(u.hostname)) {
    throw new Error(`MAINNET_RPC_URL host ${u.hostname} is not Alchemy; this endpoint is Alchemy-only`);
  }
  const k = u.pathname.split('/').filter(Boolean).pop();
  if (!k || k === 'v2') throw new Error('could not derive an Alchemy API key from MAINNET_RPC_URL');
  return k;
}

export const nftBase = (rpcUrl) => `https://eth-mainnet.g.alchemy.com/nft/v3/${alchemyKey(rpcUrl)}`;
