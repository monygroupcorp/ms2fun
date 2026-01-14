# Message System Fixes

## Issues Fixed

### 1. Mint Interface Not Rendering on Edition Page
**Problem**: The mint interface component was being created multiple times without checking if it already existed, causing mounting issues.

**Fix**: Added check `!this._children.has('mint-interface')` before creating the component.

**File**: `src/components/ERC1155/EditionDetail.js:261`

```javascript
// Before
if (mintContainer) {
    const mintInterface = new EditionMintInterface(...);
    ...
}

// After
if (mintContainer && !this._children.has('mint-interface')) {
    const mintInterface = new EditionMintInterface(...);
    ...
}
```

---

### 2. mintWithMessage Failing Due to Incorrect Cost Calculation
**Problem**: The `mintWithMessage` method was calculating cost using simple multiplication (`price * amount`) instead of using `calculateMintCost()`, which handles bonding curve pricing correctly.

**Fix**: Changed to use `calculateMintCost()` which respects dynamic pricing models.

**File**: `src/services/contracts/ERC1155Adapter.js:718-719`

```javascript
// Before
const editionInfo = await this.getEditionInfo(editionId);
const totalCost = BigInt(editionInfo.price) * BigInt(amount);

// After
// Use calculateMintCost to get accurate cost (handles bonding curves)
const totalCost = await this.calculateMintCost(editionId, amount);
```

---

### 3. Recent Activity Widget Showing Mock Data
**Problem**: The `RecentActivityWidget` was displaying hardcoded placeholder data instead of real messages from the `GlobalMessageRegistry`.

**Fix**:
- Wired widget to fetch real messages from `GlobalMessageRegistryAdapter`
- Added message unpacking logic (unpacks `packedData` field)
- Added `getMessageRegistryAdapter()` method to `ServiceFactory`
- Transformed raw messages to display format

**Files Modified**:
- `src/components/RecentActivityWidget/RecentActivityWidget.js`
- `src/services/ServiceFactory.js`

**Key Changes**:
```javascript
// Added to ServiceFactory
async getMessageRegistryAdapter() {
    if (!this.messageRegistryAdapter) {
        const masterService = this.getMasterService();
        const messageRegistryAddress = await masterService.getGlobalMessageRegistry();

        const { provider, signer } = walletService.getProviderAndSigner();

        this.messageRegistryAdapter = new GlobalMessageRegistryAdapter(
            messageRegistryAddress,
            'GlobalMessageRegistry',
            provider,
            signer
        );

        await this.messageRegistryAdapter.initialize();
    }
    return this.messageRegistryAdapter;
}
```

```javascript
// RecentActivityWidget now loads real messages
async loadMessages() {
    const masterService = serviceFactory.getMasterService();
    const messageRegistryAddress = await masterService.getGlobalMessageRegistry();

    const messageAdapter = await serviceFactory.getMessageRegistryAdapter();
    const rawMessages = await messageAdapter.getRecentMessages(5);

    // Transform messages with unpacking logic
    const messages = rawMessages.map(msg => this.transformMessage(msg));
    this.setState({ messages, loading: false });
}
```

---

## Testing Instructions

### Test 1: Verify Mint Interface Renders
1. Navigate to an edition page: `http://localhost:3000/1337/demo-gallery/sunset-1`
2. Verify the mint interface is visible with:
   - Quantity selector
   - Total cost display
   - "Add message" checkbox
   - "Mint Edition" button

### Test 2: Mint with Message
1. On an edition page, check the "Add message" checkbox
2. Enter a test message (e.g., "Hello from MS2Fun! 🚀")
3. Click "Mint Edition"
4. Verify:
   - Transaction succeeds
   - Success banner appears
   - Supply count updates
   - No errors in console

### Test 3: Verify Messages Appear in Recent Activity
1. After minting with a message, navigate to home page: `http://localhost:3000`
2. Scroll down to "Recent Activity" widget
3. Verify:
   - Your message appears in the list
   - Message shows sender address, action, and timestamp
   - No placeholder/mock data visible

### Test 4: Query Messages from Console
Run the test script to verify messages are stored on-chain:
```bash
node scripts/test-message-system.mjs
```

Expected output:
- Total message count
- List of recent messages with unpacked metadata
- Timestamps, sender addresses, message content

---

## Architecture Notes

### Message Flow
1. User fills out mint form with message
2. `EditionMintInterface` calls `adapter.mintWithMessage(editionId, quantity, message)`
3. `ERC1155Adapter.mintWithMessage()`:
   - Calculates cost using `calculateMintCost()`
   - Calls contract's `mintWithMessage()` function
   - Contract stores message in `GlobalMessageRegistry`
4. `GlobalMessageRegistry` stores message with packed metadata:
   - `timestamp` (uint32)
   - `factoryType` (uint8) - e.g., ERC1155 = 1
   - `actionType` (uint8) - e.g., Mint = 1
   - `contextId` (uint32) - edition ID
   - `amount` (uint96) - quantity minted

### Message Retrieval
- `GlobalMessageRegistryAdapter.getRecentMessages(count)` fetches recent messages
- `RecentActivityWidget.unpackMessageData()` unpacks the `packedData` field
- Messages displayed with formatted timestamps and action types

---

## Next Steps

1. **Add Authorization Check**: Verify ERC1155 instances are authorized in GlobalMessageRegistry
   ```bash
   # Check if instance is authorized
   cast call $MESSAGE_REGISTRY_ADDRESS "isAuthorized(address)(bool)" $ERC1155_INSTANCE_ADDRESS
   ```

2. **Build Activity Feed Page**: Create full-page view for browsing all messages
   - Pagination support
   - Filter by project/user/action type
   - Search functionality

3. **Add Message Display on Edition Pages**: Show recent messages for each edition
   - Display messages below mint interface
   - Show user avatars/ENS names
   - Add reaction/reply functionality

4. **Improve Message UX**:
   - Add character counter to message textarea (currently max 200 chars)
   - Add emoji picker
   - Show message preview before mint
   - Support markdown formatting

---

## Known Issues

None currently - all three reported issues have been fixed.

If you encounter errors:
1. Check browser console for JavaScript errors
2. Verify Anvil is running on http://127.0.0.1:8545
3. Ensure MetaMask is connected to Anvil (chainId 1337)
4. Check that contracts are deployed (verify `src/config/contracts.local.json` exists)
