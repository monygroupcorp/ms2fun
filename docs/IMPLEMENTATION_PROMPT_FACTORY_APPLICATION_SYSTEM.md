# Implementation Prompt: Factory Application System & EXEC Voting Dashboard

## Overview

This document provides a comprehensive prompt for implementing the factory application system and EXEC voting dashboard. This is a new feature addition that integrates with the existing ms2.fun launchpad architecture.

## Context

### Current System

- **Architecture**: Vanilla JavaScript, component-based architecture
- **Routing**: Client-side routing with title-based navigation (`src/routes/`)
- **State Management**: Custom store system (`src/store/`)
- **Services**: Service layer with mock/real switching (`src/services/`)
- **Components**: Reusable component system (`src/components/`)
- **Styling**: CSS files co-located with components

### Existing Pages

- Home page (`/`) - Project discovery
- CULT EXEC page (`/cultexecs`) - Trading interface
- Project detail pages (`/project/:id`) - Individual project pages
- Factory pages (if exists) - Factory listings

### New Requirements

1. **Factory Application Form** - For factory creators to apply
2. **EXEC Voting Dashboard** - For EXEC holders to stake and vote
3. **Factory Page Enhancement** - Add "Apply for Factory" button

---

## Part 1: Factory Page Enhancement

### Location
- File: `src/routes/FactoriesPage.js` (or create if doesn't exist)
- Route: `/factories`

### Requirements

**Add "Apply for Factory" Button**:
- Position: Below the factories list/grid
- Styling: Prominent, matches existing button styles
- Text: "Apply for Factory" or "Submit Factory Application"
- Action: Navigate to `/factories/apply`

**Button Specifications**:
```javascript
// Example button HTML structure
<button id="applyFactoryBtn" class="apply-factory-button">
    <span class="button-icon">➕</span>
    <span class="button-text">Apply for Factory</span>
</button>
```

**Styling Requirements**:
- Should stand out but not clash with existing design
- Use existing design system colors/typography
- Responsive (mobile-friendly)
- Hover states and transitions

---

## Part 2: Factory Application Form Page

### Location
- File: `src/routes/FactoryApplicationPage.js`
- Route: `/factories/apply`
- Styles: `src/routes/factory-application.css`

### Page Structure

**Header Section**:
- Title: "Apply for Factory"
- Subtitle: "Submit your factory contract for review by EXEC holders"
- Back button to `/factories`

**Application Form**:

1. **Factory Contract Address**
   - Input: Ethereum address
   - Validation: Must be valid address, must have code (deployed contract)
   - Error messages for invalid addresses

2. **Contract Type**
   - Radio buttons or dropdown:
     - ERC404 Factory
     - ERC1155 Factory
   - Required field

3. **Factory Title** (URL-safe slug)
   - Input: Text field
   - Validation: 
     - Lowercase, alphanumeric + hyphens only
     - 3-64 characters
     - Must be unique (check against existing titles)
   - Helper text: "This will be used in the URL: /factories/[title]"
   - Real-time validation feedback

4. **Display Title**
   - Input: Text field
   - Validation: 1-100 characters
   - Helper text: "Human-readable name displayed on the site"

5. **Metadata URI**
   - Input: Text field (IPFS/Arweave URI)
   - Validation: Must start with `ipfs://` or `https://` or `ar://`
   - Helper text: "IPFS or Arweave URI containing factory metadata JSON"
   - Optional: Preview metadata button

6. **Features** (Optional)
   - Multi-select checkboxes or tags
   - Options: 
     - Bonding Curve
     - NFT Minting
     - Whitelist Support
     - Liquidity Pool Integration
     - On-chain Messaging
     - Custom Features (text input)
   - Stored as bytes32 array

7. **Application Fee Display**
   - Show required fee (e.g., "0.1 ETH")
   - Display current ETH balance
   - Warning if insufficient balance

**Form Actions**:
- "Submit Application" button (disabled until form valid)
- "Cancel" button (navigate back)
- Loading state during submission

**After Submission**:
- Success message with transaction hash
- Link to view application status
- Instructions on what happens next

### Technical Implementation

**Service Integration**:
```javascript
// Use existing service pattern
import serviceFactory from '../services/ServiceFactory.js';
import walletService from '../services/WalletService.js';
import { eventBus } from '../core/EventBus.js';

// Get master contract service (to be created)
const masterService = serviceFactory.getMasterService();

// Submit application
async function submitApplication(formData) {
    // 1. Validate form data
    // 2. Check wallet connection
    // 3. Check sufficient balance
    // 4. Call contract: applyForFactory()
    // 5. Handle transaction
    // 6. Show success/error
}
```

**Form Validation**:
- Client-side validation before submission
- Real-time feedback on fields
- Contract-side validation (check title uniqueness, etc.)

**Transaction Handling**:
- Use existing transaction pattern from CultExecsPage
- Show pending state
- Wait for confirmation
- Handle errors gracefully

**Metadata Preview** (Optional Enhancement):
- Fetch metadata from URI
- Display preview of metadata JSON
- Validate JSON structure

### UI/UX Requirements

**Design**:
- Match existing form styles (check ProjectCreation.js for reference)
- Clean, professional layout
- Clear field labels and help text
- Error states for invalid inputs
- Success states for valid inputs

**Responsive**:
- Mobile-friendly form layout
- Stack fields vertically on mobile
- Touch-friendly inputs

**Accessibility**:
- Proper form labels
- ARIA attributes
- Keyboard navigation
- Screen reader support

---

## Part 3: EXEC Voting Dashboard

### Location
- File: `src/routes/ExecVotingDashboard.js`
- Route: `/exec/voting` or `/voting`
- Styles: `src/routes/exec-voting-dashboard.css`

### Page Structure

**Header Section**:
- Title: "EXEC Voting Dashboard"
- Subtitle: "Stake EXEC tokens and vote on factory applications"
- EXEC balance display (if wallet connected)

**Main Sections**:

### Section 1: Staking Panel

**Stake EXEC**:
- Current staked balance display
- Input field for amount to stake
- "Stake" button
- "Unstake" button (with cooldown indicator if active)
- Staking stats:
  - Total staked
  - Staking start date
  - Days staked (for multiplier calculation)
  - Current voting power (quadratic)

**Unstaking**:
- Show cooldown period if recently voted
- Countdown timer if cooldown active
- Warning message about cooldown

**Voting Power Display**:
- Current voting power (large, prominent)
- Breakdown:
  - Base votes (√staked)
  - Time multiplier bonus
  - Streak bonus
  - Total voting power

### Section 2: Active Applications

**Pending Factory Applications**:
- List of all pending applications
- Each application card shows:
  - Factory address (truncated)
  - Display title
  - Contract type
  - Applied date
  - Current voting stats:
    - Approve votes (with progress bar)
    - Reject votes (with progress bar)
    - Total voters
    - Time remaining
  - User's vote status (if voted)
  - "Vote" button (if not voted)

**Application Card Actions**:
- "View Details" - Expand to show full application info
- "Vote Approve" - Cast approve vote
- "Vote Reject" - Cast reject vote
- "View on Etherscan" - Link to contract

**Voting Interface** (Modal or Inline):
- Vote type selection (Approve/Reject)
- Reason field (optional text input)
- Voting power display (how many votes will be cast)
- "Cast Vote" button
- Transaction confirmation flow

### Section 3: Reputation & Achievements

**Reputation Display**:
- Reputation score (large number)
- Stats:
  - Total votes cast
  - Correct predictions
  - Accuracy percentage
  - Current streak

**Badges Display**:
- Grid of badge icons
- Earned badges: highlighted, animated
- Locked badges: grayed out
- Badge tooltips on hover

**Badges to Display**:
1. First Vote 🎯
2. Consistent Voter (10+ votes) 🔥
3. Quality Reviewer (80%+ accuracy) ⭐
4. Early Adopter (vote within 24h) ⚡
5. Whale Voter (1000+ total votes) 🐋
6. Streak Master (30+ days) 🔥

### Section 4: Leaderboard (Optional)

**Top Voters**:
- Rank, address, score, votes cast, accuracy
- Pagination or "Load More"
- Highlight current user's position

**Top Reviewers**:
- Ranked by accuracy (min 5 votes)
- Show accuracy percentage

### Section 5: Voting History

**User's Vote History**:
- Table/list of all votes cast
- Columns:
  - Factory address/name
  - Vote type (Approve/Reject)
  - Votes cast
  - Date
  - Outcome (if resolved)
  - Correct/Incorrect indicator

**Filter Options**:
- All votes
- Correct votes
- Incorrect votes
- Pending votes

### Technical Implementation

**Service Layer**:
```javascript
// Create new service: ExecVotingService.js
// src/services/ExecVotingService.js

class ExecVotingService {
    constructor(masterContractAddress, execTokenAddress) {
        this.masterContract = null;
        this.execToken = null;
    }
    
    async initialize(provider, signer) {
        // Initialize contract instances
    }
    
    // Staking
    async stakeExec(amount) { }
    async unstakeExec(amount) { }
    async getStakedBalance(address) { }
    async getVotingPower(address) { }
    
    // Voting
    async castVote(factoryAddress, voteType, reason) { }
    async getUserVote(factoryAddress, voter) { }
    async getVotingStats(factoryAddress) { }
    
    // Applications
    async getPendingApplications() { }
    async getApplication(factoryAddress) { }
    
    // Reputation
    async getReputation(address) { }
    async getBadges(address) { }
}
```

**Contract Integration**:
- Use ethers.js (already in project)
- Connect to Master Contract
- Connect to EXEC404 token contract
- Handle transaction signing
- Listen for events

**State Management**:
- Use existing store pattern or create new store
- Cache voting data
- Update on events (VoteCast, FactoryApproved, etc.)

**Real-time Updates**:
- Poll for updates (setInterval)
- Listen to contract events
- Update UI when votes change

### UI/UX Requirements

**Design**:
- Dashboard-style layout
- Cards/panels for each section
- Clear visual hierarchy
- Use existing design system

**Visualizations**:
- Progress bars for voting
- Charts for reputation over time (optional)
- Badge animations
- Voting power visualization

**Responsive**:
- Mobile-friendly dashboard
- Collapsible sections
- Touch-friendly buttons

**Loading States**:
- Skeleton loaders
- Spinners for transactions
- Progress indicators

**Error Handling**:
- Clear error messages
- Retry buttons
- Help text for common errors

---

## Part 4: Application Status Page

### Location
- File: `src/routes/FactoryApplicationStatusPage.js`
- Route: `/factories/application/:factoryAddress` or `/factories/application/:id`

### Requirements

**For Applicants**:
- View their own application status
- See voting progress
- View rejection reason (if rejected)
- Withdraw application (if pending)

**For Everyone**:
- View any application's status
- See voting breakdown
- View all votes cast
- See application details

**Page Sections**:
1. Application Info
   - Factory address
   - Contract type
   - Titles
   - Metadata URI
   - Applied date
   - Status badge

2. Voting Progress
   - Approve/Reject vote counts
   - Progress bars
   - Time remaining
   - Threshold indicators

3. Vote List
   - All votes cast
   - Voter addresses (truncated)
   - Vote type
   - Votes cast
   - Reason (if provided)
   - Timestamp

4. Actions (if user is applicant)
   - Withdraw button (if pending)
   - View on Etherscan

---

## File Structure

```
src/
├── routes/
│   ├── FactoriesPage.js (modify - add button)
│   ├── FactoryApplicationPage.js (new)
│   ├── factory-application.css (new)
│   ├── ExecVotingDashboard.js (new)
│   ├── exec-voting-dashboard.css (new)
│   ├── FactoryApplicationStatusPage.js (new)
│   └── factory-application-status.css (new)
├── services/
│   ├── ExecVotingService.js (new)
│   └── MasterContractService.js (new - if needed)
├── components/
│   ├── FactoryApplicationForm/ (new)
│   │   ├── FactoryApplicationForm.js
│   │   └── FactoryApplicationForm.css
│   ├── StakingPanel/ (new)
│   │   ├── StakingPanel.js
│   │   └── StakingPanel.css
│   ├── VotingCard/ (new)
│   │   ├── VotingCard.js
│   │   └── VotingCard.css
│   ├── ReputationDisplay/ (new)
│   │   ├── ReputationDisplay.js
│   │   └── ReputationDisplay.css
│   └── BadgeDisplay/ (new)
│       ├── BadgeDisplay.js
│       └── BadgeDisplay.css
└── store/
    └── votingStore.js (new - optional)
```

---

## Integration Points

### 1. Router Integration

**Add routes to router**:
```javascript
// In src/core/Router.js or similar
router.addRoute('/factories/apply', () => import('../routes/FactoryApplicationPage.js'));
router.addRoute('/voting', () => import('../routes/ExecVotingDashboard.js'));
router.addRoute('/factories/application/:address', () => import('../routes/FactoryApplicationStatusPage.js'));
```

### 2. Service Factory Integration

**Add to ServiceFactory**:
```javascript
// src/services/ServiceFactory.js
getExecVotingService() {
    if (!this.execVotingService) {
        this.execVotingService = new ExecVotingService(
            masterContractAddress,
            execTokenAddress
        );
    }
    return this.execVotingService;
}
```

### 3. Wallet Service Integration

**Use existing WalletService**:
- Check wallet connection
- Get provider/signer
- Handle wallet events

### 4. Event Bus Integration

**Listen for events**:
```javascript
// Application submitted
eventBus.on('factory:application:submitted', (data) => {
    // Update UI
});

// Vote cast
eventBus.on('vote:cast', (data) => {
    // Update voting stats
});

// Factory approved/rejected
eventBus.on('factory:approved', (data) => {
    // Update application status
});
```

---

## Contract Integration Details

### Master Contract Address
- Will be provided when contract is deployed
- Store in config file: `src/config.js`

### EXEC Token Address
- Already exists: CULT EXEC contract
- Address: Check `/EXEC404/switch.json` or config

### Contract ABI
- Master Contract ABI: Store in `/EXEC404/master-abi.json` or similar
- EXEC Token ABI: Already exists at `/EXEC404/abi.json`

### Key Functions to Call

**Staking**:
```javascript
// Stake EXEC
await masterContract.stakeExec(amount, { value: 0 });

// Unstake EXEC
await masterContract.unstakeExec(amount);

// Get staked balance
const stake = await masterContract.stakes(userAddress);
```

**Voting**:
```javascript
// Cast vote
await masterContract.castVote(
    factoryAddress,
    voteType, // 0 = Approve, 1 = Reject, 2 = Abstain
    reason
);

// Get voting stats
const [approveVotes, rejectVotes, totalVoters] = await masterContract.getVotingStats(factoryAddress);

// Get user's vote
const vote = await masterContract.getUserVote(factoryAddress, userAddress);
```

**Applications**:
```javascript
// Submit application
await masterContract.applyForFactory(
    factoryAddress,
    contractType,
    title,
    displayTitle,
    metadataURI,
    features,
    { value: applicationFee }
);

// Get application
const app = await masterContract.applications(factoryAddress);

// Get pending applications
const pending = await masterContract.pendingApplications();
```

**Reputation**:
```javascript
// Get reputation
const rep = await masterContract.getReputation(userAddress);

// Get voting power
const power = await masterContract.getVotingPower(userAddress);
```

---

## Design System Reference

### Existing Patterns

**Check these files for styling patterns**:
- `src/routes/ProjectCreation.js` - Form patterns
- `src/routes/CultExecsPage.js` - Button styles, layout
- `src/components/` - Component patterns
- `style.css` - Global styles

### Color Scheme
- Use existing color variables
- Match terminal/retro aesthetic if applicable
- Ensure contrast for accessibility

### Typography
- Use existing font stack
- Match heading styles
- Consistent text sizing

### Buttons
- Match existing button styles
- Primary actions: prominent
- Secondary actions: subtle
- Disabled states: grayed out

---

## Testing Requirements

### Unit Tests
- Form validation logic
- Service methods
- Utility functions

### Integration Tests
- Form submission flow
- Voting flow
- Staking flow
- Contract interaction

### Manual Testing Checklist

**Factory Application**:
- [ ] Form validates all fields
- [ ] Address validation works
- [ ] Title uniqueness check works
- [ ] Fee calculation correct
- [ ] Transaction submits successfully
- [ ] Success message displays
- [ ] Error handling works

**Voting Dashboard**:
- [ ] Staking works
- [ ] Unstaking works (with cooldown)
- [ ] Voting power calculates correctly
- [ ] Vote casting works
- [ ] Reputation updates
- [ ] Badges display correctly
- [ ] Leaderboard loads
- [ ] Real-time updates work

**Application Status**:
- [ ] Status displays correctly
- [ ] Voting progress accurate
- [ ] Vote list loads
- [ ] Withdrawal works (if applicable)

---

## Mock Mode Support

### Development Without Contracts

**Mock ExecVotingService**:
- Return mock data for development
- Simulate staking/voting
- Mock reputation and badges
- Use localStorage for persistence

**Toggle**:
- Use `USE_MOCK_SERVICES` flag from `src/config.js`
- Switch between mock and real services

---

## Performance Considerations

### Optimization

1. **Lazy Loading**:
   - Load voting dashboard components on demand
   - Lazy load application lists

2. **Caching**:
   - Cache voting stats
   - Cache reputation data
   - Invalidate on events

3. **Pagination**:
   - Paginate application lists
   - Paginate vote history
   - Load more on scroll

4. **Debouncing**:
   - Debounce form validation
   - Debounce search/filter

---

## Accessibility Requirements

### WCAG Compliance

1. **Keyboard Navigation**:
   - All interactive elements keyboard accessible
   - Focus indicators visible
   - Tab order logical

2. **Screen Readers**:
   - Proper ARIA labels
   - Form labels associated
   - Status announcements

3. **Visual**:
   - Color contrast ratios
   - Text alternatives for icons
   - Error messages clear

---

## Security Considerations

### Input Validation

1. **Client-Side**:
   - Validate all inputs
   - Sanitize user input
   - Check address formats

2. **Contract-Side**:
   - Trust contract validation
   - Handle revert reasons
   - Display user-friendly errors

### Transaction Safety

1. **Confirmations**:
   - Show transaction details before signing
   - Display gas estimates
   - Warn about fees

2. **Error Handling**:
   - Catch and display errors
   - Don't expose sensitive info
   - Provide helpful error messages

---

## Success Criteria

### Must Have

1. ✅ "Apply for Factory" button on factories page
2. ✅ Factory application form page
3. ✅ Form validation and submission
4. ✅ EXEC voting dashboard
5. ✅ Staking interface
6. ✅ Voting interface
7. ✅ Reputation display
8. ✅ Badge system
9. ✅ Application status page
10. ✅ Contract integration

### Nice to Have

1. ⭐ Leaderboard
2. ⭐ Voting history with filters
3. ⭐ Metadata preview
4. ⭐ Real-time vote updates
5. ⭐ Charts/visualizations
6. ⭐ Email notifications (future)
7. ⭐ Mobile app (future)

---

## Implementation Order

### Phase 1: Foundation
1. Create ExecVotingService
2. Create MasterContractService (if needed)
3. Add routes to router
4. Create basic page structures

### Phase 2: Factory Application
1. Enhance factories page (add button)
2. Create application form page
3. Implement form validation
4. Integrate contract calls
5. Add application status page

### Phase 3: Voting Dashboard
1. Create staking panel
2. Create voting interface
3. Implement voting logic
4. Add reputation display
5. Add badge system

### Phase 4: Polish
1. Add loading states
2. Improve error handling
3. Add animations
4. Optimize performance
5. Add tests

---

## Questions to Resolve

1. **Routing**: What's the exact route structure? (`/factories/apply` vs `/apply-factory`)
2. **Design**: Should it match terminal aesthetic or be more modern?
3. **Badges**: Should badges be NFTs or just on-chain data?
4. **Notifications**: How should users be notified of vote outcomes?
5. **Mobile**: Priority level for mobile optimization?

---

## Reference Documents

- `docs/MASTER_CONTRACT_WITH_VOTING.md` - Contract specification
- `docs/EXEC_QUADRATIC_VOTING_SYSTEM.md` - Voting system design
- `docs/ETHEREUM_CONTRACT_SERVICE_SYSTEM.md` - Service architecture
- `src/routes/ProjectCreation.js` - Form reference
- `src/routes/CultExecsPage.js` - Page structure reference

---

## Final Notes

- **Follow existing patterns**: Match code style and architecture
- **Test thoroughly**: Especially contract interactions
- **Document as you go**: Add comments for complex logic
- **Ask questions**: Clarify requirements before implementing
- **Iterate**: Start with MVP, enhance based on feedback

This is an exciting addition that will make EXEC tokens central to the platform! Good luck with the implementation! 🚀

