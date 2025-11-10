# CULT EXEC Collection - Trading Terminal & NFT Platform

## Overview
A Web3-enabled trading terminal and NFT platform for the CULT EXEC Collection. The platform features a bonding curve trading system, real-time message board, and NFT minting capabilities, all presented through a retro terminal interface.

## Core Features

### Trading System
- **Bonding Curve Implementation**
  - ETH/EXEC token swapping
  - Real-time price calculations
  - Automated market making
- **Transaction Messaging**
  - On-chain message storage
  - Real-time message updates
  - Transaction-linked communications

### NFT Integration
- **Dynamic NFT Minting**
  - Trade-linked NFT rewards
  - Automated minting triggers
  - Balance-based eligibility
- **Mirror Contract System**
  - ERC721 standard compliance
  - Automated token tracking
  - Balance verification

### User Interface
- **Terminal-Style Design**
  - Retro aesthetic
  - Real-time updates
  - Responsive layout
- **Status Monitoring**
  - Network status display
  - Transaction tracking
  - System health indicators

## Technical Architecture

### Frontend Components
- Custom component system
- Event-driven state management
- Real-time WebSocket updates

### Blockchain Integration
- Web3 provider abstraction
- Multi-wallet support
- Contract event handling

### Data Management
- Centralized store pattern
- Real-time price service
- Message batch loading

## Development

### Prerequisites
- Node.js v14+
- NPM or Yarn
- Web3 wallet (MetaMask, Rainbow, etc.)

### Setup

Clone the EXEC404 github at https://github.io/lifehaverdev/EXEC404 
Create an anvil fork of the mainnet with 
```bash
anvil --fork-url $YOUR_RPC_URL --chain-id 8888 
```
Deploy the contract using the script and this command (it's a test public key)
```bash
forge script script/DeployStaging.s.sol:DeployScript --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
```

Then run the site. Put the contract address into the switch.json file, rename it to switch.json

```bash
npm install
npm start
```

I have metamask loaded with the test seed phrase test test test etc junk for testing


## Current Features
- **Whitelist Verification System**
  - 12-day sequential whitelist implementation
  - Real-time whitelist status checking
  - User wallet verification

## Upcoming Features
- NFT minting interface
- Collection management tools
- StationThisBot integration

## StationThisBot Integration
This platform will serve as the launch platform for the StationThisBot collection creator, enabling:
- Streamlined collection deployment
- Automated smart contract generation
- Customizable minting parameters

## Development Status
🟢 Active Development
- Current Focus: Whitelist System Implementation
- Next Phase: Presale/Minting Interface Development

## Security
- Merkle tree verification
- Signature validation
- Rate limiting implementation

## License
VPL

## Contact
- Owner of miladystation #598
- Owner of remilio 4681