/**
 * Encode an optional user message to ride along with an on-chain ACTION (e.g. a bonding-curve buy).
 *
 * ERC404BondingInstance.buyBonding/sellBonding take a `messageData` bytes arg and, when non-empty,
 * forward it to GlobalMessageRegistry.postForAction → _post, which ABI-decodes it as the same tuple
 * a direct board post uses:
 *   (uint8 messageType, uint256 refId, bytes32 actionRef, bytes32 metadata, string content)
 * So a buy with a message posts to the collection's channel atomically with the trade. We post a
 * plain top-level message (messageType 0 = POST, no refs/metadata).
 */
import { encodeAbiParameters } from 'viem'
import { ZERO_BYTES32 } from '../components/collection/erc404/gating'

const MESSAGE_TUPLE = [
  { name: 'messageType', type: 'uint8' },
  { name: 'refId', type: 'uint256' },
  { name: 'actionRef', type: 'bytes32' },
  { name: 'metadata', type: 'bytes32' },
  { name: 'content', type: 'string' },
] as const

/** ABI-encode a POST (messageType 0) carrying `content` — the shape postForAction expects. */
export function encodeActionMessage(content: string): `0x${string}` {
  return encodeAbiParameters(MESSAGE_TUPLE, [0, 0n, ZERO_BYTES32, ZERO_BYTES32, content])
}
