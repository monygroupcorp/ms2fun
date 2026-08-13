// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Hooks } from "v4-core/libraries/Hooks.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

/**
 * @title HookAddressMiner
 * @notice Utility library for computing CREATE2 salts that produce valid Uniswap v4 hook addresses
 * @dev Uniswap v4 encodes hook permissions in the hook contract address. This library helps
 *      find salts that produce addresses with the required permission bits set.
 *
 * CRITICAL: Uniswap v4's validateHookPermissions() requires an EXACT match:
 *   - Required flags MUST be set
 *   - All other flags MUST NOT be set
 *
 * Hook Permission Bits (from Hooks.sol):
 *   BEFORE_INITIALIZE_FLAG = 1 << 13
 *   AFTER_INITIALIZE_FLAG = 1 << 12
 *   BEFORE_ADD_LIQUIDITY_FLAG = 1 << 11
 *   AFTER_ADD_LIQUIDITY_FLAG = 1 << 10
 *   BEFORE_REMOVE_LIQUIDITY_FLAG = 1 << 9
 *   AFTER_REMOVE_LIQUIDITY_FLAG = 1 << 8
 *   BEFORE_SWAP_FLAG = 1 << 7
 *   AFTER_SWAP_FLAG = 1 << 6
 *   BEFORE_DONATE_FLAG = 1 << 5
 *   AFTER_DONATE_FLAG = 1 << 4
 *   BEFORE_SWAP_RETURNS_DELTA_FLAG = 1 << 3
 *   AFTER_SWAP_RETURNS_DELTA_FLAG = 1 << 2
 *   AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 1
 *   AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG = 1 << 0
 *
 * For UniAlignmentV4Hook, we need:
 *   - BEFORE_SWAP_FLAG = 0x80 (1 << 7) — dynamic LP fee override + ETH-input fee take
 *   - AFTER_SWAP_FLAG = 0x40 (1 << 6)
 *   - BEFORE_SWAP_RETURNS_DELTA_FLAG = 0x08 (1 << 3) — ETH-input fee settles on the specified currency
 *   - AFTER_SWAP_RETURNS_DELTA_FLAG = 0x04 (1 << 2)
 *   - Combined: 0xCC
 *   - All other flags must be 0
 */
library HookAddressMiner {
    /// @notice All possible hook permission flags combined (bits 0-13)
    uint160 constant ALL_HOOK_FLAGS = uint160(
        Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_ADD_LIQUIDITY_FLAG
            | Hooks.AFTER_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG
            | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_DONATE_FLAG | Hooks.AFTER_DONATE_FLAG
            | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG
    ); // = 0x3FFF (bits 0-13)

    /// @notice Hook flags for UniAlignmentV4Hook
    /// beforeSwap (bit 7) + afterSwap (bit 6) + beforeSwapReturnDelta (bit 3) + afterSwapReturnDelta (bit 2)
    uint160 constant ULTRA_ALIGNMENT_HOOK_FLAGS = uint160(
        Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
            | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG
    ); // = 0xCC

    /// @notice Flags that must NOT be set for UniAlignmentV4Hook
    uint160 constant ULTRA_ALIGNMENT_FORBIDDEN_FLAGS = ALL_HOOK_FLAGS ^ ULTRA_ALIGNMENT_HOOK_FLAGS;

    /// @notice Absolute ceiling on the iterations a single mine may perform.
    /// @dev This is the runaway bound, not the operating bound. It applies to the offset-less
    ///      `mineSalt` overload, which scans `0 .. MAX_ITERATIONS` and exists for the fixed historical
    ///      vectors the tests pin. Production callers use the offset-taking overload, whose scan length
    ///      is `SCAN_WINDOW` — see there for the sizing argument. `SCAN_WINDOW <= MAX_ITERATIONS` is a
    ///      library invariant and is asserted in the tests.
    uint256 constant MAX_ITERATIONS = 250_000;

    /// @notice Iterations a single offset-scanning mine performs before reverting `NoValidSaltFound`.
    /// @dev Sized to fit inside a 30M-gas block alongside the rest of a graduation, so an unlucky search
    ///      ends in a cheap named revert that a later block can retry with a fresh window, rather than in
    ///      an out-of-gas that consumes the whole limit and reverts with nothing.
    ///
    ///      The arithmetic, measured on this tree (`HookAddressMinerGas.t.sol` reports 15,419,320 gas for
    ///      an 84,719-iteration mine = ~182 gas/iteration):
    ///        - 100,000 iterations ~= 18.2M gas for the mine itself;
    ///        - plus the init-code hash, the CREATE2 deploy and the rest of graduation, an attempt lands
    ///          near 22M against a 30M limit, leaving headroom rather than filling the block.
    ///      A 14-bit exact-flag constraint such as 0xCC is hit with probability 2^-14 per iteration, so a
    ///      window of 100,000 misses with probability (1 - 2^-14)^100000 ~= 2.2e-3, and two independent
    ///      attempts miss with probability ~5e-6.
    ///
    ///      The tradeoff, stated plainly: a named window makes a FIRST attempt fail slightly more often
    ///      than an implicit "however much fits in this block" bound would, because the bound is now
    ///      declared rather than discovered. In exchange, the failure is retryable — the offset varies
    ///      per attempt (see `mineSalt(...,startOffset)`), so a second transaction scans different salts
    ///      instead of reproducing the first one's search.
    uint256 constant SCAN_WINDOW = 100_000;

    /// @notice Error when no valid salt found within iteration limit
    error NoValidSaltFound(uint256 iterations, uint160 requiredFlags);

    /// @notice Error when computed address doesn't match expected
    error AddressMismatch(address expected, address actual);

    /**
     * @notice Find a CREATE2 salt that produces a hook address with EXACTLY the required permission bits
     * @dev The address must have requiredFlags set AND must NOT have any other hook flags set
     * @param deployer The factory contract that will deploy the hook (CREATE2 deployer)
     * @param initCodeHash The keccak256 hash of the hook's creation bytecode + constructor args
     * @param requiredFlags The permission bits that must be set in the resulting address
     * @param forbiddenFlags The permission bits that must NOT be set in the resulting address
     * @return salt A bytes32 salt value that produces a valid hook address
     * @return predictedAddress The address that will be deployed with this salt
     */
    function mineSalt(address deployer, bytes32 initCodeHash, uint160 requiredFlags, uint160 forbiddenFlags)
        internal
        pure
        returns (bytes32 salt, address predictedAddress)
    {
        return _mineRange(deployer, initCodeHash, requiredFlags, forbiddenFlags, 0, MAX_ITERATIONS);
    }

    /**
     * @notice Find a CREATE2 salt as above, scanning a `SCAN_WINDOW`-long run of salts that begins at
     *         `startOffset` instead of always beginning at zero.
     * @dev The search is otherwise a pure function of `(deployer, initCodeHash, requiredFlags,
     *      forbiddenFlags)`, all of which are fixed for a given hook parameterization — so a zero-offset
     *      mine that does not fit in a block is the same failing search on every retry, forever. Varying
     *      the offset is what makes a retry a different search. The caller supplies the offset; the
     *      factory derives it from block entropy so that a retry lands in a different window.
     *
     *      Any salt whose address carries exactly the required bits is equally acceptable, so the choice
     *      of offset carries no property worth steering: it changes WHICH valid address is found, never
     *      WHETHER the address is valid. The hook constructor's `validateHookPermissions()` remains the
     *      on-chain check on the flags.
     * @param startOffset First salt to try. The scan covers `startOffset .. startOffset + SCAN_WINDOW`.
     */
    function mineSalt(
        address deployer,
        bytes32 initCodeHash,
        uint160 requiredFlags,
        uint160 forbiddenFlags,
        uint256 startOffset
    ) internal pure returns (bytes32 salt, address predictedAddress) {
        return _mineRange(deployer, initCodeHash, requiredFlags, forbiddenFlags, startOffset, SCAN_WINDOW);
    }

    /**
     * @notice Scan `[startOffset, startOffset + window)` for a salt whose CREATE2 address carries exactly
     *         the required permission bits, reverting `NoValidSaltFound` if the window is exhausted.
     * @dev Shared body of both `mineSalt` overloads.
     */
    function _mineRange(
        address deployer,
        bytes32 initCodeHash,
        uint160 requiredFlags,
        uint160 forbiddenFlags,
        uint256 startOffset,
        uint256 window
    ) private pure returns (bytes32 salt, address predictedAddress) {
        uint256 required = requiredFlags;
        uint256 forbidden = forbiddenFlags;
        uint256 found;

        // Upper bound of the scan, computed explicitly rather than left to the loop's own comparison. A
        // salt is a full bytes32, so `startOffset + window` can exceed uint256: unchecked addition would
        // wrap the end BELOW the start, the loop's `lt(i, end)` would be false immediately, and a caller
        // whose offset landed near the top of the range would silently scan nothing and always revert.
        // Saturating the end at type(uint256).max instead makes the scan short (it stops at the top of
        // the range) but never wraps around to salts the run has already tried and never scans zero
        // salts on a wrap. With a keccak-derived offset the case is unreachable in practice; it is
        // handled here so it cannot become a silent behaviour change if an offset is ever chosen
        // differently.
        uint256 end;
        unchecked {
            end = startOffset + window;
        }
        if (end < startOffset) end = type(uint256).max;

        // The 85-byte CREATE2 preimage (0xff ++ deployer ++ salt ++ initCodeHash) is laid out ONCE in a
        // fixed memory window above the free-memory pointer, and each iteration rewrites only the salt
        // word before hashing in place. Nothing is allocated inside the loop and the free-memory pointer
        // never moves, so the memory high-water mark is constant and the per-iteration cost is constant:
        // the mine is O(n) in its iteration count. The search sequence, the salt values and the resulting
        // addresses are identical to the straightforward `computeAddress(deployer, bytes32(i), ...)` form,
        // which the tests assert directly.
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x40), initCodeHash)
            mstore(ptr, deployer) // right-aligned; the 12 preceding bytes are overwritten/ignored below
            let start := add(ptr, 0x0b) // final garbage byte of the deployer word becomes the 0xff prefix
            mstore8(start, 0xff)
            let saltSlot := add(ptr, 0x20)
            for { let i := startOffset } lt(i, end) { i := add(i, 1) } {
                mstore(saltSlot, i)
                let addr := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
                if and(eq(and(addr, required), required), iszero(and(addr, forbidden))) {
                    salt := i
                    predictedAddress := addr
                    found := 1
                    break
                }
            }
        }

        if (found == 0) revert NoValidSaltFound(end - startOffset, requiredFlags);
    }

    /**
     * @notice Find a salt specifically for UniAlignmentV4Hook deployment
     * @dev Ensures address has ONLY beforeSwap, afterSwap, and afterSwapReturnDelta flags set
     * @param deployer The hook factory address
     * @param initCodeHash The keccak256 of hook creation code + constructor args
     * @return salt Valid salt for deployment
     * @return predictedAddress The hook address that will be created
     */
    function mineSaltForUniAlignmentHook(address deployer, bytes32 initCodeHash)
        internal
        pure
        returns (bytes32 salt, address predictedAddress)
    {
        return mineSalt(deployer, initCodeHash, ULTRA_ALIGNMENT_HOOK_FLAGS, ULTRA_ALIGNMENT_FORBIDDEN_FLAGS);
    }

    /**
     * @notice Compute the CREATE2 address for a given deployer, salt, and init code hash
     * @param deployer The contract deploying via CREATE2
     * @param salt The CREATE2 salt
     * @param initCodeHash The keccak256 of the init code (creation code + constructor args)
     * @return The predicted deployment address
     */
    /// @dev Derives the address in FIXED scratch memory: the 85-byte CREATE2 preimage
    ///      (0xff ++ deployer ++ salt ++ initCodeHash) is written above the free-memory pointer and hashed
    ///      in place, and the free-memory pointer is left untouched — so the allocation high-water mark
    ///      does not move. This is what keeps `mineSalt` linear in its iteration count: `abi.encodePacked`
    ///      allocates a fresh 85-byte buffer per call, and because EVM memory is never reclaimed, the
    ///      expansion cost of a loop of such calls grows with the square of the iteration count.
    ///      The derivation is byte-for-byte the same preimage and is asserted so by a differential test
    ///      (`HookAddressMinerGas.t.sol`) against the `abi.encodePacked` form across a large sample of
    ///      `(deployer, salt, initCodeHash)` triples, including zero and max values.
    function computeAddress(address deployer, bytes32 salt, bytes32 initCodeHash) internal pure returns (address addr) {
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            mstore(add(ptr, 0x40), initCodeHash)
            mstore(add(ptr, 0x20), salt)
            mstore(ptr, deployer) // right-aligned; the 12 preceding bytes are overwritten/ignored below
            let start := add(ptr, 0x0b) // final garbage byte of the deployer word becomes the 0xff prefix
            mstore8(start, 0xff)
            addr := and(keccak256(start, 85), 0xffffffffffffffffffffffffffffffffffffffff)
        }
    }

    /**
     * @notice Check if an address has EXACTLY the required flags (and no forbidden flags)
     * @param addr The address to check
     * @param requiredFlags Flags that MUST be set
     * @param forbiddenFlags Flags that must NOT be set
     * @return True if address has exactly the required flags
     */
    function hasExactFlags(address addr, uint160 requiredFlags, uint160 forbiddenFlags) internal pure returns (bool) {
        uint160 addrFlags = uint160(addr);
        // Required flags must all be set
        bool hasRequired = (addrFlags & requiredFlags) == requiredFlags;
        // Forbidden flags must all be unset
        bool noForbidden = (addrFlags & forbiddenFlags) == 0;
        return hasRequired && noForbidden;
    }

    /**
     * @notice Check if an address has the required permission flags set
     * @dev WARNING: This only checks if flags ARE set, not if other flags are unset
     * @param addr The address to check
     * @param flags The required permission bits
     * @return True if all required flags are set in the address
     */
    function hasRequiredFlags(address addr, uint160 flags) internal pure returns (bool) {
        return uint160(addr) & flags == flags;
    }

    /**
     * @notice Check if an address is valid for UniAlignmentV4Hook
     * @dev Checks that ONLY beforeSwap, afterSwap, and afterSwapReturnDelta flags are set
     * @param addr The address to validate
     * @return True if the address has exactly the right flags for UniAlignmentV4Hook
     */
    function isValidUniAlignmentHookAddress(address addr) internal pure returns (bool) {
        return hasExactFlags(addr, ULTRA_ALIGNMENT_HOOK_FLAGS, ULTRA_ALIGNMENT_FORBIDDEN_FLAGS);
    }

    /**
     * @notice Compute the init code hash for UniAlignmentV4Hook
     * @param creationCode The type(UniAlignmentV4Hook).creationCode
     * @param poolManager The IPoolManager address
     * @param vault The UniAlignmentVault address
     * @param weth The WETH address
     * @param owner The hook owner address
     * @param benefactor The fixed project instance the hook credits (7th ctor arg, added in #115)
     * @param hookFeeBips The hook fee in basis points
     * @param initialLpFeeRate The initial LP fee rate
     * @return The keccak256 hash of the full init code
     */
    function computeInitCodeHash(
        bytes memory creationCode,
        address poolManager,
        address vault,
        address weth,
        address owner,
        address benefactor,
        uint256 hookFeeBips,
        uint24 initialLpFeeRate
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                creationCode, abi.encode(poolManager, vault, weth, owner, benefactor, hookFeeBips, initialLpFeeRate)
            )
        );
    }

    /**
     * @notice Verify a salt produces the expected address (sanity check)
     * @param deployer The CREATE2 deployer
     * @param salt The salt to verify
     * @param initCodeHash The init code hash
     * @param expectedAddress The address we expect
     */
    function verifySalt(address deployer, bytes32 salt, bytes32 initCodeHash, address expectedAddress) internal pure {
        address computed = computeAddress(deployer, salt, initCodeHash);
        if (computed != expectedAddress) {
            revert AddressMismatch(expectedAddress, computed);
        }
    }

    /**
     * @notice Get human-readable description of flags in an address
     * @param addr The hook address to analyze
     * @return A struct with boolean flags for each permission
     */
    function decodeFlags(address addr) internal pure returns (Hooks.Permissions memory) {
        uint160 flags = uint160(addr);
        return Hooks.Permissions({
            beforeInitialize: flags & Hooks.BEFORE_INITIALIZE_FLAG != 0,
            afterInitialize: flags & Hooks.AFTER_INITIALIZE_FLAG != 0,
            beforeAddLiquidity: flags & Hooks.BEFORE_ADD_LIQUIDITY_FLAG != 0,
            afterAddLiquidity: flags & Hooks.AFTER_ADD_LIQUIDITY_FLAG != 0,
            beforeRemoveLiquidity: flags & Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG != 0,
            afterRemoveLiquidity: flags & Hooks.AFTER_REMOVE_LIQUIDITY_FLAG != 0,
            beforeSwap: flags & Hooks.BEFORE_SWAP_FLAG != 0,
            afterSwap: flags & Hooks.AFTER_SWAP_FLAG != 0,
            beforeDonate: flags & Hooks.BEFORE_DONATE_FLAG != 0,
            afterDonate: flags & Hooks.AFTER_DONATE_FLAG != 0,
            beforeSwapReturnDelta: flags & Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG != 0,
            afterSwapReturnDelta: flags & Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG != 0,
            afterAddLiquidityReturnDelta: flags & Hooks.AFTER_ADD_LIQUIDITY_RETURNS_DELTA_FLAG != 0,
            afterRemoveLiquidityReturnDelta: flags & Hooks.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA_FLAG != 0
        });
    }
}
