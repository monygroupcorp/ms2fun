import {
  createUseReadContract,
  createUseWriteContract,
  createUseSimulateContract,
  createUseWatchContractEvent,
} from 'wagmi/codegen'

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AlignmentEndowmentVault
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const alignmentEndowmentVaultAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'MATURITY_DURATION',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'accumulatedFees',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'alignmentToken',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'benefactor', internalType: 'address', type: 'address' }],
    name: 'calculateClaimableAmount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimFees',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    name: 'claimFeesAsDelegate',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'communityPayout',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'currentPolicy',
    outputs: [{ name: '', internalType: 'bytes', type: 'bytes' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'delegateBenefactor',
    outputs: [],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'depositTime',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'description',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'benefactor', internalType: 'address', type: 'address' }],
    name: 'getBenefactorContribution',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'benefactor', internalType: 'address', type: 'address' }],
    name: 'getBenefactorDelegate',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'benefactor', internalType: 'address', type: 'address' }],
    name: 'getBenefactorShares',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'harvest',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_owner', internalType: 'address', type: 'address' },
      { name: '_weth', internalType: 'address', type: 'address' },
      { name: '_stataToken', internalType: 'address', type: 'address' },
      { name: '_protocolTreasury', internalType: 'address', type: 'address' },
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      { name: '_alignmentToken', internalType: 'address', type: 'address' },
      { name: '_communityPayout', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'isLiquidityReady',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'to', internalType: 'address', type: 'address' }],
    name: 'migratePosition',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'principal',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'currency', internalType: 'Currency', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'benefactor', internalType: 'address', type: 'address' },
    ],
    name: 'receiveContribution',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'payout', internalType: 'address', type: 'address' }],
    name: 'setCommunityPayout',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'stataToken',
    outputs: [
      { name: '', internalType: 'contract IStataToken', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'capability', internalType: 'bytes32', type: 'bytes32' }],
    name: 'supportsCapability',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalPrincipal',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalShares',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'validateCompliance',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'vaultType',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'contract IWETH', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'benefactor', internalType: 'address', type: 'address' }],
    name: 'withdrawPrincipal',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'payout',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'CommunityPayoutUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'benefactor',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ContributionReceived',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeesAccumulated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'benefactor',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'ethAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeesClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'yield',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'community',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Harvested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Migrated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'benefactor',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'matured', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'PrincipalWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'key', internalType: 'bytes32', type: 'bytes32', indexed: true },
      { name: 'value', internalType: 'bytes', type: 'bytes', indexed: false },
    ],
    name: 'VaultPolicyUpdated',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AmountMismatch' },
  { type: 'error', inputs: [], name: 'AmountMustBePositive' },
  { type: 'error', inputs: [], name: 'BenefactorNotContract' },
  { type: 'error', inputs: [], name: 'CommunityPayoutNotSet' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'NativeOnly' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoPrincipal' },
  { type: 'error', inputs: [], name: 'NotAuthorized' },
  { type: 'error', inputs: [], name: 'NotSupported' },
  { type: 'error', inputs: [], name: 'RedeemShortfall' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AlignmentRegistryV1
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const alignmentRegistryV1Abi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'ambassador', internalType: 'address', type: 'address' },
    ],
    name: 'addAmbassador',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'alignmentTargetAmbassadors',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'alignmentTargets',
    outputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'approvedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'communityPayout',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'deactivateAlignmentTarget',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getAlignmentTarget',
    outputs: [
      {
        name: '',
        internalType: 'struct IAlignmentRegistry.AlignmentTarget',
        type: 'tuple',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'title', internalType: 'string', type: 'string' },
          { name: 'description', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'approvedAt', internalType: 'uint256', type: 'uint256' },
          { name: 'active', internalType: 'bool', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getAlignmentTargetAssets',
    outputs: [
      {
        name: '',
        internalType: 'struct IAlignmentRegistry.AlignmentAsset[]',
        type: 'tuple[]',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'info', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getAmbassadors',
    outputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getCommunityPayout',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_owner', internalType: 'address', type: 'address' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'isAlignmentTargetActive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'isAmbassador',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    name: 'isTokenInTarget',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextAlignmentTargetId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'assets',
        internalType: 'struct IAlignmentRegistry.AlignmentAsset[]',
        type: 'tuple[]',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'info', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    name: 'registerAlignmentTarget',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'ambassador', internalType: 'address', type: 'address' },
    ],
    name: 'removeAmbassador',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'payout', internalType: 'address', type: 'address' },
    ],
    name: 'setCommunityPayout',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'tokenToTargetIds',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'description', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
    ],
    name: 'updateAlignmentTarget',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'AlignmentTargetDeactivated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'title', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'AlignmentTargetRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'AlignmentTargetUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'ambassador',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'AmbassadorAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'ambassador',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'AmbassadorRemoved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'payout',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'CommunityPayoutSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AmbassadorAlreadyAssigned' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidTitle' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoAssets' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotAmbassador' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'TargetNotFound' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AlignmentTargetRequestRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const alignmentTargetRequestRegistryAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_owner', internalType: 'address', type: 'address' },
      {
        name: '_alignmentRegistry',
        internalType: 'contract IAlignmentRegistry',
        type: 'address',
      },
      { name: '_protocolTreasury', internalType: 'address', type: 'address' },
      { name: '_requestDeposit', internalType: 'uint256', type: 'uint256' },
      { name: '_maxPending', internalType: 'uint256', type: 'uint256' },
      { name: '_requestTTL', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'alignmentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IAlignmentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'approveRequest',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getPending',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'getRequest',
    outputs: [
      {
        name: '',
        internalType: 'struct AlignmentTargetRequestRegistry.Request',
        type: 'tuple',
        components: [
          { name: 'requester', internalType: 'address', type: 'address' },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'title', internalType: 'string', type: 'string' },
          { name: 'description', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'deposit', internalType: 'uint256', type: 'uint256' },
          { name: 'submittedAt', internalType: 'uint40', type: 'uint40' },
          {
            name: 'status',
            internalType: 'enum AlignmentTargetRequestRegistry.Status',
            type: 'uint8',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'getRequestAssets',
    outputs: [
      {
        name: '',
        internalType: 'struct IAlignmentRegistry.AlignmentAsset[]',
        type: 'tuple[]',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'info', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'maxPending',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextRequestId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'pruneExpired',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'refunds',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'forfeit', internalType: 'bool', type: 'bool' },
    ],
    name: 'rejectRequest',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestDeposit',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestTTL',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'v', internalType: 'uint256', type: 'uint256' }],
    name: 'setMaxPending',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'v', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'v', internalType: 'uint256', type: 'uint256' }],
    name: 'setRequestDeposit',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'v', internalType: 'uint256', type: 'uint256' }],
    name: 'setRequestTTL',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'assets',
        internalType: 'struct IAlignmentRegistry.AlignmentAsset[]',
        type: 'tuple[]',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'info', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    name: 'submitRequest',
    outputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'withdrawRefund',
    outputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newMax',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'MaxPendingUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RefundWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
      {
        name: 'requester',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'refunded',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RequestApproved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newDeposit',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RequestDepositUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
      {
        name: 'requester',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'refunded',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RequestExpired',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
      {
        name: 'requester',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'forfeited', internalType: 'bool', type: 'bool', indexed: false },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RequestRejected',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
      {
        name: 'requester',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'title', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'deposit',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RequestSubmitted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newTTL',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RequestTTLUpdated',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'IncorrectDeposit' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidTitle' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoAssets' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoRefund' },
  { type: 'error', inputs: [], name: 'NotExpired' },
  { type: 'error', inputs: [], name: 'NotPending' },
  { type: 'error', inputs: [], name: 'QueueFull' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'TargetNotRegistered' },
  { type: 'error', inputs: [], name: 'TokenAlreadyActive' },
  { type: 'error', inputs: [], name: 'TokenNotInAssets' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ComponentRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const componentRegistryAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'allComponents',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'component', internalType: 'address', type: 'address' },
      { name: 'tag', internalType: 'bytes32', type: 'bytes32' },
      { name: 'name', internalType: 'string', type: 'string' },
    ],
    name: 'approveComponent',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'componentName',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'componentTag',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getApprovedComponents',
    outputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tag', internalType: 'bytes32', type: 'bytes32' }],
    name: 'getApprovedComponentsByTag',
    outputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_owner', internalType: 'address', type: 'address' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'isApproved',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'component', internalType: 'address', type: 'address' }],
    name: 'isApprovedComponent',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'component', internalType: 'address', type: 'address' }],
    name: 'revokeComponent',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'component',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'tag', internalType: 'bytes32', type: 'bytes32', indexed: true },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'ComponentApproved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'component',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ComponentRevoked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyApproved' },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotApproved' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// CurveParamsComputer
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const curveParamsComputerAbi = [
  {
    type: 'constructor',
    inputs: [{ name: '_protocol', internalType: 'address', type: 'address' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'baseWeight',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'params',
        internalType: 'struct BondingCurveMath.Params',
        type: 'tuple',
        components: [
          { name: 'initialPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'quarticCoeff', internalType: 'uint256', type: 'uint256' },
          { name: 'cubicCoeff', internalType: 'uint256', type: 'uint256' },
          { name: 'quadraticCoeff', internalType: 'uint256', type: 'uint256' },
          {
            name: 'normalizationFactor',
            internalType: 'uint256',
            type: 'uint256',
          },
        ],
      },
      { name: 'currentSupply', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'calculateCost',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'params',
        internalType: 'struct BondingCurveMath.Params',
        type: 'tuple',
        components: [
          { name: 'initialPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'quarticCoeff', internalType: 'uint256', type: 'uint256' },
          { name: 'cubicCoeff', internalType: 'uint256', type: 'uint256' },
          { name: 'quadraticCoeff', internalType: 'uint256', type: 'uint256' },
          {
            name: 'normalizationFactor',
            internalType: 'uint256',
            type: 'uint256',
          },
        ],
      },
      { name: 'currentSupply', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'calculateRefund',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'nftCount', internalType: 'uint256', type: 'uint256' },
      { name: 'targetETH', internalType: 'uint256', type: 'uint256' },
      { name: 'unitPerNFT', internalType: 'uint256', type: 'uint256' },
      { name: 'liquidityReserveBps', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'computeCurveParams',
    outputs: [
      {
        name: 'params',
        internalType: 'struct BondingCurveMath.Params',
        type: 'tuple',
        components: [
          { name: 'initialPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'quarticCoeff', internalType: 'uint256', type: 'uint256' },
          { name: 'cubicCoeff', internalType: 'uint256', type: 'uint256' },
          { name: 'quadraticCoeff', internalType: 'uint256', type: 'uint256' },
          {
            name: 'normalizationFactor',
            internalType: 'uint256',
            type: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cubicWeight',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'quadraticWeight',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'quarticWeight',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_quarticWeight', internalType: 'uint256', type: 'uint256' },
      { name: '_cubicWeight', internalType: 'uint256', type: 'uint256' },
      { name: '_quadraticWeight', internalType: 'uint256', type: 'uint256' },
      { name: '_baseWeight', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setCurveWeights',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  { type: 'event', anonymous: false, inputs: [], name: 'CurveWeightsUpdated' },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AmountExceedsSupply' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidBounds' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NormalizationFactorZero' },
  { type: 'error', inputs: [], name: 'ReferenceAreaZero' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// CypherLiquidityDeployerModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const cypherLiquidityDeployerModuleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_algebraFactory', internalType: 'address', type: 'address' },
      { name: '_positionManager', internalType: 'address', type: 'address' },
      { name: '_weth', internalType: 'address', type: 'address' },
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_INIT_PRICE_DEVIATION_BPS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'TICK_LOWER',
    outputs: [{ name: '', internalType: 'int24', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'TICK_UPPER',
    outputs: [{ name: '', internalType: 'int24', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'algebraFactory',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'p',
        internalType: 'struct ILiquidityDeployerModule.DeployParams',
        type: 'tuple',
        components: [
          { name: 'ethReserve', internalType: 'uint256', type: 'uint256' },
          { name: 'tokenReserve', internalType: 'uint256', type: 'uint256' },
          {
            name: 'protocolTreasury',
            internalType: 'address',
            type: 'address',
          },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'carveEth', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'deployLiquidity',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'positionManager',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'requested',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'paid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CreatorCarvePaid',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'treasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'GraduationFeePaid',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'GraduationVaultContribution',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'pool',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'ethToLP',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'tokenToLP',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LiquidityDeployed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MetadataURIUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'ETHMismatch' },
  { type: 'error', inputs: [], name: 'InvalidParams' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'PoolPriceMismatch' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCaller' },
  { type: 'error', inputs: [], name: 'ZeroLiquidity' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// DeployBondEscrow
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const deployBondEscrowAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_owner', internalType: 'address', type: 'address' },
      { name: '_factory', internalType: 'address', type: 'address' },
      { name: '_protocolTreasury', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondAmount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'bonds',
    outputs: [
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'createdAt', internalType: 'uint40', type: 'uint40' },
      { name: 'settled', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'forfeit',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'graceDays',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'maxBondDuration',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
    ],
    name: 'postBond',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'refund',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'release',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '_bondAmount', internalType: 'uint256', type: 'uint256' }],
    name: 'setBondAmount',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_graceDays', internalType: 'uint256', type: 'uint256' }],
    name: 'setGraceDays',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_maxBondDuration', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setMaxBondDuration',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newBondAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondAmountUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondForfeited',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondPosted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondRefunded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondReleased',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newGraceDays',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'GraceDaysUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newMaxBondDuration',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'MaxBondDurationUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  { type: 'error', inputs: [], name: 'AlreadyGraduated' },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'BondAlreadyPosted' },
  { type: 'error', inputs: [], name: 'BondAlreadySettled' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoBond' },
  { type: 'error', inputs: [], name: 'NoBondValue' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotGraduated' },
  { type: 'error', inputs: [], name: 'NotYetForfeitable' },
  { type: 'error', inputs: [], name: 'OnlyFactory' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC1155Factory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc1155FactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      {
        name: '_globalMessageRegistry',
        internalType: 'address',
        type: 'address',
      },
      { name: '_componentRegistry', internalType: 'address', type: 'address' },
      { name: '_weth', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'componentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IComponentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'computeInstanceAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      {
        name: 'params',
        internalType: 'struct ERC1155Factory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'styleUri', internalType: 'string', type: 'string' },
          { name: 'gatingModule', internalType: 'address', type: 'address' },
          {
            name: 'freeMint',
            internalType: 'struct FreeMintParams',
            type: 'tuple',
            components: [
              { name: 'allocation', internalType: 'uint256', type: 'uint256' },
              {
                name: 'scope',
                internalType: 'enum GatingScope',
                type: 'uint8',
              },
            ],
          },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      {
        name: 'params',
        internalType: 'struct ERC1155Factory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'styleUri', internalType: 'string', type: 'string' },
          { name: 'gatingModule', internalType: 'address', type: 'address' },
          {
            name: 'freeMint',
            internalType: 'struct FreeMintParams',
            type: 'tuple',
            components: [
              { name: 'allocation', internalType: 'uint256', type: 'uint256' },
              {
                name: 'scope',
                internalType: 'enum GatingScope',
                type: 'uint8',
              },
            ],
          },
        ],
      },
      {
        name: 'gatingConfig',
        internalType: 'struct TierConfig',
        type: 'tuple',
        components: [
          { name: 'tierType', internalType: 'enum TierType', type: 'uint8' },
          {
            name: 'passwordHashes',
            internalType: 'bytes32[]',
            type: 'bytes32[]',
          },
          { name: 'volumeCaps', internalType: 'uint256[]', type: 'uint256[]' },
          {
            name: 'tierUnlockTimes',
            internalType: 'uint256[]',
            type: 'uint256[]',
          },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'dynamicPricingModule',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'features',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocol',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requiredFeatures',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'module', internalType: 'address', type: 'address' }],
    name: 'setDynamicPricingModule',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWeth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'InstanceCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'NameAlreadyTaken' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotAuthorizedAgent' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'UnapprovedComponent' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'VaultMustBeContract' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC1155Instance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc1155InstanceAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_name', internalType: 'string', type: 'string' },
      { name: '_creator', internalType: 'address', type: 'address' },
      { name: '_factory', internalType: 'address', type: 'address' },
      { name: '_vault', internalType: 'address', type: 'address' },
      { name: '_styleUri', internalType: 'string', type: 'string' },
      {
        name: '_init',
        internalType: 'struct ERC1155Instance.InstanceInit',
        type: 'tuple',
        components: [
          {
            name: 'globalMessageRegistry',
            internalType: 'address',
            type: 'address',
          },
          {
            name: 'protocolTreasury',
            internalType: 'address',
            type: 'address',
          },
          { name: 'masterRegistry', internalType: 'address', type: 'address' },
          { name: 'gatingModule', internalType: 'address', type: 'address' },
          {
            name: 'dynamicPricingModule',
            internalType: 'address',
            type: 'address',
          },
          { name: 'weth', internalType: 'address', type: 'address' },
        ],
      },
      { name: '_agentCreated', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pieceTitle', internalType: 'string', type: 'string' },
      { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
      { name: 'supply', internalType: 'uint256', type: 'uint256' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'pricingModel',
        internalType: 'enum ERC1155Instance.PricingModel',
        type: 'uint8',
      },
      { name: 'priceIncreaseRate', internalType: 'uint256', type: 'uint256' },
      { name: 'openTime', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'addEdition',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'agentDelegationEnabled',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'calculateMintCost',
    outputs: [{ name: 'totalCost', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimAllFees',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'gatingData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'claimFreeMint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimVaultFees',
    outputs: [
      { name: 'totalClaimed', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'creator',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'dynamicPricingModule',
    outputs: [
      {
        name: '',
        internalType: 'contract IDynamicPricingModule',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'editions',
    outputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceTitle', internalType: 'string', type: 'string' },
      { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
      { name: 'supply', internalType: 'uint256', type: 'uint256' },
      { name: 'minted', internalType: 'uint256', type: 'uint256' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'pricingModel',
        internalType: 'enum ERC1155Instance.PricingModel',
        type: 'uint8',
      },
      { name: 'priceIncreaseRate', internalType: 'uint256', type: 'uint256' },
      { name: 'openTime', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'freeMintAllocation',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'freeMintClaimed',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'freeMintsClaimed',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'gatingModule',
    outputs: [
      { name: '', internalType: 'contract IGatingModule', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'gatingScope',
    outputs: [{ name: '', internalType: 'enum GatingScope', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getAllEditionIds',
    outputs: [
      { name: 'editionIds', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'editionId', internalType: 'uint256', type: 'uint256' }],
    name: 'getCurrentPrice',
    outputs: [{ name: 'price', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'editionId', internalType: 'uint256', type: 'uint256' }],
    name: 'getEdition',
    outputs: [
      {
        name: '',
        internalType: 'struct ERC1155Instance.Edition',
        type: 'tuple',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'pieceTitle', internalType: 'string', type: 'string' },
          { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
          { name: 'supply', internalType: 'uint256', type: 'uint256' },
          { name: 'minted', internalType: 'uint256', type: 'uint256' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          {
            name: 'pricingModel',
            internalType: 'enum ERC1155Instance.PricingModel',
            type: 'uint8',
          },
          {
            name: 'priceIncreaseRate',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'openTime', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getEditionCount',
    outputs: [{ name: 'count', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getGlobalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IGlobalMessageRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'allocation', internalType: 'uint256', type: 'uint256' },
      { name: 'scope', internalType: 'enum GatingScope', type: 'uint8' },
    ],
    name: 'initializeFreeMint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'instanceType',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newVault', internalType: 'address', type: 'address' }],
    name: 'migrateVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'gatingData', internalType: 'bytes', type: 'bytes' },
      { name: 'messageData', internalType: 'bytes', type: 'bytes' },
      { name: 'maxCost', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'mint',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextEditionId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingVaultCut',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'retryVaultContribution',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'amounts', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'enabled', internalType: 'bool', type: 'bool' }],
    name: 'setAgentDelegation',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setStyle',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'styleUri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalProceeds',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalWithdrawn',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
    ],
    name: 'updateEditionMetadata',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'vault',
    outputs: [
      { name: '', internalType: 'contract IAlignmentVault', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHTransferFallbackToWETH',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'editionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'pieceTitle',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'basePrice',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'supply',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'pricingModel',
        internalType: 'enum ERC1155Instance.PricingModel',
        type: 'uint8',
        indexed: false,
      },
    ],
    name: 'EditionAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'editionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'metadataURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'EditionMetadataUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'editionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'FreeMintClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'editionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'totalCost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Minted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newState',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'StateChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'ids',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'TransferBatch',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TransferSingle',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VaultContributionFailed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VaultContributionRetried',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'artistAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'vaultCut',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'protocolCut',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Withdrawn',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AmountMustBePositive' },
  { type: 'error', inputs: [], name: 'DynamicPricingRequiresIncreaseRate' },
  { type: 'error', inputs: [], name: 'ERC1155RejectedTokens' },
  { type: 'error', inputs: [], name: 'EditionLimitReached' },
  { type: 'error', inputs: [], name: 'EditionNotFound' },
  { type: 'error', inputs: [], name: 'EditionNotOpen' },
  { type: 'error', inputs: [], name: 'EditionSoldOut' },
  { type: 'error', inputs: [], name: 'ExceedsMaxCost' },
  { type: 'error', inputs: [], name: 'ExceedsSupply' },
  { type: 'error', inputs: [], name: 'FreeMintAlreadyClaimed' },
  { type: 'error', inputs: [], name: 'FreeMintDisabled' },
  { type: 'error', inputs: [], name: 'FreeMintExhausted' },
  { type: 'error', inputs: [], name: 'GatingCheckFailed' },
  { type: 'error', inputs: [], name: 'InsufficientBalance' },
  { type: 'error', inputs: [], name: 'InsufficientPayment' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'InvalidPrice' },
  { type: 'error', inputs: [], name: 'InvalidTitle' },
  { type: 'error', inputs: [], name: 'LengthMismatch' },
  { type: 'error', inputs: [], name: 'LimitedMustHavePositiveSupply' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoDynamicPricingModule' },
  { type: 'error', inputs: [], name: 'NoFeesToClaim' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoPendingVaultCut' },
  { type: 'error', inputs: [], name: 'OnlyFactory' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  {
    type: 'error',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SmartTransferFailed',
  },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  {
    type: 'error',
    inputs: [{ name: 'vaultType', internalType: 'string', type: 'string' }],
    name: 'UnknownVaultFamily',
  },
  { type: 'error', inputs: [], name: 'UnlimitedMustHaveZeroSupply' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC404BondingInstance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc404BondingInstanceAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  { type: 'fallback', stateMutability: 'payable' },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'activateStaking',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'agentDelegationEnabled',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'spender', internalType: 'address', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'spender', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondingActive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondingFeeBps',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondingMaturityTime',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondingOpenTime',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'maxCost', internalType: 'uint256', type: 'uint256' },
      { name: 'mintNFT', internalType: 'bool', type: 'bool' },
      { name: 'gatingData', internalType: 'bytes', type: 'bytes' },
      { name: 'messageData', internalType: 'bytes', type: 'bytes' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'buyBonding',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimAllFees',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'gatingData', internalType: 'bytes', type: 'bytes' }],
    name: 'claimFreeMint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimStakingRewards',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'curveParams',
    outputs: [
      { name: 'initialPrice', internalType: 'uint256', type: 'uint256' },
      { name: 'quarticCoeff', internalType: 'uint256', type: 'uint256' },
      { name: 'cubicCoeff', internalType: 'uint256', type: 'uint256' },
      { name: 'quadraticCoeff', internalType: 'uint256', type: 'uint256' },
      { name: 'normalizationFactor', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'decimals',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'declaredMaxAllowanceBps',
    outputs: [{ name: '', internalType: 'uint16', type: 'uint16' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'carveRequestBps', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'deployLiquidity',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'freeMintAllocation',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'freeMintClaimed',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'freeMintsClaimed',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'gatingActive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'gatingModule',
    outputs: [
      { name: '', internalType: 'contract IGatingModule', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'gatingScope',
    outputs: [{ name: '', internalType: 'enum GatingScope', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'getSkipNFT',
    outputs: [{ name: 'result', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IGlobalMessageRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'graduated',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32' },
      { name: 'm', internalType: 'address', type: 'address' },
    ],
    name: 'initModule',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'vault_', internalType: 'address', type: 'address' },
      {
        name: 'bonding',
        internalType: 'struct ERC404BondingInstance.BondingParams',
        type: 'tuple',
        components: [
          { name: 'maxSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'unit', internalType: 'uint256', type: 'uint256' },
          {
            name: 'liquidityReserveBps',
            internalType: 'uint256',
            type: 'uint256',
          },
          {
            name: 'declaredMaxAllowanceBps',
            internalType: 'uint16',
            type: 'uint16',
          },
          {
            name: 'curve',
            internalType: 'struct BondingCurveMath.Params',
            type: 'tuple',
            components: [
              {
                name: 'initialPrice',
                internalType: 'uint256',
                type: 'uint256',
              },
              {
                name: 'quarticCoeff',
                internalType: 'uint256',
                type: 'uint256',
              },
              { name: 'cubicCoeff', internalType: 'uint256', type: 'uint256' },
              {
                name: 'quadraticCoeff',
                internalType: 'uint256',
                type: 'uint256',
              },
              {
                name: 'normalizationFactor',
                internalType: 'uint256',
                type: 'uint256',
              },
            ],
          },
        ],
      },
      { name: '_liquidityDeployer', internalType: 'address', type: 'address' },
      { name: '_gatingModule', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'allocation', internalType: 'uint256', type: 'uint256' },
      { name: 'scope', internalType: 'enum GatingScope', type: 'uint8' },
    ],
    name: 'initializeFreeMint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'name_', internalType: 'string', type: 'string' },
      { name: 'symbol_', internalType: 'string', type: 'string' },
      { name: 'styleUri_', internalType: 'string', type: 'string' },
      { name: 'tokenBaseURI_', internalType: 'string', type: 'string' },
    ],
    name: 'initializeMetadata',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'protocol',
        internalType: 'struct ERC404BondingInstance.ProtocolParams',
        type: 'tuple',
        components: [
          {
            name: 'globalMessageRegistry',
            internalType: 'address',
            type: 'address',
          },
          {
            name: 'protocolTreasury',
            internalType: 'address',
            type: 'address',
          },
          { name: 'masterRegistry', internalType: 'address', type: 'address' },
          { name: 'bondingFeeBps', internalType: 'uint256', type: 'uint256' },
          { name: 'weth', internalType: 'address', type: 'address' },
        ],
      },
    ],
    name: 'initializeProtocol',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_stakingModule', internalType: 'address', type: 'address' },
    ],
    name: 'initializeStaking',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'instanceType',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'liquidityDeployer',
    outputs: [
      {
        name: '',
        internalType: 'contract ILiquidityDeployerModule',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'liquidityReserve',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'maxSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newVault', internalType: 'address', type: 'address' }],
    name: 'migrateVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'mirrorERC721',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    name: 'modules',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'carveRequestBps', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'previewCarve',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tokenAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'exemptedNFTIds', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    name: 'rerollSelectedNFTs',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'reserve',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'minRefund', internalType: 'uint256', type: 'uint256' },
      { name: 'passwordHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'messageData', internalType: 'bytes', type: 'bytes' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'sellBonding',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'enabled', internalType: 'bool', type: 'bool' }],
    name: 'setAgentDelegation',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'setAgentDelegationFromFactory',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_active', internalType: 'bool', type: 'bool' }],
    name: 'setBondingActive',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'timestamp', internalType: 'uint256', type: 'uint256' }],
    name: 'setBondingMaturityTime',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'timestamp', internalType: 'uint256', type: 'uint256' }],
    name: 'setBondingOpenTime',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'skipNFT', internalType: 'bool', type: 'bool' }],
    name: 'setSkipNFT',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setStyle',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'stake',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'stakingActive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'stakingModule',
    outputs: [
      {
        name: '',
        internalType: 'contract IERC404StakingModule',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'styleUri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalBondingSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalSupply',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transfer',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'unit',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'unstake',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'vault',
    outputs: [
      { name: '', internalType: 'contract IAlignmentVault', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'withdrawDust',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'enabled', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'AgentDelegationChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'spender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'active', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'BondingActiveChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'buyer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'feeAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondingFeePaid',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'maturityTime',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondingMaturityTimeSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'openTime',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondingOpenTimeSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      { name: 'isBuy', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'BondingSale',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHTransferFallbackToWETH',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'FreeMintClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'deployer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amountToken',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'amountETH',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LiquidityDeployed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'role', internalType: 'bytes32', type: 'bytes32', indexed: true },
      {
        name: 'module',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'ModuleSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'tokensReturned',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RerollCompleted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'tokenAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'exemptedNFTIds',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'RerollInitiated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'status', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'SkipNFTSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Staked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'stakingModule',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'StakingActivated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'StakingRewardsClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newState',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'StateChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Transfer',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'rewardPaid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Unstaked',
  },
  { type: 'error', inputs: [], name: 'AlreadyDeployed' },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AmountExceedsSupply' },
  { type: 'error', inputs: [], name: 'ApprovalCallerNotOwnerNorApproved' },
  { type: 'error', inputs: [], name: 'BalanceMismatchAfterReroll' },
  { type: 'error', inputs: [], name: 'BondingEnded' },
  { type: 'error', inputs: [], name: 'BondingNotActive' },
  { type: 'error', inputs: [], name: 'BondingNotConfigured' },
  { type: 'error', inputs: [], name: 'CannotActivateAfterLiquidityDeployed' },
  { type: 'error', inputs: [], name: 'DNAlreadyInitialized' },
  { type: 'error', inputs: [], name: 'DNNotInitialized' },
  { type: 'error', inputs: [], name: 'ExceedsBonding' },
  { type: 'error', inputs: [], name: 'FnSelectorNotRecognized' },
  { type: 'error', inputs: [], name: 'FreeMintAlreadyClaimed' },
  { type: 'error', inputs: [], name: 'FreeMintDisabled' },
  { type: 'error', inputs: [], name: 'FreeMintExhausted' },
  { type: 'error', inputs: [], name: 'GatingNotAllowed' },
  { type: 'error', inputs: [], name: 'InsufficientAllowance' },
  { type: 'error', inputs: [], name: 'InsufficientBalance' },
  { type: 'error', inputs: [], name: 'InsufficientTokenBalance' },
  { type: 'error', inputs: [], name: 'InvalidBounds' },
  { type: 'error', inputs: [], name: 'InvalidDeclaredMaxAllowance' },
  { type: 'error', inputs: [], name: 'InvalidGlobalMessageRegistry' },
  { type: 'error', inputs: [], name: 'InvalidLiquidityDeployer' },
  { type: 'error', inputs: [], name: 'InvalidMaxSupply' },
  { type: 'error', inputs: [], name: 'InvalidOwner' },
  { type: 'error', inputs: [], name: 'InvalidRefund' },
  { type: 'error', inputs: [], name: 'InvalidUnit' },
  { type: 'error', inputs: [], name: 'InvalidVault' },
  { type: 'error', inputs: [], name: 'LinkMirrorContractFailed' },
  { type: 'error', inputs: [], name: 'LowETHValue' },
  { type: 'error', inputs: [], name: 'MaturityMustBeAfterOpenTime' },
  { type: 'error', inputs: [], name: 'MaxCostExceeded' },
  { type: 'error', inputs: [], name: 'MetadataAlreadySet' },
  { type: 'error', inputs: [], name: 'MirrorAddressIsZero' },
  { type: 'error', inputs: [], name: 'ModuleAlreadySet' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoReserve' },
  { type: 'error', inputs: [], name: 'NormalizationFactorZero' },
  { type: 'error', inputs: [], name: 'NotInitialized' },
  { type: 'error', inputs: [], name: 'NothingToWithdraw' },
  { type: 'error', inputs: [], name: 'OnlyFactory' },
  { type: 'error', inputs: [], name: 'OpenTimeMustBeSetFirst' },
  { type: 'error', inputs: [], name: 'OpenTimeNotSet' },
  { type: 'error', inputs: [], name: 'PurchaseTooSmall' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'SenderNotMirror' },
  {
    type: 'error',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SmartTransferFailed',
  },
  { type: 'error', inputs: [], name: 'StakingAlreadyActive' },
  { type: 'error', inputs: [], name: 'StakingModuleNotSet' },
  { type: 'error', inputs: [], name: 'TimeMustBeInFuture' },
  { type: 'error', inputs: [], name: 'TokenAmountMustBePositive' },
  { type: 'error', inputs: [], name: 'TokenAmountMustRepresentNFT' },
  { type: 'error', inputs: [], name: 'TokenDoesNotExist' },
  { type: 'error', inputs: [], name: 'TooEarly' },
  { type: 'error', inputs: [], name: 'TotalSupplyOverflow' },
  { type: 'error', inputs: [], name: 'TransactionExpired' },
  { type: 'error', inputs: [], name: 'TransferCallerNotOwnerNorApproved' },
  { type: 'error', inputs: [], name: 'TransferFromIncorrectOwner' },
  { type: 'error', inputs: [], name: 'TransferToZeroAddress' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'WithdrawFailed' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC404Factory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc404FactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'core',
        internalType: 'struct ERC404Factory.CoreConfig',
        type: 'tuple',
        components: [
          { name: 'implementation', internalType: 'address', type: 'address' },
          { name: 'masterRegistry', internalType: 'address', type: 'address' },
          { name: 'protocol', internalType: 'address', type: 'address' },
          { name: 'weth', internalType: 'address', type: 'address' },
        ],
      },
      {
        name: 'modules',
        internalType: 'struct ERC404Factory.ModuleConfig',
        type: 'tuple',
        components: [
          {
            name: 'globalMessageRegistry',
            internalType: 'address',
            type: 'address',
          },
          {
            name: 'componentRegistry',
            internalType: 'address',
            type: 'address',
          },
          { name: 'launchManager', internalType: 'address', type: 'address' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'PROTOCOL_ROLE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondingFeeBps',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'carveBracketParams',
    outputs: [
      {
        name: '',
        internalType: 'struct RevenueSplitLib.BracketParams',
        type: 'tuple',
        components: [
          { name: 'b1', internalType: 'uint256', type: 'uint256' },
          { name: 'b2', internalType: 'uint256', type: 'uint256' },
          { name: 'r1', internalType: 'uint16', type: 'uint16' },
          { name: 'r2', internalType: 'uint16', type: 'uint16' },
          { name: 'r3', internalType: 'uint16', type: 'uint16' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'componentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IComponentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'computeInstanceAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'params',
        internalType: 'struct ERC404Factory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'styleUri', internalType: 'string', type: 'string' },
          { name: 'tokenBaseURI', internalType: 'string', type: 'string' },
          { name: 'owner', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'nftCount', internalType: 'uint256', type: 'uint256' },
          { name: 'presetId', internalType: 'uint8', type: 'uint8' },
          { name: 'stakingModule', internalType: 'address', type: 'address' },
          {
            name: 'declaredMaxAllowanceBps',
            internalType: 'uint16',
            type: 'uint16',
          },
        ],
      },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'liquidityDeployer', internalType: 'address', type: 'address' },
      { name: 'gatingModule', internalType: 'address', type: 'address' },
      {
        name: 'freeMint',
        internalType: 'struct FreeMintParams',
        type: 'tuple',
        components: [
          { name: 'allocation', internalType: 'uint256', type: 'uint256' },
          { name: 'scope', internalType: 'enum GatingScope', type: 'uint8' },
        ],
      },
      {
        name: 'gatingConfig',
        internalType: 'struct TierConfig',
        type: 'tuple',
        components: [
          { name: 'tierType', internalType: 'enum TierType', type: 'uint8' },
          {
            name: 'passwordHashes',
            internalType: 'bytes32[]',
            type: 'bytes32[]',
          },
          { name: 'volumeCaps', internalType: 'uint256[]', type: 'uint256[]' },
          {
            name: 'tierUnlockTimes',
            internalType: 'uint256[]',
            type: 'uint256[]',
          },
        ],
      },
      {
        name: 'metadataConfig',
        internalType: 'struct ERC404Factory.MetadataConfig',
        type: 'tuple',
        components: [
          { name: 'resolver', internalType: 'address', type: 'address' },
          {
            name: 'childResolvers',
            internalType: 'address[]',
            type: 'address[]',
          },
          { name: 'overlay', internalType: 'address', type: 'address' },
          { name: 'tier', internalType: 'address', type: 'address' },
          {
            name: 'tiers',
            internalType: 'struct TierRevealModule.Tier[]',
            type: 'tuple[]',
            components: [
              { name: 'idStart', internalType: 'uint256', type: 'uint256' },
              { name: 'idEnd', internalType: 'uint256', type: 'uint256' },
              { name: 'minBalance', internalType: 'uint256', type: 'uint256' },
              { name: 'baseURI', internalType: 'string', type: 'string' },
              { name: 'lockedURI', internalType: 'string', type: 'string' },
            ],
          },
          { name: 'autoLatest', internalType: 'bool', type: 'bool' },
          {
            name: 'defaultPayout',
            internalType: 'enum MetadataOverlayModule.Payout',
            type: 'uint8',
          },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'params',
        internalType: 'struct ERC404Factory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'styleUri', internalType: 'string', type: 'string' },
          { name: 'tokenBaseURI', internalType: 'string', type: 'string' },
          { name: 'owner', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'nftCount', internalType: 'uint256', type: 'uint256' },
          { name: 'presetId', internalType: 'uint8', type: 'uint8' },
          { name: 'stakingModule', internalType: 'address', type: 'address' },
          {
            name: 'declaredMaxAllowanceBps',
            internalType: 'uint16',
            type: 'uint16',
          },
        ],
      },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'liquidityDeployer', internalType: 'address', type: 'address' },
      { name: 'gatingModule', internalType: 'address', type: 'address' },
      {
        name: 'freeMint',
        internalType: 'struct FreeMintParams',
        type: 'tuple',
        components: [
          { name: 'allocation', internalType: 'uint256', type: 'uint256' },
          { name: 'scope', internalType: 'enum GatingScope', type: 'uint8' },
        ],
      },
      {
        name: 'gatingConfig',
        internalType: 'struct TierConfig',
        type: 'tuple',
        components: [
          { name: 'tierType', internalType: 'enum TierType', type: 'uint8' },
          {
            name: 'passwordHashes',
            internalType: 'bytes32[]',
            type: 'bytes32[]',
          },
          { name: 'volumeCaps', internalType: 'uint256[]', type: 'uint256[]' },
          {
            name: 'tierUnlockTimes',
            internalType: 'uint256[]',
            type: 'uint256[]',
          },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'params',
        internalType: 'struct ERC404Factory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'styleUri', internalType: 'string', type: 'string' },
          { name: 'tokenBaseURI', internalType: 'string', type: 'string' },
          { name: 'owner', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'nftCount', internalType: 'uint256', type: 'uint256' },
          { name: 'presetId', internalType: 'uint8', type: 'uint8' },
          { name: 'stakingModule', internalType: 'address', type: 'address' },
          {
            name: 'declaredMaxAllowanceBps',
            internalType: 'uint16',
            type: 'uint16',
          },
        ],
      },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'liquidityDeployer', internalType: 'address', type: 'address' },
      { name: 'gatingModule', internalType: 'address', type: 'address' },
      {
        name: 'freeMint',
        internalType: 'struct FreeMintParams',
        type: 'tuple',
        components: [
          { name: 'allocation', internalType: 'uint256', type: 'uint256' },
          { name: 'scope', internalType: 'enum GatingScope', type: 'uint8' },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'deployBondEscrow',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'raise', internalType: 'uint256', type: 'uint256' },
      { name: 'declaredMaxBps', internalType: 'uint256', type: 'uint256' },
      { name: 'carveRequestBps', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'effectiveCarveEth',
    outputs: [{ name: 'carveEth', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'features',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'roles', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'grantRoles',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'roles', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'hasAllRoles',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'roles', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'hasAnyRole',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'implementation',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'launchManager',
    outputs: [
      { name: '', internalType: 'contract LaunchManager', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'minPoolEth',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocol',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'roles', internalType: 'uint256', type: 'uint256' }],
    name: 'renounceRoles',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requiredFeatures',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'roles', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'revokeRoles',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'rolesOf',
    outputs: [{ name: 'roles', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_bps', internalType: 'uint256', type: 'uint256' }],
    name: 'setBondingFeeBps',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'p',
        internalType: 'struct RevenueSplitLib.BracketParams',
        type: 'tuple',
        components: [
          { name: 'b1', internalType: 'uint256', type: 'uint256' },
          { name: 'b2', internalType: 'uint256', type: 'uint256' },
          { name: 'r1', internalType: 'uint16', type: 'uint16' },
          { name: 'r2', internalType: 'uint16', type: 'uint16' },
          { name: 'r3', internalType: 'uint16', type: 'uint16' },
        ],
      },
    ],
    name: 'setCarveBrackets',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_escrow', internalType: 'address', type: 'address' }],
    name: 'setDeployBondEscrow',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_minPoolEth', internalType: 'uint256', type: 'uint256' }],
    name: 'setMinPoolEth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWeth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newProtocol', internalType: 'address', type: 'address' }],
    name: 'transferProtocolRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newBps',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondingFeeUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'b1', internalType: 'uint256', type: 'uint256', indexed: false },
      { name: 'b2', internalType: 'uint256', type: 'uint256', indexed: false },
      { name: 'r1', internalType: 'uint16', type: 'uint16', indexed: false },
      { name: 'r2', internalType: 'uint16', type: 'uint16', indexed: false },
      { name: 'r3', internalType: 'uint16', type: 'uint16', indexed: false },
    ],
    name: 'CarveBracketsUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'declaredMaxAllowanceBps',
        internalType: 'uint16',
        type: 'uint16',
        indexed: false,
      },
    ],
    name: 'DeclaredMaxAllowance',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldEscrow',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newEscrow',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'DeployBondEscrowUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'symbol',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'InstanceCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newMinPoolEth',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'MinPoolEthUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'roles',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'RolesUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'capability',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'VaultCapabilityWarning',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'FreeMintAllocationExceedsNftCount' },
  { type: 'error', inputs: [], name: 'InsufficientBond' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidBracketParams' },
  { type: 'error', inputs: [], name: 'InvalidComponentRegistry' },
  { type: 'error', inputs: [], name: 'InvalidDeclaredMaxAllowance' },
  { type: 'error', inputs: [], name: 'InvalidGlobalMessageRegistry' },
  { type: 'error', inputs: [], name: 'InvalidImplementation' },
  { type: 'error', inputs: [], name: 'InvalidLaunchManager' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'InvalidNftCount' },
  { type: 'error', inputs: [], name: 'InvalidOwner' },
  { type: 'error', inputs: [], name: 'InvalidSymbol' },
  { type: 'error', inputs: [], name: 'MaxBondingFeeExceeded' },
  { type: 'error', inputs: [], name: 'NameAlreadyTaken' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotAuthorizedAgent' },
  { type: 'error', inputs: [], name: 'ProtocolRoleNotTransferable' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'UnapprovedCurveComputer' },
  { type: 'error', inputs: [], name: 'UnapprovedGatingModule' },
  { type: 'error', inputs: [], name: 'UnapprovedLiquidityDeployer' },
  { type: 'error', inputs: [], name: 'UnapprovedResolver' },
  { type: 'error', inputs: [], name: 'UnapprovedStakingModule' },
  { type: 'error', inputs: [], name: 'UnapprovedVault' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'VaultMustBeContract' },
  { type: 'error', inputs: [], name: 'VaultRequired' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC404StakingModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc404StakingModuleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'user', internalType: 'address', type: 'address' },
    ],
    name: 'calculatePendingRewards',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'computeClaim',
    outputs: [
      { name: 'rewardAmount', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'enableStaking',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'user', internalType: 'address', type: 'address' },
    ],
    name: 'getStakingInfo',
    outputs: [
      { name: 'enabled', internalType: 'bool', type: 'bool' },
      { name: 'userStaked', internalType: 'uint256', type: 'uint256' },
      { name: 'globalTotalStaked', internalType: 'uint256', type: 'uint256' },
      { name: 'userProportion', internalType: 'uint256', type: 'uint256' },
      { name: 'pendingRewards', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IMasterRegistryMin',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'delta', internalType: 'uint256', type: 'uint256' }],
    name: 'recordFeesReceived',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'recordStake',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'recordUnstake',
    outputs: [
      { name: 'rewardAmount', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    name: 'rewardPerTokenPaid',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'rewardPerTokenStored',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    name: 'rewardsAccrued',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    name: 'stakedBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'stakingEnabled',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'totalStaked',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'delta',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newCumulative',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeesReceived',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RewardsClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newTotal',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Staked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'StakingEnabled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newTotal',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Unstaked',
  },
  { type: 'error', inputs: [], name: 'AlreadyEnabled' },
  { type: 'error', inputs: [], name: 'AmountMustBePositive' },
  { type: 'error', inputs: [], name: 'InsufficientStakedBalance' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'NoPendingRewards' },
  { type: 'error', inputs: [], name: 'NoStakedBalance' },
  { type: 'error', inputs: [], name: 'NotRegisteredInstance' },
  { type: 'error', inputs: [], name: 'StakingNotEnabled' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC721AuctionFactory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc721AuctionFactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      {
        name: '_globalMessageRegistry',
        internalType: 'address',
        type: 'address',
      },
      { name: '_weth', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'computeInstanceAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      {
        name: 'params',
        internalType: 'struct ERC721AuctionFactory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'lines', internalType: 'uint8', type: 'uint8' },
          { name: 'baseDuration', internalType: 'uint40', type: 'uint40' },
          { name: 'timeBuffer', internalType: 'uint40', type: 'uint40' },
          { name: 'bidIncrement', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'features',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocol',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requiredFeatures',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWeth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'InstanceCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'capability',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'VaultCapabilityWarning',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'NameAlreadyTaken' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotAuthorizedAgent' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'VaultMustBeContract' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC721AuctionInstance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc721AuctionInstanceAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'p',
        internalType: 'struct ERC721AuctionInstance.ConstructorParams',
        type: 'tuple',
        components: [
          { name: 'vault', internalType: 'address', type: 'address' },
          {
            name: 'protocolTreasury',
            internalType: 'address',
            type: 'address',
          },
          { name: 'owner', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'lines', internalType: 'uint8', type: 'uint8' },
          { name: 'baseDuration', internalType: 'uint40', type: 'uint40' },
          { name: 'timeBuffer', internalType: 'uint40', type: 'uint40' },
          { name: 'bidIncrement', internalType: 'uint256', type: 'uint256' },
          {
            name: 'globalMessageRegistry',
            internalType: 'address',
            type: 'address',
          },
          { name: 'masterRegistry', internalType: 'address', type: 'address' },
          { name: 'factory', internalType: 'address', type: 'address' },
          { name: 'weth', internalType: 'address', type: 'address' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'agentDelegationEnabled',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint24', type: 'uint24' }],
    name: 'auctions',
    outputs: [
      { name: 'tokenId', internalType: 'uint24', type: 'uint24' },
      { name: 'tokenURI', internalType: 'string', type: 'string' },
      { name: 'minBid', internalType: 'uint256', type: 'uint256' },
      { name: 'highBidder', internalType: 'address', type: 'address' },
      { name: 'highBid', internalType: 'uint256', type: 'uint256' },
      { name: 'startTime', internalType: 'uint40', type: 'uint40' },
      { name: 'endTime', internalType: 'uint40', type: 'uint40' },
      { name: 'settled', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'baseDuration',
    outputs: [{ name: '', internalType: 'uint40', type: 'uint40' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bidIncrement',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimAllFees',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimVaultFees',
    outputs: [
      { name: 'totalClaimed', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tokenId', internalType: 'uint24', type: 'uint24' },
      { name: 'messageData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'createBid',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'flushPendingVaultCut',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'line', internalType: 'uint8', type: 'uint8' }],
    name: 'getActiveAuction',
    outputs: [{ name: 'tokenId', internalType: 'uint24', type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'getApproved',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint24', type: 'uint24' }],
    name: 'getAuction',
    outputs: [
      {
        name: '',
        internalType: 'struct ERC721AuctionInstance.Auction',
        type: 'tuple',
        components: [
          { name: 'tokenId', internalType: 'uint24', type: 'uint24' },
          { name: 'tokenURI', internalType: 'string', type: 'string' },
          { name: 'minBid', internalType: 'uint256', type: 'uint256' },
          { name: 'highBidder', internalType: 'address', type: 'address' },
          { name: 'highBid', internalType: 'uint256', type: 'uint256' },
          { name: 'startTime', internalType: 'uint40', type: 'uint40' },
          { name: 'endTime', internalType: 'uint40', type: 'uint40' },
          { name: 'settled', internalType: 'bool', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getGlobalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'line', internalType: 'uint8', type: 'uint8' }],
    name: 'getQueueLength',
    outputs: [{ name: 'remaining', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IGlobalMessageRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'instanceType',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      { name: 'owner', internalType: 'address', type: 'address' },
      { name: 'operator', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: 'result', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    name: 'lineQueueHead',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint8', type: 'uint8' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'lineQueues',
    outputs: [{ name: '', internalType: 'uint24', type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'lines',
    outputs: [{ name: '', internalType: 'uint8', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newVault', internalType: 'address', type: 'address' }],
    name: 'migrateVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextTokenId',
    outputs: [{ name: '', internalType: 'uint24', type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingVaultCut',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_tokenURI', internalType: 'string', type: 'string' }],
    name: 'queuePiece',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint24', type: 'uint24' }],
    name: 'reclaimUnsold',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'enabled', internalType: 'bool', type: 'bool' }],
    name: 'setAgentDelegation',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'setAgentDelegationFromFactory',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'isApproved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint24', type: 'uint24' }],
    name: 'settleAuction',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'interfaceId', internalType: 'bytes4', type: 'bytes4' }],
    name: 'supportsInterface',
    outputs: [{ name: 'result', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'symbol',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'timeBuffer',
    outputs: [{ name: '', internalType: 'uint40', type: 'uint40' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'transferFrom',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'vault',
    outputs: [
      { name: '', internalType: 'contract IAlignmentVault', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'enabled', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'AgentDelegationChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
    ],
    name: 'Approval',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'owner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'isApproved',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tokenId',
        internalType: 'uint24',
        type: 'uint24',
        indexed: true,
      },
      {
        name: 'winner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'AuctionSettled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tokenId',
        internalType: 'uint24',
        type: 'uint24',
        indexed: true,
      },
      {
        name: 'startTime',
        internalType: 'uint40',
        type: 'uint40',
        indexed: false,
      },
      {
        name: 'endTime',
        internalType: 'uint40',
        type: 'uint40',
        indexed: false,
      },
    ],
    name: 'AuctionStarted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tokenId',
        internalType: 'uint24',
        type: 'uint24',
        indexed: true,
      },
      {
        name: 'bidder',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BidPlaced',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHTransferFallbackToWETH',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tokenId',
        internalType: 'uint24',
        type: 'uint24',
        indexed: true,
      },
      { name: 'line', internalType: 'uint8', type: 'uint8', indexed: true },
      {
        name: 'minBid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'tokenURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'PieceQueued',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newState',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'StateChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
    ],
    name: 'Transfer',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'tokenId',
        internalType: 'uint24',
        type: 'uint24',
        indexed: true,
      },
      {
        name: 'forfeitedDeposit',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'UnsoldReclaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VaultContributionFailed',
  },
  { type: 'error', inputs: [], name: 'AccountBalanceOverflow' },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AuctionAlreadySettled' },
  { type: 'error', inputs: [], name: 'AuctionDoesNotExist' },
  { type: 'error', inputs: [], name: 'AuctionExpired' },
  { type: 'error', inputs: [], name: 'AuctionNotEnded' },
  { type: 'error', inputs: [], name: 'AuctionNotStarted' },
  { type: 'error', inputs: [], name: 'BalanceQueryForZeroAddress' },
  { type: 'error', inputs: [], name: 'BidBelowMinimum' },
  { type: 'error', inputs: [], name: 'BidTooLow' },
  { type: 'error', inputs: [], name: 'DepositRequired' },
  { type: 'error', inputs: [], name: 'HasBids' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidBidIncrement' },
  { type: 'error', inputs: [], name: 'InvalidDuration' },
  { type: 'error', inputs: [], name: 'InvalidLine' },
  { type: 'error', inputs: [], name: 'InvalidLines' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'InvalidSymbol' },
  { type: 'error', inputs: [], name: 'InvalidTimeBuffer' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoBids' },
  { type: 'error', inputs: [], name: 'NoFeesToClaim' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotOwnerNorApproved' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  {
    type: 'error',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SmartTransferFailed',
  },
  { type: 'error', inputs: [], name: 'TokenAlreadyExists' },
  { type: 'error', inputs: [], name: 'TokenDoesNotExist' },
  { type: 'error', inputs: [], name: 'TransferFromIncorrectOwner' },
  { type: 'error', inputs: [], name: 'TransferToNonERC721ReceiverImplementer' },
  { type: 'error', inputs: [], name: 'TransferToZeroAddress' },
  { type: 'error', inputs: [], name: 'URIRequired' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  {
    type: 'error',
    inputs: [{ name: 'vaultType', internalType: 'string', type: 'string' }],
    name: 'UnknownVaultFamily',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// FeaturedQueueManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const featuredQueueManagerAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'boostRank',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'dailyDecayRate',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'dailyRate',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getEffectiveRank',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getFeaturedInstances',
    outputs: [
      { name: 'instances', internalType: 'address[]', type: 'address[]' },
      { name: 'total', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getRentalInfo',
    outputs: [
      { name: 'renter', internalType: 'address', type: 'address' },
      { name: 'effectiveRank', internalType: 'uint256', type: 'uint256' },
      { name: 'expiresAt', internalType: 'uint256', type: 'uint256' },
      { name: 'isActive', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      { name: '_owner', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'maxDuration',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'maxFeaturedSize',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'minDuration',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'pruneExpired',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'queueLength',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'duration', internalType: 'uint256', type: 'uint256' }],
    name: 'quoteDurationCost',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'additionalDuration', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'renewDuration',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'duration', internalType: 'uint256', type: 'uint256' },
      { name: 'rankBoost', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'rentFeatured',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_dailyDecayRate', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setDailyDecayRate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_dailyRate', internalType: 'uint256', type: 'uint256' }],
    name: 'setDailyRate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_min', internalType: 'uint256', type: 'uint256' },
      { name: '_max', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setDurationBounds',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'setMasterRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_max', internalType: 'uint256', type: 'uint256' }],
    name: 'setMaxFeaturedSize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWeth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'slots',
    outputs: [
      { name: 'renter', internalType: 'address', type: 'address' },
      { name: 'rankScore', internalType: 'uint256', type: 'uint256' },
      { name: 'lastBoostTime', internalType: 'uint256', type: 'uint256' },
      { name: 'expiresAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'renewer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'additionalDuration',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newExpiresAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'DurationRenewed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHTransferFallbackToWETH',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'renter',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'duration',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'durationCost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'rankBoost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'expiresAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeaturedRented',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'registry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'MasterRegistrySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'booster',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newEffectiveRank',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RankBoosted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyFeatured' },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'DurationTooLong' },
  { type: 'error', inputs: [], name: 'DurationTooShort' },
  { type: 'error', inputs: [], name: 'InstanceNotRegistered' },
  { type: 'error', inputs: [], name: 'InsufficientPayment' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidBounds' },
  { type: 'error', inputs: [], name: 'InvalidDuration' },
  { type: 'error', inputs: [], name: 'InvalidSize' },
  { type: 'error', inputs: [], name: 'MustSendETH' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'QueueFull' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'SlotExpired' },
  { type: 'error', inputs: [], name: 'SlotNotActive' },
  { type: 'error', inputs: [], name: 'SlotStillActive' },
  {
    type: 'error',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SmartTransferFailed',
  },
  { type: 'error', inputs: [], name: 'TreasuryNotSet' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// GlobalMessageRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const globalMessageRegistryAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_owner', internalType: 'address', type: 'address' },
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'messageCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'messageType', internalType: 'uint8', type: 'uint8' },
      { name: 'refId', internalType: 'uint256', type: 'uint256' },
      { name: 'actionRef', internalType: 'bytes32', type: 'bytes32' },
      { name: 'metadata', internalType: 'bytes32', type: 'bytes32' },
      { name: 'content', internalType: 'string', type: 'string' },
    ],
    name: 'post',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'posts',
        internalType: 'struct GlobalMessageRegistry.PostParams[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'messageType', internalType: 'uint8', type: 'uint8' },
          { name: 'refId', internalType: 'uint256', type: 'uint256' },
          { name: 'actionRef', internalType: 'bytes32', type: 'bytes32' },
          { name: 'metadata', internalType: 'bytes32', type: 'bytes32' },
          { name: 'value', internalType: 'uint256', type: 'uint256' },
          { name: 'content', internalType: 'string', type: 'string' },
        ],
      },
    ],
    name: 'postBatch',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'messageData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'postForAction',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'postThreshold',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'setMasterRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'v', internalType: 'uint256', type: 'uint256' }],
    name: 'setPostThreshold',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'withdrawETH',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'masterRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'MasterRegistrySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'messageId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'messageType',
        internalType: 'uint8',
        type: 'uint8',
        indexed: false,
      },
      {
        name: 'refId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'actionRef',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'metadata',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'content',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MessagePosted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'threshold',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'PostThresholdSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'EmptyBatch' },
  { type: 'error', inputs: [], name: 'InstanceMustBeCaller' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoETHToWithdraw' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotFromApprovedFactory' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
  { type: 'error', inputs: [], name: 'ValueMismatch' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IAlignmentRegistryDup
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iAlignmentRegistryDupAbi = [
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'isAlignmentTargetActive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'index', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'tokenToTargetIds',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ICarveParamsSource
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iCarveParamsSourceAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'raise', internalType: 'uint256', type: 'uint256' },
      { name: 'declaredMaxBps', internalType: 'uint256', type: 'uint256' },
      { name: 'carveRequestBps', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'effectiveCarveEth',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IDeployBondEscrow
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iDeployBondEscrowAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'bondAmount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
    ],
    name: 'postBond',
    outputs: [],
    stateMutability: 'payable',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155Balance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155BalanceAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getAllEditionIds',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getEditionCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155EditionReader
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155EditionReaderAbi = [
  {
    type: 'function',
    inputs: [{ name: 'editionId', internalType: 'uint256', type: 'uint256' }],
    name: 'getCurrentPrice',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'editionId', internalType: 'uint256', type: 'uint256' }],
    name: 'getEdition',
    outputs: [
      {
        name: '',
        internalType: 'struct IERC1155EditionReader.Edition',
        type: 'tuple',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'pieceTitle', internalType: 'string', type: 'string' },
          { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
          { name: 'supply', internalType: 'uint256', type: 'uint256' },
          { name: 'minted', internalType: 'uint256', type: 'uint256' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          {
            name: 'pricingModel',
            internalType: 'enum IERC1155EditionReader.PricingModel',
            type: 'uint8',
          },
          {
            name: 'priceIncreaseRate',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'openTime', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextEditionId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155Receiver
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155ReceiverAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC1155BatchReceived',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC1155Received',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC404Balance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc404BalanceAbi = [
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC404Staking
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc404StakingAbi = [
  {
    type: 'function',
    inputs: [{ name: 'staker', internalType: 'address', type: 'address' }],
    name: 'calculatePendingRewards',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'stakedBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'stakingEnabled',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IFeaturedQueueManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iFeaturedQueueManagerAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'startIndex', internalType: 'uint256', type: 'uint256' },
      { name: 'endIndex', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getFeaturedInstances',
    outputs: [
      { name: 'instances', internalType: 'address[]', type: 'address[]' },
      { name: 'total', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getRentalInfo',
    outputs: [
      { name: 'renter', internalType: 'address', type: 'address' },
      { name: 'effectiveRank', internalType: 'uint256', type: 'uint256' },
      { name: 'expiresAt', internalType: 'uint256', type: 'uint256' },
      { name: 'isActive', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IGlobalMessageRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iGlobalMessageRegistryAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'messageCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IMasterRegistryMin
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iMasterRegistryMinAbi = [
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'isRegisteredInstance',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IMerkleGatingModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iMerkleGatingModuleAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      {
        name: 'config',
        internalType: 'struct MerkleConfig',
        type: 'tuple',
        components: [
          { name: 'editionId', internalType: 'uint256', type: 'uint256' },
          { name: 'roots', internalType: 'bytes32[]', type: 'bytes32[]' },
          {
            name: 'tierOpenTimes',
            internalType: 'uint256[]',
            type: 'uint256[]',
          },
        ],
      },
    ],
    name: 'configureFor',
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IOverlayInstance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iOverlayInstanceAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'id', internalType: 'uint256', type: 'uint256' }],
    name: 'ownerOf',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'stakingModule',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'vault',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IOverlayStakedReader
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iOverlayStakedReaderAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'holder', internalType: 'address', type: 'address' },
    ],
    name: 'stakedBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IOwnable
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iOwnableAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IStakedBalanceReader
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iStakedBalanceReaderAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'holder', internalType: 'address', type: 'address' },
    ],
    name: 'stakedBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IStataToken
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iStataTokenAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'asset',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'shares', internalType: 'uint256', type: 'uint256' }],
    name: 'convertToAssets',
    outputs: [{ name: 'assets', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'assets', internalType: 'uint256', type: 'uint256' },
      { name: 'receiver', internalType: 'address', type: 'address' },
    ],
    name: 'deposit',
    outputs: [{ name: 'shares', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'maxWithdraw',
    outputs: [{ name: 'assets', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'assets', internalType: 'uint256', type: 'uint256' },
      { name: 'receiver', internalType: 'address', type: 'address' },
      { name: 'owner', internalType: 'address', type: 'address' },
    ],
    name: 'withdraw',
    outputs: [{ name: 'shares', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ITierInstance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iTierInstanceAbi = [
  {
    type: 'function',
    inputs: [{ name: 'holder', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'stakingModule',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IWETH
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iwethAbi = [
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// LiquidityDeployerModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const liquidityDeployerModuleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_v4PoolManager', internalType: 'address', type: 'address' },
      { name: '_weth', internalType: 'address', type: 'address' },
      { name: '_poolFee', internalType: 'uint24', type: 'uint24' },
      { name: '_tickSpacing', internalType: 'int24', type: 'int24' },
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_INIT_PRICE_DEVIATION_BPS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'p',
        internalType: 'struct ILiquidityDeployerModule.DeployParams',
        type: 'tuple',
        components: [
          { name: 'ethReserve', internalType: 'uint256', type: 'uint256' },
          { name: 'tokenReserve', internalType: 'uint256', type: 'uint256' },
          {
            name: 'protocolTreasury',
            internalType: 'address',
            type: 'address',
          },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'carveEth', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'deployLiquidity',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'poolFee',
    outputs: [{ name: '', internalType: 'uint24', type: 'uint24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'tickSpacing',
    outputs: [{ name: '', internalType: 'int24', type: 'int24' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'bytes', type: 'bytes' }],
    name: 'unlockCallback',
    outputs: [{ name: '', internalType: 'bytes', type: 'bytes' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'v4PoolManager',
    outputs: [
      { name: '', internalType: 'contract IPoolManager', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'requested',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'paid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CreatorCarvePaid',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'treasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'GraduationFeePaid',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'GraduationVaultContribution',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'pool', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amountToken',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'amountETH',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LiquidityDeployed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MetadataURIUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'ETHMismatch' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoETHForPool' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoTokensForPool' },
  { type: 'error', inputs: [], name: 'NotPoolManager' },
  { type: 'error', inputs: [], name: 'PoolPriceMismatch' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCaller' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MasterRegistryV1
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const masterRegistryV1Abi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'alignmentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IAlignmentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'componentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IComponentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'factoryAddress', internalType: 'address', type: 'address' },
    ],
    name: 'deactivateFactory',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    name: 'deactivateVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'emergencyRevoker',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'factoryIdToAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'factoryInfo',
    outputs: [
      { name: 'factoryAddress', internalType: 'address', type: 'address' },
      { name: 'factoryId', internalType: 'uint256', type: 'uint256' },
      { name: 'contractType', internalType: 'string', type: 'string' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'displayTitle', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'active', internalType: 'bool', type: 'bool' },
      { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getActiveVault',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'factoryId', internalType: 'uint256', type: 'uint256' }],
    name: 'getFactoryInfo',
    outputs: [
      {
        name: '',
        internalType: 'struct IMasterRegistry.FactoryInfo',
        type: 'tuple',
        components: [
          { name: 'factoryAddress', internalType: 'address', type: 'address' },
          { name: 'factoryId', internalType: 'uint256', type: 'uint256' },
          { name: 'contractType', internalType: 'string', type: 'string' },
          { name: 'title', internalType: 'string', type: 'string' },
          { name: 'displayTitle', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'features', internalType: 'bytes32[]', type: 'bytes32[]' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'active', internalType: 'bool', type: 'bool' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'factoryAddress', internalType: 'address', type: 'address' },
    ],
    name: 'getFactoryInfoByAddress',
    outputs: [
      {
        name: '',
        internalType: 'struct IMasterRegistry.FactoryInfo',
        type: 'tuple',
        components: [
          { name: 'factoryAddress', internalType: 'address', type: 'address' },
          { name: 'factoryId', internalType: 'uint256', type: 'uint256' },
          { name: 'contractType', internalType: 'string', type: 'string' },
          { name: 'title', internalType: 'string', type: 'string' },
          { name: 'displayTitle', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'features', internalType: 'bytes32[]', type: 'bytes32[]' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'active', internalType: 'bool', type: 'bool' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getInstanceInfo',
    outputs: [
      {
        name: '',
        internalType: 'struct IMasterRegistry.InstanceInfo',
        type: 'tuple',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'factory', internalType: 'address', type: 'address' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'vaults', internalType: 'address[]', type: 'address[]' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'nameHash', internalType: 'bytes32', type: 'bytes32' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getInstanceVaults',
    outputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getTotalFactories',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    name: 'getVaultInfo',
    outputs: [
      {
        name: '',
        internalType: 'struct IMasterRegistry.VaultInfo',
        type: 'tuple',
        components: [
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'active', internalType: 'bool', type: 'bool' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
          { name: 'targetId', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_owner', internalType: 'address', type: 'address' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'instanceInfo',
    outputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'factory', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'nameHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'isAgent',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'factory', internalType: 'address', type: 'address' }],
    name: 'isFactoryRegistered',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'isInstanceFromApprovedFactory',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'name', internalType: 'string', type: 'string' }],
    name: 'isNameTaken',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'isRegisteredInstance',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    name: 'isVaultRegistered',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'newVault', internalType: 'address', type: 'address' },
    ],
    name: 'migrateVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    name: 'nameHashes',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextFactoryId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'factoryAddress', internalType: 'address', type: 'address' },
      { name: 'contractType', internalType: 'string', type: 'string' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'displayTitle', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'features', internalType: 'bytes32[]', type: 'bytes32[]' },
    ],
    name: 'registerFactory',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'factory', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'vault', internalType: 'address', type: 'address' },
    ],
    name: 'registerInstance',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'vault', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'registerVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'registeredFactories',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'registeredVaults',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'agent', internalType: 'address', type: 'address' }],
    name: 'revokeAgent',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'revokeInstance',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'revokedInstances',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'agent', internalType: 'address', type: 'address' },
      { name: 'authorized', internalType: 'bool', type: 'bool' },
    ],
    name: 'setAgent',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_alignmentRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'setAlignmentRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_componentRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'setComponentRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_revoker', internalType: 'address', type: 'address' }],
    name: 'setEmergencyRevoker',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'uri', internalType: 'string', type: 'string' },
    ],
    name: 'updateInstanceMetadata',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'vaultInfo',
    outputs: [
      { name: 'vault', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'active', internalType: 'bool', type: 'bool' },
      { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'agent',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'authorized',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
    ],
    name: 'AgentUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'AlignmentRegistrySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'componentRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ComponentRegistrySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'CreatorInstanceAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldRevoker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newRevoker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'EmergencyRevokerSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'factoryAddress',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'factoryId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'FactoryDeactivated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'factoryAddress',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'factoryId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'contractType',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'FactoryRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'uri', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'InstanceMetadataUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'factory',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'InstanceRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'InstanceRevoked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newVault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'vaultIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'InstanceVaultMigrated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'VaultDeactivated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'VaultRegistered',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AlreadyRegistered' },
  { type: 'error', inputs: [], name: 'FactoryHasNoProtocol' },
  { type: 'error', inputs: [], name: 'FactoryNotActive' },
  { type: 'error', inputs: [], name: 'InstanceHasNoTreasury' },
  { type: 'error', inputs: [], name: 'InstanceHasNoVault' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidContractType' },
  { type: 'error', inputs: [], name: 'InvalidMetadataURI' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'InvalidTitle' },
  { type: 'error', inputs: [], name: 'MissingInstanceType' },
  { type: 'error', inputs: [], name: 'NameAlreadyTaken' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoAlignmentToken' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoVaults' },
  { type: 'error', inputs: [], name: 'NotEmergencyRevoker' },
  { type: 'error', inputs: [], name: 'NotRegistered' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'TargetNotActive' },
  { type: 'error', inputs: [], name: 'TokenNotInTarget' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
  { type: 'error', inputs: [], name: 'VaultAlreadyInArray' },
  { type: 'error', inputs: [], name: 'VaultMismatch' },
  { type: 'error', inputs: [], name: 'VaultMustBeContract' },
  { type: 'error', inputs: [], name: 'VaultNotDeployed' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MerkleGatingModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const merkleGatingModuleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'canMint',
    outputs: [
      { name: 'allowed', internalType: 'bool', type: 'bool' },
      { name: 'permanent', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'user', internalType: 'address', type: 'address' },
    ],
    name: 'claimed',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      {
        name: 'config',
        internalType: 'struct MerkleConfig',
        type: 'tuple',
        components: [
          { name: 'editionId', internalType: 'uint256', type: 'uint256' },
          { name: 'roots', internalType: 'bytes32[]', type: 'bytes32[]' },
          {
            name: 'tierOpenTimes',
            internalType: 'uint256[]',
            type: 'uint256[]',
          },
        ],
      },
    ],
    name: 'configureFor',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'configured',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getRoots',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getTierOpenTimes',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'onMint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MetadataURIUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'EmptyRootSet' },
  { type: 'error', inputs: [], name: 'InvalidProof' },
  { type: 'error', inputs: [], name: 'InvalidTier' },
  { type: 'error', inputs: [], name: 'LengthMismatch' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'QtyCapExceeded' },
  { type: 'error', inputs: [], name: 'TierNotOpen' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'ZeroRoot' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MetadataOverlayModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const metadataOverlayModuleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'autoLatest',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'commissionTerms',
    outputs: [
      {
        name: 'cond',
        internalType: 'enum MetadataOverlayModule.CommCond',
        type: 'uint8',
      },
      { name: 'price', internalType: 'uint256', type: 'uint256' },
      {
        name: 'payout',
        internalType: 'enum MetadataOverlayModule.Payout',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'commissionURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'commissionVisible',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'configured',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'defaultPayout',
    outputs: [
      {
        name: '',
        internalType: 'enum MetadataOverlayModule.Payout',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'autoLatest_', internalType: 'bool', type: 'bool' },
      {
        name: 'defaultPayout_',
        internalType: 'enum MetadataOverlayModule.Payout',
        type: 'uint8',
      },
    ],
    name: 'initConfig',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'paid',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'baseURI', internalType: 'string', type: 'string' },
      {
        name: 'cond',
        internalType: 'enum MetadataOverlayModule.WaveCond',
        type: 'uint8',
      },
      { name: 'threshold', internalType: 'uint256', type: 'uint256' },
      { name: 'price', internalType: 'uint256', type: 'uint256' },
      {
        name: 'payout',
        internalType: 'enum MetadataOverlayModule.Payout',
        type: 'uint8',
      },
    ],
    name: 'publishWave',
    outputs: [{ name: 'wIdx', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'holder', internalType: 'address', type: 'address' },
    ],
    name: 'resolve',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'ptr', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'select',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'selection',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'v', internalType: 'bool', type: 'bool' },
    ],
    name: 'setAutoLatest',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'uri', internalType: 'string', type: 'string' },
      {
        name: 'cond',
        internalType: 'enum MetadataOverlayModule.CommCond',
        type: 'uint8',
      },
      { name: 'price', internalType: 'uint256', type: 'uint256' },
      {
        name: 'payout',
        internalType: 'enum MetadataOverlayModule.Payout',
        type: 'uint8',
      },
    ],
    name: 'setCommission',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'unlock',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'w', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'unlockWave',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'inst', internalType: 'address', type: 'address' }],
    name: 'waveCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'w', internalType: 'uint256', type: 'uint256' },
      { name: 'holder', internalType: 'address', type: 'address' },
    ],
    name: 'waveEligible',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'wavePaid',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'waves',
    outputs: [
      { name: 'baseURI', internalType: 'string', type: 'string' },
      {
        name: 'cond',
        internalType: 'enum MetadataOverlayModule.WaveCond',
        type: 'uint8',
      },
      { name: 'threshold', internalType: 'uint256', type: 'uint256' },
      { name: 'price', internalType: 'uint256', type: 'uint256' },
      {
        name: 'payout',
        internalType: 'enum MetadataOverlayModule.Payout',
        type: 'uint8',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'autoLatest',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
    ],
    name: 'AutoLatestSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
    ],
    name: 'CommissionSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MetadataURIUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'autoLatest',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
      {
        name: 'defaultPayout',
        internalType: 'enum MetadataOverlayModule.Payout',
        type: 'uint8',
        indexed: false,
      },
    ],
    name: 'OverlayConfigured',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
      { name: 'ptr', internalType: 'uint256', type: 'uint256', indexed: false },
    ],
    name: 'SelectionChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: true },
      { name: 'who', internalType: 'address', type: 'address', indexed: false },
      { name: 'kind', internalType: 'uint8', type: 'uint8', indexed: false },
    ],
    name: 'Unlocked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'wIdx',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'WavePublished',
  },
  { type: 'error', inputs: [], name: 'AlreadyConfigured' },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AlreadyPaid' },
  { type: 'error', inputs: [], name: 'CommissionLocked' },
  { type: 'error', inputs: [], name: 'EmptyURI' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidSelection' },
  { type: 'error', inputs: [], name: 'InvalidWave' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoCommission' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotHolder' },
  { type: 'error', inputs: [], name: 'NotInstanceOwner' },
  { type: 'error', inputs: [], name: 'NotPayCommission' },
  { type: 'error', inputs: [], name: 'NotPayWave' },
  { type: 'error', inputs: [], name: 'NotRegisteredFactory' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'WrongPayment' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MetadataResolverRouter
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const metadataResolverRouterAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'rs', internalType: 'address[]', type: 'address[]' },
    ],
    name: 'initResolvers',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'holder', internalType: 'address', type: 'address' },
    ],
    name: 'resolve',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'inst', internalType: 'address', type: 'address' }],
    name: 'resolverCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'resolvers',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'sealed_',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MetadataURIUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'resolvers',
        internalType: 'address[]',
        type: 'address[]',
        indexed: false,
      },
    ],
    name: 'ResolversSealed',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AlreadySealed' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotRegisteredFactory' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// PasswordTierGatingModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const passwordTierGatingModuleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'openTime', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'canMint',
    outputs: [
      { name: 'allowed', internalType: 'bool', type: 'bool' },
      { name: 'permanent', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      {
        name: 'config',
        internalType: 'struct TierConfig',
        type: 'tuple',
        components: [
          { name: 'tierType', internalType: 'enum TierType', type: 'uint8' },
          {
            name: 'passwordHashes',
            internalType: 'bytes32[]',
            type: 'bytes32[]',
          },
          { name: 'volumeCaps', internalType: 'uint256[]', type: 'uint256[]' },
          {
            name: 'tierUnlockTimes',
            internalType: 'uint256[]',
            type: 'uint256[]',
          },
        ],
      },
    ],
    name: 'configureFor',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'configured',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getConfig',
    outputs: [
      {
        name: '',
        internalType: 'struct TierConfig',
        type: 'tuple',
        components: [
          { name: 'tierType', internalType: 'enum TierType', type: 'uint8' },
          {
            name: 'passwordHashes',
            internalType: 'bytes32[]',
            type: 'bytes32[]',
          },
          { name: 'volumeCaps', internalType: 'uint256[]', type: 'uint256[]' },
          {
            name: 'tierUnlockTimes',
            internalType: 'uint256[]',
            type: 'uint256[]',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'onMint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'hash', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'tierByPasswordHash',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'user', internalType: 'address', type: 'address' },
    ],
    name: 'userPurchaseVolume',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'user', internalType: 'address', type: 'address' },
    ],
    name: 'userTierUnlocked',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MetadataURIUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidPassword' },
  { type: 'error', inputs: [], name: 'InvalidPasswordHash' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'TierConfigMismatch' },
  { type: 'error', inputs: [], name: 'TierTimeLocked' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'VolumeCapExceeded' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ProfileRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const profileRegistryAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'clearProfile',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'profileURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setProfile',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'uri', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'ProfileUpdated',
  },
  { type: 'error', inputs: [], name: 'InvalidURI' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ProtocolTreasuryV1
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const protocolTreasuryV1Abi = [
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'claimPOLFees',
    outputs: [
      { name: 'amount0', internalType: 'uint256', type: 'uint256' },
      { name: 'amount1', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'source',
        internalType: 'enum ProtocolTreasuryV1.Source',
        type: 'uint8',
      },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getPolPosition',
    outputs: [
      { name: 'tickLower', internalType: 'int24', type: 'int24' },
      { name: 'tickUpper', internalType: 'int24', type: 'int24' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      { name: 'liquidity', internalType: 'uint128', type: 'uint128' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'source',
        internalType: 'enum ProtocolTreasuryV1.Source',
        type: 'uint8',
      },
    ],
    name: 'getRevenueBySource',
    outputs: [
      { name: 'received', internalType: 'uint256', type: 'uint256' },
      { name: 'withdrawn', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_owner', internalType: 'address', type: 'address' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC721Received',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'polInstanceCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'polInstances',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'poolKey',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'currency0', internalType: 'Currency', type: 'address' },
          { name: 'currency1', internalType: 'Currency', type: 'address' },
          { name: 'fee', internalType: 'uint24', type: 'uint24' },
          { name: 'tickSpacing', internalType: 'int24', type: 'int24' },
          { name: 'hooks', internalType: 'contract IHooks', type: 'address' },
        ],
      },
      { name: 'tickLower', internalType: 'int24', type: 'int24' },
      { name: 'tickUpper', internalType: 'int24', type: 'int24' },
      { name: 'amount0', internalType: 'uint256', type: 'uint256' },
      { name: 'amount1', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'receivePOL',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'revenueConductor',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'safe', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'routeToDAO',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_registry', internalType: 'address', type: 'address' }],
    name: 'setMasterRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_conductor', internalType: 'address', type: 'address' }],
    name: 'setRevenueConductor',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_pm', internalType: 'address', type: 'address' }],
    name: 'setV4PoolManager',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWETH',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: '',
        internalType: 'enum ProtocolTreasuryV1.Source',
        type: 'uint8',
      },
    ],
    name: 'totalReceived',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: '',
        internalType: 'enum ProtocolTreasuryV1.Source',
        type: 'uint8',
      },
    ],
    name: 'totalWithdrawn',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'data', internalType: 'bytes', type: 'bytes' }],
    name: 'unlockCallback',
    outputs: [{ name: '', internalType: 'bytes', type: 'bytes' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'v4PoolManager',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'withdrawERC20',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'tokenId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'withdrawERC721',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'withdrawETH',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ERC20Withdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'token',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'tokenId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ERC721Withdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'MasterRegistryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount0',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'amount1',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'POLFeesCollected',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'liquidity',
        internalType: 'uint128',
        type: 'uint128',
        indexed: false,
      },
      {
        name: 'salt',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
    ],
    name: 'POLPositionDeployed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'conductor',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'RevenueConductorUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'source',
        internalType: 'enum ProtocolTreasuryV1.Source',
        type: 'uint8',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RevenueReceived',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'conductor',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'safe', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RevenueRouted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newPoolManager',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'V4PoolManagerUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newWETH',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'WETHUpdated',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InsufficientBalance' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidRecipient' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoPOLPosition' },
  { type: 'error', inputs: [], name: 'NoValue' },
  { type: 'error', inputs: [], name: 'NotRegisteredInstance' },
  { type: 'error', inputs: [], name: 'POLAlreadyDeployed' },
  { type: 'error', inputs: [], name: 'RegistryNotConfigured' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'TransferFailed' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
  { type: 'error', inputs: [], name: 'V4NotConfigured' },
  { type: 'error', inputs: [], name: 'WETHNotConfigured' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// QueryAggregator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const queryAggregatorAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_QUERY_LIMIT',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'featuredQueueManager',
    outputs: [
      {
        name: '',
        internalType: 'contract IFeaturedQueueManager',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'startId', internalType: 'uint256', type: 'uint256' },
      { name: 'endId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getERC1155EditionsBatch',
    outputs: [
      {
        name: 'result',
        internalType: 'struct QueryAggregator.EditionView[]',
        type: 'tuple[]',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'pieceTitle', internalType: 'string', type: 'string' },
          { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
          { name: 'currentPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'supply', internalType: 'uint256', type: 'uint256' },
          { name: 'minted', internalType: 'uint256', type: 'uint256' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          {
            name: 'pricingModel',
            internalType: 'enum IERC1155EditionReader.PricingModel',
            type: 'uint8',
          },
          {
            name: 'priceIncreaseRate',
            internalType: 'uint256',
            type: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getHomePageData',
    outputs: [
      {
        name: 'projects',
        internalType: 'struct QueryAggregator.ProjectCard[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
          { name: 'factory', internalType: 'address', type: 'address' },
          { name: 'contractType', internalType: 'string', type: 'string' },
          { name: 'factoryTitle', internalType: 'string', type: 'string' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'vaultName', internalType: 'string', type: 'string' },
          { name: 'currentPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'totalSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'maxSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'isActive', internalType: 'bool', type: 'bool' },
          { name: 'extraData', internalType: 'bytes', type: 'bytes' },
          { name: 'featuredRank', internalType: 'uint256', type: 'uint256' },
          { name: 'featuredExpires', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'totalFeatured', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'instances', internalType: 'address[]', type: 'address[]' },
      { name: 'vaultAddrs', internalType: 'address[]', type: 'address[]' },
    ],
    name: 'getPortfolioData',
    outputs: [
      {
        name: 'erc404Holdings',
        internalType: 'struct QueryAggregator.ERC404Holding[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'tokenBalance', internalType: 'uint256', type: 'uint256' },
          { name: 'nftBalance', internalType: 'uint256', type: 'uint256' },
          { name: 'stakedBalance', internalType: 'uint256', type: 'uint256' },
          { name: 'pendingRewards', internalType: 'uint256', type: 'uint256' },
        ],
      },
      {
        name: 'erc1155Holdings',
        internalType: 'struct QueryAggregator.ERC1155Holding[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'editionIds', internalType: 'uint256[]', type: 'uint256[]' },
          { name: 'balances', internalType: 'uint256[]', type: 'uint256[]' },
        ],
      },
      {
        name: 'vaultPositions',
        internalType: 'struct QueryAggregator.VaultPosition[]',
        type: 'tuple[]',
        components: [
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'contribution', internalType: 'uint256', type: 'uint256' },
          { name: 'shares', internalType: 'uint256', type: 'uint256' },
          { name: 'claimable', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'totalClaimable', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instances', internalType: 'address[]', type: 'address[]' },
    ],
    name: 'getProjectCardsBatch',
    outputs: [
      {
        name: 'cards',
        internalType: 'struct QueryAggregator.ProjectCard[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
          { name: 'factory', internalType: 'address', type: 'address' },
          { name: 'contractType', internalType: 'string', type: 'string' },
          { name: 'factoryTitle', internalType: 'string', type: 'string' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'vaultName', internalType: 'string', type: 'string' },
          { name: 'currentPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'totalSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'maxSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'isActive', internalType: 'bool', type: 'bool' },
          { name: 'extraData', internalType: 'bytes', type: 'bytes' },
          { name: 'featuredRank', internalType: 'uint256', type: 'uint256' },
          { name: 'featuredExpires', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IGlobalMessageRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      {
        name: '_featuredQueueManager',
        internalType: 'address',
        type: 'address',
      },
      {
        name: '_globalMessageRegistry',
        internalType: 'address',
        type: 'address',
      },
      { name: '_owner', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      {
        name: '_featuredQueueManager',
        internalType: 'address',
        type: 'address',
      },
      {
        name: '_globalMessageRegistry',
        internalType: 'address',
        type: 'address',
      },
    ],
    name: 'setRegistries',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'masterRegistry',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'featuredQueueManager',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'globalMessageRegistry',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'LimitTooHigh' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'TooManyInstances' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// TierRevealModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const tierRevealModuleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      {
        name: 'ts',
        internalType: 'struct TierRevealModule.Tier[]',
        type: 'tuple[]',
        components: [
          { name: 'idStart', internalType: 'uint256', type: 'uint256' },
          { name: 'idEnd', internalType: 'uint256', type: 'uint256' },
          { name: 'minBalance', internalType: 'uint256', type: 'uint256' },
          { name: 'baseURI', internalType: 'string', type: 'string' },
          { name: 'lockedURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    name: 'initTiers',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'inst', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'holder', internalType: 'address', type: 'address' },
    ],
    name: 'resolve',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'sealed_',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'inst', internalType: 'address', type: 'address' }],
    name: 'tierCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'tiers',
    outputs: [
      { name: 'idStart', internalType: 'uint256', type: 'uint256' },
      { name: 'idEnd', internalType: 'uint256', type: 'uint256' },
      { name: 'minBalance', internalType: 'uint256', type: 'uint256' },
      { name: 'baseURI', internalType: 'string', type: 'string' },
      { name: 'lockedURI', internalType: 'string', type: 'string' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MetadataURIUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'count',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TiersSealed',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AlreadySealed' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidRange' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotRegisteredFactory' },
  { type: 'error', inputs: [], name: 'RangesNotAscending' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ZAMMLiquidityDeployerModule
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const zammLiquidityDeployerModuleAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_zamm', internalType: 'address', type: 'address' },
      { name: '_feeOrHook', internalType: 'uint256', type: 'uint256' },
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_INIT_PRICE_DEVIATION_BPS',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'p',
        internalType: 'struct ILiquidityDeployerModule.DeployParams',
        type: 'tuple',
        components: [
          { name: 'ethReserve', internalType: 'uint256', type: 'uint256' },
          { name: 'tokenReserve', internalType: 'uint256', type: 'uint256' },
          {
            name: 'protocolTreasury',
            internalType: 'address',
            type: 'address',
          },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'carveEth', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'deployLiquidity',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'feeOrHook',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'metadataURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setMetadataURI',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'zamm',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'requested',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'paid',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'CreatorCarvePaid',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'treasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'GraduationFeePaid',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'GraduationVaultContribution',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'zamm', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'token0',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'token1',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'liquidity',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'LiquidityDeployed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MetadataURIUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'ETHMismatch' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoETHForPool' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoTokensForPool' },
  { type: 'error', inputs: [], name: 'PoolPriceMismatch' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCaller' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// zRouter
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const zRouterAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'payable' },
  { type: 'fallback', stateMutability: 'payable' },
  { type: 'receive', stateMutability: 'payable' },
  {
    type: 'function',
    inputs: [
      {
        name: 'poolKey',
        internalType: 'struct PoolKey',
        type: 'tuple',
        components: [
          { name: 'id0', internalType: 'uint256', type: 'uint256' },
          { name: 'id1', internalType: 'uint256', type: 'uint256' },
          { name: 'token0', internalType: 'address', type: 'address' },
          { name: 'token1', internalType: 'address', type: 'address' },
          { name: 'feeOrHook', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'amount0Desired', internalType: 'uint256', type: 'uint256' },
      { name: 'amount1Desired', internalType: 'uint256', type: 'uint256' },
      { name: 'amount0Min', internalType: 'uint256', type: 'uint256' },
      { name: 'amount1Min', internalType: 'uint256', type: 'uint256' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'addLiquidity',
    outputs: [
      { name: 'amount0', internalType: 'uint256', type: 'uint256' },
      { name: 'amount1', internalType: 'uint256', type: 'uint256' },
      { name: 'liquidity', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'is6909', internalType: 'bool', type: 'bool' },
      { name: 'to', internalType: 'address', type: 'address' },
    ],
    name: 'ensureAllowance',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'exactOut', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ethToExactSTETH',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'exactOut', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'ethToExactWSTETH',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'to', internalType: 'address', type: 'address' }],
    name: 'exactETHToSTETH',
    outputs: [{ name: 'shares', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'to', internalType: 'address', type: 'address' }],
    name: 'exactETHToWSTETH',
    outputs: [{ name: 'wstOut', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'target', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'execute',
    outputs: [{ name: 'result', internalType: 'bytes', type: 'bytes' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'data', internalType: 'bytes[]', type: 'bytes[]' }],
    name: 'multicall',
    outputs: [{ name: 'results', internalType: 'bytes[]', type: 'bytes[]' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC721Received',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'v', internalType: 'uint8', type: 'uint8' },
      { name: 'r', internalType: 'bytes32', type: 'bytes32' },
      { name: 's', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'permit',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'permitted',
        internalType: 'struct IPermit2.TokenPermissions[]',
        type: 'tuple[]',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'amount', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'nonce', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'signature', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'permit2BatchTransferFrom',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'nonce', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
      { name: 'signature', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'permit2TransferFrom',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'nonce', internalType: 'uint256', type: 'uint256' },
      { name: 'expiry', internalType: 'uint256', type: 'uint256' },
      { name: 'v', internalType: 'uint8', type: 'uint8' },
      { name: 'r', internalType: 'bytes32', type: 'bytes32' },
      { name: 's', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'permitDAI',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'label', internalType: 'string', type: 'string' },
      { name: 'innerSecret', internalType: 'bytes32', type: 'bytes32' },
      { name: 'to', internalType: 'address', type: 'address' },
    ],
    name: 'revealName',
    outputs: [{ name: 'tokenId', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'safeExecutor',
    outputs: [
      { name: '', internalType: 'contract SafeExecutor', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tokenIn', internalType: 'address', type: 'address' },
      { name: 'amountIn', internalType: 'uint256', type: 'uint256' },
      { name: 'recipient', internalType: 'address', type: 'address' },
      { name: 'tokenOut', internalType: 'address', type: 'address' },
      { name: 'amountOutMin', internalType: 'uint256', type: 'uint256' },
      { name: 'executor', internalType: 'address', type: 'address' },
      { name: 'executorData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'snwap',
    outputs: [{ name: 'amountOut', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'tokenIn', internalType: 'address', type: 'address' },
      { name: 'amountIn', internalType: 'uint256', type: 'uint256' },
      { name: 'recipient', internalType: 'address', type: 'address' },
      { name: 'tokensOut', internalType: 'address[]', type: 'address[]' },
      { name: 'amountsOutMin', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'executor', internalType: 'address', type: 'address' },
      { name: 'executorData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'snwapMulti',
    outputs: [
      { name: 'amountsOut', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'exactOut', internalType: 'bool', type: 'bool' },
      { name: 'route', internalType: 'address[11]', type: 'address[11]' },
      {
        name: 'swapParams',
        internalType: 'uint256[4][5]',
        type: 'uint256[4][5]',
      },
      { name: 'basePools', internalType: 'address[5]', type: 'address[5]' },
      { name: 'swapAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'amountLimit', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'swapCurve',
    outputs: [
      { name: 'amountIn', internalType: 'uint256', type: 'uint256' },
      { name: 'amountOut', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'exactOut', internalType: 'bool', type: 'bool' },
      { name: 'tokenIn', internalType: 'address', type: 'address' },
      { name: 'tokenOut', internalType: 'address', type: 'address' },
      { name: 'swapAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'amountLimit', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'swapV2',
    outputs: [
      { name: 'amountIn', internalType: 'uint256', type: 'uint256' },
      { name: 'amountOut', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'exactOut', internalType: 'bool', type: 'bool' },
      { name: 'swapFee', internalType: 'uint24', type: 'uint24' },
      { name: 'tokenIn', internalType: 'address', type: 'address' },
      { name: 'tokenOut', internalType: 'address', type: 'address' },
      { name: 'swapAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'amountLimit', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'swapV3',
    outputs: [
      { name: 'amountIn', internalType: 'uint256', type: 'uint256' },
      { name: 'amountOut', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'exactOut', internalType: 'bool', type: 'bool' },
      { name: 'swapFee', internalType: 'uint24', type: 'uint24' },
      { name: 'tickSpace', internalType: 'int24', type: 'int24' },
      { name: 'tokenIn', internalType: 'address', type: 'address' },
      { name: 'tokenOut', internalType: 'address', type: 'address' },
      { name: 'swapAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'amountLimit', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'swapV4',
    outputs: [
      { name: 'amountIn', internalType: 'uint256', type: 'uint256' },
      { name: 'amountOut', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'exactOut', internalType: 'bool', type: 'bool' },
      { name: 'feeOrHook', internalType: 'uint256', type: 'uint256' },
      { name: 'tokenIn', internalType: 'address', type: 'address' },
      { name: 'tokenOut', internalType: 'address', type: 'address' },
      { name: 'idIn', internalType: 'uint256', type: 'uint256' },
      { name: 'idOut', internalType: 'uint256', type: 'uint256' },
      { name: 'swapAmount', internalType: 'uint256', type: 'uint256' },
      { name: 'amountLimit', internalType: 'uint256', type: 'uint256' },
      { name: 'deadline', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'swapVZ',
    outputs: [
      { name: 'amountIn', internalType: 'uint256', type: 'uint256' },
      { name: 'amountOut', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'to', internalType: 'address', type: 'address' },
    ],
    name: 'sweep',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'owner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'target', internalType: 'address', type: 'address' },
      { name: 'ok', internalType: 'bool', type: 'bool' },
    ],
    name: 'trust',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'callbackData', internalType: 'bytes', type: 'bytes' }],
    name: 'unlockCallback',
    outputs: [{ name: 'result', internalType: 'bytes', type: 'bytes' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'unwrap',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'wrap',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
    ],
    name: 'OwnershipTransferred',
  },
  { type: 'error', inputs: [], name: 'BadSwap' },
  { type: 'error', inputs: [], name: 'ETHTransferFailed' },
  { type: 'error', inputs: [], name: 'Expired' },
  { type: 'error', inputs: [], name: 'InvalidId' },
  { type: 'error', inputs: [], name: 'InvalidMsgVal' },
  { type: 'error', inputs: [], name: 'Slippage' },
  {
    type: 'error',
    inputs: [
      { name: 'token', internalType: 'address', type: 'address' },
      { name: 'received', internalType: 'uint256', type: 'uint256' },
      { name: 'minimum', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SnwapSlippage',
  },
  { type: 'error', inputs: [], name: 'SwapExactInFail' },
  { type: 'error', inputs: [], name: 'SwapExactOutFail' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// React
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__
 */
export const useReadAlignmentEndowmentVault =
  /*#__PURE__*/ createUseReadContract({ abi: alignmentEndowmentVaultAbi })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"MATURITY_DURATION"`
 */
export const useReadAlignmentEndowmentVaultMaturityDuration =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'MATURITY_DURATION',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"accumulatedFees"`
 */
export const useReadAlignmentEndowmentVaultAccumulatedFees =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'accumulatedFees',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"alignmentToken"`
 */
export const useReadAlignmentEndowmentVaultAlignmentToken =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'alignmentToken',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"calculateClaimableAmount"`
 */
export const useReadAlignmentEndowmentVaultCalculateClaimableAmount =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'calculateClaimableAmount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"claimFees"`
 */
export const useReadAlignmentEndowmentVaultClaimFees =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'claimFees',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"claimFeesAsDelegate"`
 */
export const useReadAlignmentEndowmentVaultClaimFeesAsDelegate =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'claimFeesAsDelegate',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"communityPayout"`
 */
export const useReadAlignmentEndowmentVaultCommunityPayout =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'communityPayout',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"currentPolicy"`
 */
export const useReadAlignmentEndowmentVaultCurrentPolicy =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'currentPolicy',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"delegateBenefactor"`
 */
export const useReadAlignmentEndowmentVaultDelegateBenefactor =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'delegateBenefactor',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"depositTime"`
 */
export const useReadAlignmentEndowmentVaultDepositTime =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'depositTime',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"description"`
 */
export const useReadAlignmentEndowmentVaultDescription =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'description',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"getBenefactorContribution"`
 */
export const useReadAlignmentEndowmentVaultGetBenefactorContribution =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'getBenefactorContribution',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"getBenefactorDelegate"`
 */
export const useReadAlignmentEndowmentVaultGetBenefactorDelegate =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'getBenefactorDelegate',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"getBenefactorShares"`
 */
export const useReadAlignmentEndowmentVaultGetBenefactorShares =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'getBenefactorShares',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"isLiquidityReady"`
 */
export const useReadAlignmentEndowmentVaultIsLiquidityReady =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'isLiquidityReady',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadAlignmentEndowmentVaultMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"owner"`
 */
export const useReadAlignmentEndowmentVaultOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadAlignmentEndowmentVaultOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"principal"`
 */
export const useReadAlignmentEndowmentVaultPrincipal =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'principal',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadAlignmentEndowmentVaultProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"stataToken"`
 */
export const useReadAlignmentEndowmentVaultStataToken =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'stataToken',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"supportsCapability"`
 */
export const useReadAlignmentEndowmentVaultSupportsCapability =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'supportsCapability',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"totalPrincipal"`
 */
export const useReadAlignmentEndowmentVaultTotalPrincipal =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'totalPrincipal',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"totalShares"`
 */
export const useReadAlignmentEndowmentVaultTotalShares =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'totalShares',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"validateCompliance"`
 */
export const useReadAlignmentEndowmentVaultValidateCompliance =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'validateCompliance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"vaultType"`
 */
export const useReadAlignmentEndowmentVaultVaultType =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'vaultType',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"weth"`
 */
export const useReadAlignmentEndowmentVaultWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__
 */
export const useWriteAlignmentEndowmentVault =
  /*#__PURE__*/ createUseWriteContract({ abi: alignmentEndowmentVaultAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteAlignmentEndowmentVaultCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteAlignmentEndowmentVaultCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"harvest"`
 */
export const useWriteAlignmentEndowmentVaultHarvest =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'harvest',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteAlignmentEndowmentVaultInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"migratePosition"`
 */
export const useWriteAlignmentEndowmentVaultMigratePosition =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'migratePosition',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"receiveContribution"`
 */
export const useWriteAlignmentEndowmentVaultReceiveContribution =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'receiveContribution',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteAlignmentEndowmentVaultRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteAlignmentEndowmentVaultRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"setCommunityPayout"`
 */
export const useWriteAlignmentEndowmentVaultSetCommunityPayout =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'setCommunityPayout',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteAlignmentEndowmentVaultTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"withdrawPrincipal"`
 */
export const useWriteAlignmentEndowmentVaultWithdrawPrincipal =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'withdrawPrincipal',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__
 */
export const useSimulateAlignmentEndowmentVault =
  /*#__PURE__*/ createUseSimulateContract({ abi: alignmentEndowmentVaultAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateAlignmentEndowmentVaultCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateAlignmentEndowmentVaultCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"harvest"`
 */
export const useSimulateAlignmentEndowmentVaultHarvest =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'harvest',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateAlignmentEndowmentVaultInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"migratePosition"`
 */
export const useSimulateAlignmentEndowmentVaultMigratePosition =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'migratePosition',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"receiveContribution"`
 */
export const useSimulateAlignmentEndowmentVaultReceiveContribution =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'receiveContribution',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateAlignmentEndowmentVaultRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateAlignmentEndowmentVaultRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"setCommunityPayout"`
 */
export const useSimulateAlignmentEndowmentVaultSetCommunityPayout =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'setCommunityPayout',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateAlignmentEndowmentVaultTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `functionName` set to `"withdrawPrincipal"`
 */
export const useSimulateAlignmentEndowmentVaultWithdrawPrincipal =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentEndowmentVaultAbi,
    functionName: 'withdrawPrincipal',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__
 */
export const useWatchAlignmentEndowmentVaultEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: alignmentEndowmentVaultAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"CommunityPayoutUpdated"`
 */
export const useWatchAlignmentEndowmentVaultCommunityPayoutUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'CommunityPayoutUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"ContributionReceived"`
 */
export const useWatchAlignmentEndowmentVaultContributionReceivedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'ContributionReceived',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"FeesAccumulated"`
 */
export const useWatchAlignmentEndowmentVaultFeesAccumulatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'FeesAccumulated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"FeesClaimed"`
 */
export const useWatchAlignmentEndowmentVaultFeesClaimedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'FeesClaimed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"Harvested"`
 */
export const useWatchAlignmentEndowmentVaultHarvestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'Harvested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"Migrated"`
 */
export const useWatchAlignmentEndowmentVaultMigratedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'Migrated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchAlignmentEndowmentVaultOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchAlignmentEndowmentVaultOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchAlignmentEndowmentVaultOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"PrincipalWithdrawn"`
 */
export const useWatchAlignmentEndowmentVaultPrincipalWithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'PrincipalWithdrawn',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentEndowmentVaultAbi}__ and `eventName` set to `"VaultPolicyUpdated"`
 */
export const useWatchAlignmentEndowmentVaultVaultPolicyUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentEndowmentVaultAbi,
    eventName: 'VaultPolicyUpdated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__
 */
export const useReadAlignmentRegistryV1 = /*#__PURE__*/ createUseReadContract({
  abi: alignmentRegistryV1Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"alignmentTargetAmbassadors"`
 */
export const useReadAlignmentRegistryV1AlignmentTargetAmbassadors =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'alignmentTargetAmbassadors',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"alignmentTargets"`
 */
export const useReadAlignmentRegistryV1AlignmentTargets =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'alignmentTargets',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"communityPayout"`
 */
export const useReadAlignmentRegistryV1CommunityPayout =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'communityPayout',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"getAlignmentTarget"`
 */
export const useReadAlignmentRegistryV1GetAlignmentTarget =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'getAlignmentTarget',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"getAlignmentTargetAssets"`
 */
export const useReadAlignmentRegistryV1GetAlignmentTargetAssets =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'getAlignmentTargetAssets',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"getAmbassadors"`
 */
export const useReadAlignmentRegistryV1GetAmbassadors =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'getAmbassadors',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"getCommunityPayout"`
 */
export const useReadAlignmentRegistryV1GetCommunityPayout =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'getCommunityPayout',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"isAlignmentTargetActive"`
 */
export const useReadAlignmentRegistryV1IsAlignmentTargetActive =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'isAlignmentTargetActive',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"isAmbassador"`
 */
export const useReadAlignmentRegistryV1IsAmbassador =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'isAmbassador',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"isTokenInTarget"`
 */
export const useReadAlignmentRegistryV1IsTokenInTarget =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'isTokenInTarget',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"nextAlignmentTargetId"`
 */
export const useReadAlignmentRegistryV1NextAlignmentTargetId =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'nextAlignmentTargetId',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"owner"`
 */
export const useReadAlignmentRegistryV1Owner =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadAlignmentRegistryV1OwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadAlignmentRegistryV1ProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"tokenToTargetIds"`
 */
export const useReadAlignmentRegistryV1TokenToTargetIds =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'tokenToTargetIds',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__
 */
export const useWriteAlignmentRegistryV1 = /*#__PURE__*/ createUseWriteContract(
  { abi: alignmentRegistryV1Abi },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"addAmbassador"`
 */
export const useWriteAlignmentRegistryV1AddAmbassador =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'addAmbassador',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteAlignmentRegistryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteAlignmentRegistryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"deactivateAlignmentTarget"`
 */
export const useWriteAlignmentRegistryV1DeactivateAlignmentTarget =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'deactivateAlignmentTarget',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useWriteAlignmentRegistryV1Initialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"registerAlignmentTarget"`
 */
export const useWriteAlignmentRegistryV1RegisterAlignmentTarget =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'registerAlignmentTarget',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"removeAmbassador"`
 */
export const useWriteAlignmentRegistryV1RemoveAmbassador =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'removeAmbassador',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteAlignmentRegistryV1RenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteAlignmentRegistryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"setCommunityPayout"`
 */
export const useWriteAlignmentRegistryV1SetCommunityPayout =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'setCommunityPayout',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteAlignmentRegistryV1TransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"updateAlignmentTarget"`
 */
export const useWriteAlignmentRegistryV1UpdateAlignmentTarget =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'updateAlignmentTarget',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteAlignmentRegistryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__
 */
export const useSimulateAlignmentRegistryV1 =
  /*#__PURE__*/ createUseSimulateContract({ abi: alignmentRegistryV1Abi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"addAmbassador"`
 */
export const useSimulateAlignmentRegistryV1AddAmbassador =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'addAmbassador',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateAlignmentRegistryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateAlignmentRegistryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"deactivateAlignmentTarget"`
 */
export const useSimulateAlignmentRegistryV1DeactivateAlignmentTarget =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'deactivateAlignmentTarget',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateAlignmentRegistryV1Initialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"registerAlignmentTarget"`
 */
export const useSimulateAlignmentRegistryV1RegisterAlignmentTarget =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'registerAlignmentTarget',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"removeAmbassador"`
 */
export const useSimulateAlignmentRegistryV1RemoveAmbassador =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'removeAmbassador',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateAlignmentRegistryV1RenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateAlignmentRegistryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"setCommunityPayout"`
 */
export const useSimulateAlignmentRegistryV1SetCommunityPayout =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'setCommunityPayout',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateAlignmentRegistryV1TransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"updateAlignmentTarget"`
 */
export const useSimulateAlignmentRegistryV1UpdateAlignmentTarget =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'updateAlignmentTarget',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateAlignmentRegistryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__
 */
export const useWatchAlignmentRegistryV1Event =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: alignmentRegistryV1Abi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AlignmentTargetDeactivated"`
 */
export const useWatchAlignmentRegistryV1AlignmentTargetDeactivatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AlignmentTargetDeactivated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AlignmentTargetRegistered"`
 */
export const useWatchAlignmentRegistryV1AlignmentTargetRegisteredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AlignmentTargetRegistered',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AlignmentTargetUpdated"`
 */
export const useWatchAlignmentRegistryV1AlignmentTargetUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AlignmentTargetUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AmbassadorAdded"`
 */
export const useWatchAlignmentRegistryV1AmbassadorAddedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AmbassadorAdded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AmbassadorRemoved"`
 */
export const useWatchAlignmentRegistryV1AmbassadorRemovedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AmbassadorRemoved',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"CommunityPayoutSet"`
 */
export const useWatchAlignmentRegistryV1CommunityPayoutSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'CommunityPayoutSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchAlignmentRegistryV1OwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchAlignmentRegistryV1OwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchAlignmentRegistryV1OwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchAlignmentRegistryV1UpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__
 */
export const useReadAlignmentTargetRequestRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"alignmentRegistry"`
 */
export const useReadAlignmentTargetRequestRegistryAlignmentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'alignmentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"getPending"`
 */
export const useReadAlignmentTargetRequestRegistryGetPending =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'getPending',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"getRequest"`
 */
export const useReadAlignmentTargetRequestRegistryGetRequest =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'getRequest',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"getRequestAssets"`
 */
export const useReadAlignmentTargetRequestRegistryGetRequestAssets =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'getRequestAssets',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"maxPending"`
 */
export const useReadAlignmentTargetRequestRegistryMaxPending =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'maxPending',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"nextRequestId"`
 */
export const useReadAlignmentTargetRequestRegistryNextRequestId =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'nextRequestId',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadAlignmentTargetRequestRegistryOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadAlignmentTargetRequestRegistryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"pendingCount"`
 */
export const useReadAlignmentTargetRequestRegistryPendingCount =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'pendingCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadAlignmentTargetRequestRegistryProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"refunds"`
 */
export const useReadAlignmentTargetRequestRegistryRefunds =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'refunds',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"requestDeposit"`
 */
export const useReadAlignmentTargetRequestRegistryRequestDeposit =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'requestDeposit',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"requestTTL"`
 */
export const useReadAlignmentTargetRequestRegistryRequestTtl =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'requestTTL',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__
 */
export const useWriteAlignmentTargetRequestRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"approveRequest"`
 */
export const useWriteAlignmentTargetRequestRegistryApproveRequest =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'approveRequest',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteAlignmentTargetRequestRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteAlignmentTargetRequestRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"pruneExpired"`
 */
export const useWriteAlignmentTargetRequestRegistryPruneExpired =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'pruneExpired',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"rejectRequest"`
 */
export const useWriteAlignmentTargetRequestRegistryRejectRequest =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'rejectRequest',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteAlignmentTargetRequestRegistryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteAlignmentTargetRequestRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"setMaxPending"`
 */
export const useWriteAlignmentTargetRequestRegistrySetMaxPending =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'setMaxPending',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteAlignmentTargetRequestRegistrySetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"setRequestDeposit"`
 */
export const useWriteAlignmentTargetRequestRegistrySetRequestDeposit =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'setRequestDeposit',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"setRequestTTL"`
 */
export const useWriteAlignmentTargetRequestRegistrySetRequestTtl =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'setRequestTTL',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"submitRequest"`
 */
export const useWriteAlignmentTargetRequestRegistrySubmitRequest =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'submitRequest',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteAlignmentTargetRequestRegistryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"withdrawRefund"`
 */
export const useWriteAlignmentTargetRequestRegistryWithdrawRefund =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'withdrawRefund',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__
 */
export const useSimulateAlignmentTargetRequestRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"approveRequest"`
 */
export const useSimulateAlignmentTargetRequestRegistryApproveRequest =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'approveRequest',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateAlignmentTargetRequestRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateAlignmentTargetRequestRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"pruneExpired"`
 */
export const useSimulateAlignmentTargetRequestRegistryPruneExpired =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'pruneExpired',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"rejectRequest"`
 */
export const useSimulateAlignmentTargetRequestRegistryRejectRequest =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'rejectRequest',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateAlignmentTargetRequestRegistryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateAlignmentTargetRequestRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"setMaxPending"`
 */
export const useSimulateAlignmentTargetRequestRegistrySetMaxPending =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'setMaxPending',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateAlignmentTargetRequestRegistrySetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"setRequestDeposit"`
 */
export const useSimulateAlignmentTargetRequestRegistrySetRequestDeposit =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'setRequestDeposit',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"setRequestTTL"`
 */
export const useSimulateAlignmentTargetRequestRegistrySetRequestTtl =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'setRequestTTL',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"submitRequest"`
 */
export const useSimulateAlignmentTargetRequestRegistrySubmitRequest =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'submitRequest',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateAlignmentTargetRequestRegistryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `functionName` set to `"withdrawRefund"`
 */
export const useSimulateAlignmentTargetRequestRegistryWithdrawRefund =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentTargetRequestRegistryAbi,
    functionName: 'withdrawRefund',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__
 */
export const useWatchAlignmentTargetRequestRegistryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"MaxPendingUpdated"`
 */
export const useWatchAlignmentTargetRequestRegistryMaxPendingUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'MaxPendingUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchAlignmentTargetRequestRegistryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchAlignmentTargetRequestRegistryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchAlignmentTargetRequestRegistryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchAlignmentTargetRequestRegistryProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"RefundWithdrawn"`
 */
export const useWatchAlignmentTargetRequestRegistryRefundWithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'RefundWithdrawn',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"RequestApproved"`
 */
export const useWatchAlignmentTargetRequestRegistryRequestApprovedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'RequestApproved',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"RequestDepositUpdated"`
 */
export const useWatchAlignmentTargetRequestRegistryRequestDepositUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'RequestDepositUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"RequestExpired"`
 */
export const useWatchAlignmentTargetRequestRegistryRequestExpiredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'RequestExpired',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"RequestRejected"`
 */
export const useWatchAlignmentTargetRequestRegistryRequestRejectedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'RequestRejected',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"RequestSubmitted"`
 */
export const useWatchAlignmentTargetRequestRegistryRequestSubmittedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'RequestSubmitted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentTargetRequestRegistryAbi}__ and `eventName` set to `"RequestTTLUpdated"`
 */
export const useWatchAlignmentTargetRequestRegistryRequestTtlUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentTargetRequestRegistryAbi,
    eventName: 'RequestTTLUpdated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__
 */
export const useReadComponentRegistry = /*#__PURE__*/ createUseReadContract({
  abi: componentRegistryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"allComponents"`
 */
export const useReadComponentRegistryAllComponents =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'allComponents',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"componentName"`
 */
export const useReadComponentRegistryComponentName =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'componentName',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"componentTag"`
 */
export const useReadComponentRegistryComponentTag =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'componentTag',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"getApprovedComponents"`
 */
export const useReadComponentRegistryGetApprovedComponents =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'getApprovedComponents',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"getApprovedComponentsByTag"`
 */
export const useReadComponentRegistryGetApprovedComponentsByTag =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'getApprovedComponentsByTag',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"isApproved"`
 */
export const useReadComponentRegistryIsApproved =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'isApproved',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"isApprovedComponent"`
 */
export const useReadComponentRegistryIsApprovedComponent =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'isApprovedComponent',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadComponentRegistryOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadComponentRegistryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadComponentRegistryProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__
 */
export const useWriteComponentRegistry = /*#__PURE__*/ createUseWriteContract({
  abi: componentRegistryAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"approveComponent"`
 */
export const useWriteComponentRegistryApproveComponent =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'approveComponent',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteComponentRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteComponentRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteComponentRegistryInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteComponentRegistryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteComponentRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"revokeComponent"`
 */
export const useWriteComponentRegistryRevokeComponent =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'revokeComponent',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteComponentRegistryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteComponentRegistryUpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__
 */
export const useSimulateComponentRegistry =
  /*#__PURE__*/ createUseSimulateContract({ abi: componentRegistryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"approveComponent"`
 */
export const useSimulateComponentRegistryApproveComponent =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'approveComponent',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateComponentRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateComponentRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateComponentRegistryInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateComponentRegistryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateComponentRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"revokeComponent"`
 */
export const useSimulateComponentRegistryRevokeComponent =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'revokeComponent',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateComponentRegistryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateComponentRegistryUpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__
 */
export const useWatchComponentRegistryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: componentRegistryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"ComponentApproved"`
 */
export const useWatchComponentRegistryComponentApprovedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'ComponentApproved',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"ComponentRevoked"`
 */
export const useWatchComponentRegistryComponentRevokedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'ComponentRevoked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchComponentRegistryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchComponentRegistryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchComponentRegistryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchComponentRegistryUpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__
 */
export const useReadCurveParamsComputer = /*#__PURE__*/ createUseReadContract({
  abi: curveParamsComputerAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"baseWeight"`
 */
export const useReadCurveParamsComputerBaseWeight =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'baseWeight',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"calculateCost"`
 */
export const useReadCurveParamsComputerCalculateCost =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'calculateCost',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"calculateRefund"`
 */
export const useReadCurveParamsComputerCalculateRefund =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'calculateRefund',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"computeCurveParams"`
 */
export const useReadCurveParamsComputerComputeCurveParams =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'computeCurveParams',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"cubicWeight"`
 */
export const useReadCurveParamsComputerCubicWeight =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'cubicWeight',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"owner"`
 */
export const useReadCurveParamsComputerOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadCurveParamsComputerOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"quadraticWeight"`
 */
export const useReadCurveParamsComputerQuadraticWeight =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'quadraticWeight',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"quarticWeight"`
 */
export const useReadCurveParamsComputerQuarticWeight =
  /*#__PURE__*/ createUseReadContract({
    abi: curveParamsComputerAbi,
    functionName: 'quarticWeight',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link curveParamsComputerAbi}__
 */
export const useWriteCurveParamsComputer = /*#__PURE__*/ createUseWriteContract(
  { abi: curveParamsComputerAbi },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteCurveParamsComputerCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: curveParamsComputerAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteCurveParamsComputerCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: curveParamsComputerAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteCurveParamsComputerRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: curveParamsComputerAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteCurveParamsComputerRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: curveParamsComputerAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"setCurveWeights"`
 */
export const useWriteCurveParamsComputerSetCurveWeights =
  /*#__PURE__*/ createUseWriteContract({
    abi: curveParamsComputerAbi,
    functionName: 'setCurveWeights',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteCurveParamsComputerTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: curveParamsComputerAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link curveParamsComputerAbi}__
 */
export const useSimulateCurveParamsComputer =
  /*#__PURE__*/ createUseSimulateContract({ abi: curveParamsComputerAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateCurveParamsComputerCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: curveParamsComputerAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateCurveParamsComputerCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: curveParamsComputerAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateCurveParamsComputerRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: curveParamsComputerAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateCurveParamsComputerRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: curveParamsComputerAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"setCurveWeights"`
 */
export const useSimulateCurveParamsComputerSetCurveWeights =
  /*#__PURE__*/ createUseSimulateContract({
    abi: curveParamsComputerAbi,
    functionName: 'setCurveWeights',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateCurveParamsComputerTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: curveParamsComputerAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link curveParamsComputerAbi}__
 */
export const useWatchCurveParamsComputerEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: curveParamsComputerAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `eventName` set to `"CurveWeightsUpdated"`
 */
export const useWatchCurveParamsComputerCurveWeightsUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: curveParamsComputerAbi,
    eventName: 'CurveWeightsUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchCurveParamsComputerOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: curveParamsComputerAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchCurveParamsComputerOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: curveParamsComputerAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link curveParamsComputerAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchCurveParamsComputerOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: curveParamsComputerAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__
 */
export const useReadCypherLiquidityDeployerModule =
  /*#__PURE__*/ createUseReadContract({ abi: cypherLiquidityDeployerModuleAbi })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"MAX_INIT_PRICE_DEVIATION_BPS"`
 */
export const useReadCypherLiquidityDeployerModuleMaxInitPriceDeviationBps =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'MAX_INIT_PRICE_DEVIATION_BPS',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"TICK_LOWER"`
 */
export const useReadCypherLiquidityDeployerModuleTickLower =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'TICK_LOWER',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"TICK_UPPER"`
 */
export const useReadCypherLiquidityDeployerModuleTickUpper =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'TICK_UPPER',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"algebraFactory"`
 */
export const useReadCypherLiquidityDeployerModuleAlgebraFactory =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'algebraFactory',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadCypherLiquidityDeployerModuleMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadCypherLiquidityDeployerModuleMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"owner"`
 */
export const useReadCypherLiquidityDeployerModuleOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadCypherLiquidityDeployerModuleOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"positionManager"`
 */
export const useReadCypherLiquidityDeployerModulePositionManager =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'positionManager',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"weth"`
 */
export const useReadCypherLiquidityDeployerModuleWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__
 */
export const useWriteCypherLiquidityDeployerModule =
  /*#__PURE__*/ createUseWriteContract({
    abi: cypherLiquidityDeployerModuleAbi,
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteCypherLiquidityDeployerModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteCypherLiquidityDeployerModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"deployLiquidity"`
 */
export const useWriteCypherLiquidityDeployerModuleDeployLiquidity =
  /*#__PURE__*/ createUseWriteContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'deployLiquidity',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteCypherLiquidityDeployerModuleRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteCypherLiquidityDeployerModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWriteCypherLiquidityDeployerModuleSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteCypherLiquidityDeployerModuleTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__
 */
export const useSimulateCypherLiquidityDeployerModule =
  /*#__PURE__*/ createUseSimulateContract({
    abi: cypherLiquidityDeployerModuleAbi,
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateCypherLiquidityDeployerModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateCypherLiquidityDeployerModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"deployLiquidity"`
 */
export const useSimulateCypherLiquidityDeployerModuleDeployLiquidity =
  /*#__PURE__*/ createUseSimulateContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'deployLiquidity',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateCypherLiquidityDeployerModuleRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateCypherLiquidityDeployerModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulateCypherLiquidityDeployerModuleSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateCypherLiquidityDeployerModuleTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: cypherLiquidityDeployerModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__
 */
export const useWatchCypherLiquidityDeployerModuleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `eventName` set to `"CreatorCarvePaid"`
 */
export const useWatchCypherLiquidityDeployerModuleCreatorCarvePaidEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
    eventName: 'CreatorCarvePaid',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `eventName` set to `"GraduationFeePaid"`
 */
export const useWatchCypherLiquidityDeployerModuleGraduationFeePaidEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
    eventName: 'GraduationFeePaid',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `eventName` set to `"GraduationVaultContribution"`
 */
export const useWatchCypherLiquidityDeployerModuleGraduationVaultContributionEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
    eventName: 'GraduationVaultContribution',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `eventName` set to `"LiquidityDeployed"`
 */
export const useWatchCypherLiquidityDeployerModuleLiquidityDeployedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
    eventName: 'LiquidityDeployed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `eventName` set to `"MetadataURIUpdated"`
 */
export const useWatchCypherLiquidityDeployerModuleMetadataUriUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
    eventName: 'MetadataURIUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchCypherLiquidityDeployerModuleOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchCypherLiquidityDeployerModuleOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link cypherLiquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchCypherLiquidityDeployerModuleOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: cypherLiquidityDeployerModuleAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__
 */
export const useReadDeployBondEscrow = /*#__PURE__*/ createUseReadContract({
  abi: deployBondEscrowAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"bondAmount"`
 */
export const useReadDeployBondEscrowBondAmount =
  /*#__PURE__*/ createUseReadContract({
    abi: deployBondEscrowAbi,
    functionName: 'bondAmount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"bonds"`
 */
export const useReadDeployBondEscrowBonds = /*#__PURE__*/ createUseReadContract(
  { abi: deployBondEscrowAbi, functionName: 'bonds' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"factory"`
 */
export const useReadDeployBondEscrowFactory =
  /*#__PURE__*/ createUseReadContract({
    abi: deployBondEscrowAbi,
    functionName: 'factory',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"graceDays"`
 */
export const useReadDeployBondEscrowGraceDays =
  /*#__PURE__*/ createUseReadContract({
    abi: deployBondEscrowAbi,
    functionName: 'graceDays',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"maxBondDuration"`
 */
export const useReadDeployBondEscrowMaxBondDuration =
  /*#__PURE__*/ createUseReadContract({
    abi: deployBondEscrowAbi,
    functionName: 'maxBondDuration',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"owner"`
 */
export const useReadDeployBondEscrowOwner = /*#__PURE__*/ createUseReadContract(
  { abi: deployBondEscrowAbi, functionName: 'owner' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadDeployBondEscrowOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: deployBondEscrowAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadDeployBondEscrowProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: deployBondEscrowAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__
 */
export const useWriteDeployBondEscrow = /*#__PURE__*/ createUseWriteContract({
  abi: deployBondEscrowAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteDeployBondEscrowCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteDeployBondEscrowCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"forfeit"`
 */
export const useWriteDeployBondEscrowForfeit =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'forfeit',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"postBond"`
 */
export const useWriteDeployBondEscrowPostBond =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'postBond',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"refund"`
 */
export const useWriteDeployBondEscrowRefund =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'refund',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"release"`
 */
export const useWriteDeployBondEscrowRelease =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'release',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteDeployBondEscrowRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteDeployBondEscrowRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"setBondAmount"`
 */
export const useWriteDeployBondEscrowSetBondAmount =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'setBondAmount',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"setGraceDays"`
 */
export const useWriteDeployBondEscrowSetGraceDays =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'setGraceDays',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"setMaxBondDuration"`
 */
export const useWriteDeployBondEscrowSetMaxBondDuration =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'setMaxBondDuration',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteDeployBondEscrowSetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteDeployBondEscrowTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: deployBondEscrowAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__
 */
export const useSimulateDeployBondEscrow =
  /*#__PURE__*/ createUseSimulateContract({ abi: deployBondEscrowAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateDeployBondEscrowCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateDeployBondEscrowCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"forfeit"`
 */
export const useSimulateDeployBondEscrowForfeit =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'forfeit',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"postBond"`
 */
export const useSimulateDeployBondEscrowPostBond =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'postBond',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"refund"`
 */
export const useSimulateDeployBondEscrowRefund =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'refund',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"release"`
 */
export const useSimulateDeployBondEscrowRelease =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'release',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateDeployBondEscrowRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateDeployBondEscrowRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"setBondAmount"`
 */
export const useSimulateDeployBondEscrowSetBondAmount =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'setBondAmount',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"setGraceDays"`
 */
export const useSimulateDeployBondEscrowSetGraceDays =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'setGraceDays',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"setMaxBondDuration"`
 */
export const useSimulateDeployBondEscrowSetMaxBondDuration =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'setMaxBondDuration',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateDeployBondEscrowSetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateDeployBondEscrowTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: deployBondEscrowAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__
 */
export const useWatchDeployBondEscrowEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: deployBondEscrowAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"BondAmountUpdated"`
 */
export const useWatchDeployBondEscrowBondAmountUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'BondAmountUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"BondForfeited"`
 */
export const useWatchDeployBondEscrowBondForfeitedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'BondForfeited',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"BondPosted"`
 */
export const useWatchDeployBondEscrowBondPostedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'BondPosted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"BondRefunded"`
 */
export const useWatchDeployBondEscrowBondRefundedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'BondRefunded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"BondReleased"`
 */
export const useWatchDeployBondEscrowBondReleasedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'BondReleased',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"GraceDaysUpdated"`
 */
export const useWatchDeployBondEscrowGraceDaysUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'GraceDaysUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"MaxBondDurationUpdated"`
 */
export const useWatchDeployBondEscrowMaxBondDurationUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'MaxBondDurationUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchDeployBondEscrowOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchDeployBondEscrowOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchDeployBondEscrowOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link deployBondEscrowAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchDeployBondEscrowProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: deployBondEscrowAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__
 */
export const useReadErc1155Factory = /*#__PURE__*/ createUseReadContract({
  abi: erc1155FactoryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"componentRegistry"`
 */
export const useReadErc1155FactoryComponentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'componentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"computeInstanceAddress"`
 */
export const useReadErc1155FactoryComputeInstanceAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'computeInstanceAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"dynamicPricingModule"`
 */
export const useReadErc1155FactoryDynamicPricingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'dynamicPricingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"features"`
 */
export const useReadErc1155FactoryFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'features',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc1155FactoryGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc1155FactoryMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc1155FactoryOwner = /*#__PURE__*/ createUseReadContract({
  abi: erc1155FactoryAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc1155FactoryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"protocol"`
 */
export const useReadErc1155FactoryProtocol =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'protocol',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc1155FactoryProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"requiredFeatures"`
 */
export const useReadErc1155FactoryRequiredFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'requiredFeatures',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc1155FactoryWeth = /*#__PURE__*/ createUseReadContract({
  abi: erc1155FactoryAbi,
  functionName: 'weth',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__
 */
export const useWriteErc1155Factory = /*#__PURE__*/ createUseWriteContract({
  abi: erc1155FactoryAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc1155FactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc1155FactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useWriteErc1155FactoryCreateInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc1155FactoryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc1155FactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setDynamicPricingModule"`
 */
export const useWriteErc1155FactorySetDynamicPricingModule =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'setDynamicPricingModule',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteErc1155FactorySetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useWriteErc1155FactorySetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc1155FactoryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__
 */
export const useSimulateErc1155Factory =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc1155FactoryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc1155FactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc1155FactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useSimulateErc1155FactoryCreateInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc1155FactoryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc1155FactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setDynamicPricingModule"`
 */
export const useSimulateErc1155FactorySetDynamicPricingModule =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'setDynamicPricingModule',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateErc1155FactorySetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useSimulateErc1155FactorySetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc1155FactoryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__
 */
export const useWatchErc1155FactoryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc1155FactoryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"InstanceCreated"`
 */
export const useWatchErc1155FactoryInstanceCreatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'InstanceCreated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc1155FactoryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc1155FactoryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc1155FactoryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchErc1155FactoryProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__
 */
export const useReadErc1155Instance = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"agentDelegationEnabled"`
 */
export const useReadErc1155InstanceAgentDelegationEnabled =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'agentDelegationEnabled',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadErc1155InstanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"calculateMintCost"`
 */
export const useReadErc1155InstanceCalculateMintCost =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'calculateMintCost',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"creator"`
 */
export const useReadErc1155InstanceCreator =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'creator',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"dynamicPricingModule"`
 */
export const useReadErc1155InstanceDynamicPricingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'dynamicPricingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"editions"`
 */
export const useReadErc1155InstanceEditions =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'editions',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"factory"`
 */
export const useReadErc1155InstanceFactory =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'factory',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"freeMintAllocation"`
 */
export const useReadErc1155InstanceFreeMintAllocation =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'freeMintAllocation',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"freeMintClaimed"`
 */
export const useReadErc1155InstanceFreeMintClaimed =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'freeMintClaimed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"freeMintsClaimed"`
 */
export const useReadErc1155InstanceFreeMintsClaimed =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'freeMintsClaimed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"gatingModule"`
 */
export const useReadErc1155InstanceGatingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'gatingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"gatingScope"`
 */
export const useReadErc1155InstanceGatingScope =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'gatingScope',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getAllEditionIds"`
 */
export const useReadErc1155InstanceGetAllEditionIds =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getAllEditionIds',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getCurrentPrice"`
 */
export const useReadErc1155InstanceGetCurrentPrice =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getCurrentPrice',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getEdition"`
 */
export const useReadErc1155InstanceGetEdition =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getEdition',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getEditionCount"`
 */
export const useReadErc1155InstanceGetEditionCount =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getEditionCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getGlobalMessageRegistry"`
 */
export const useReadErc1155InstanceGetGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getGlobalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc1155InstanceGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"instanceType"`
 */
export const useReadErc1155InstanceInstanceType =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'instanceType',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useReadErc1155InstanceIsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc1155InstanceMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"name"`
 */
export const useReadErc1155InstanceName = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
  functionName: 'name',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"nextEditionId"`
 */
export const useReadErc1155InstanceNextEditionId =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'nextEditionId',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc1155InstanceOwner = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc1155InstanceOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"pendingVaultCut"`
 */
export const useReadErc1155InstancePendingVaultCut =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'pendingVaultCut',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc1155InstanceProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"styleUri"`
 */
export const useReadErc1155InstanceStyleUri =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'styleUri',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"totalProceeds"`
 */
export const useReadErc1155InstanceTotalProceeds =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'totalProceeds',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"totalWithdrawn"`
 */
export const useReadErc1155InstanceTotalWithdrawn =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'totalWithdrawn',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"vault"`
 */
export const useReadErc1155InstanceVault = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
  functionName: 'vault',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc1155InstanceWeth = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
  functionName: 'weth',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__
 */
export const useWriteErc1155Instance = /*#__PURE__*/ createUseWriteContract({
  abi: erc1155InstanceAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"addEdition"`
 */
export const useWriteErc1155InstanceAddEdition =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'addEdition',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc1155InstanceCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimAllFees"`
 */
export const useWriteErc1155InstanceClaimAllFees =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimAllFees',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimFreeMint"`
 */
export const useWriteErc1155InstanceClaimFreeMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimFreeMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimVaultFees"`
 */
export const useWriteErc1155InstanceClaimVaultFees =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimVaultFees',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc1155InstanceCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"initializeFreeMint"`
 */
export const useWriteErc1155InstanceInitializeFreeMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'initializeFreeMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"migrateVault"`
 */
export const useWriteErc1155InstanceMigrateVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"mint"`
 */
export const useWriteErc1155InstanceMint = /*#__PURE__*/ createUseWriteContract(
  { abi: erc1155InstanceAbi, functionName: 'mint' },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc1155InstanceRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc1155InstanceRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"retryVaultContribution"`
 */
export const useWriteErc1155InstanceRetryVaultContribution =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'retryVaultContribution',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useWriteErc1155InstanceSafeBatchTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useWriteErc1155InstanceSafeTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setAgentDelegation"`
 */
export const useWriteErc1155InstanceSetAgentDelegation =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'setAgentDelegation',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useWriteErc1155InstanceSetApprovalForAll =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setStyle"`
 */
export const useWriteErc1155InstanceSetStyle =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'setStyle',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc1155InstanceTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"updateEditionMetadata"`
 */
export const useWriteErc1155InstanceUpdateEditionMetadata =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'updateEditionMetadata',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"withdraw"`
 */
export const useWriteErc1155InstanceWithdraw =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'withdraw',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__
 */
export const useSimulateErc1155Instance =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc1155InstanceAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"addEdition"`
 */
export const useSimulateErc1155InstanceAddEdition =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'addEdition',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc1155InstanceCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimAllFees"`
 */
export const useSimulateErc1155InstanceClaimAllFees =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimAllFees',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimFreeMint"`
 */
export const useSimulateErc1155InstanceClaimFreeMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimFreeMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimVaultFees"`
 */
export const useSimulateErc1155InstanceClaimVaultFees =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimVaultFees',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc1155InstanceCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"initializeFreeMint"`
 */
export const useSimulateErc1155InstanceInitializeFreeMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'initializeFreeMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"migrateVault"`
 */
export const useSimulateErc1155InstanceMigrateVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"mint"`
 */
export const useSimulateErc1155InstanceMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'mint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc1155InstanceRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc1155InstanceRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"retryVaultContribution"`
 */
export const useSimulateErc1155InstanceRetryVaultContribution =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'retryVaultContribution',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useSimulateErc1155InstanceSafeBatchTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useSimulateErc1155InstanceSafeTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setAgentDelegation"`
 */
export const useSimulateErc1155InstanceSetAgentDelegation =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'setAgentDelegation',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useSimulateErc1155InstanceSetApprovalForAll =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setStyle"`
 */
export const useSimulateErc1155InstanceSetStyle =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'setStyle',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc1155InstanceTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"updateEditionMetadata"`
 */
export const useSimulateErc1155InstanceUpdateEditionMetadata =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'updateEditionMetadata',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"withdraw"`
 */
export const useSimulateErc1155InstanceWithdraw =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'withdraw',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__
 */
export const useWatchErc1155InstanceEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc1155InstanceAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useWatchErc1155InstanceApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"ETHTransferFallbackToWETH"`
 */
export const useWatchErc1155InstanceEthTransferFallbackToWethEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'ETHTransferFallbackToWETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"EditionAdded"`
 */
export const useWatchErc1155InstanceEditionAddedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'EditionAdded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"EditionMetadataUpdated"`
 */
export const useWatchErc1155InstanceEditionMetadataUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'EditionMetadataUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"FreeMintClaimed"`
 */
export const useWatchErc1155InstanceFreeMintClaimedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'FreeMintClaimed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"Minted"`
 */
export const useWatchErc1155InstanceMintedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'Minted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc1155InstanceOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc1155InstanceOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc1155InstanceOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"StateChanged"`
 */
export const useWatchErc1155InstanceStateChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'StateChanged',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"TransferBatch"`
 */
export const useWatchErc1155InstanceTransferBatchEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'TransferBatch',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"TransferSingle"`
 */
export const useWatchErc1155InstanceTransferSingleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'TransferSingle',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"VaultContributionFailed"`
 */
export const useWatchErc1155InstanceVaultContributionFailedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'VaultContributionFailed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"VaultContributionRetried"`
 */
export const useWatchErc1155InstanceVaultContributionRetriedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'VaultContributionRetried',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"Withdrawn"`
 */
export const useWatchErc1155InstanceWithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'Withdrawn',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__
 */
export const useReadErc404BondingInstance = /*#__PURE__*/ createUseReadContract(
  { abi: erc404BondingInstanceAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"agentDelegationEnabled"`
 */
export const useReadErc404BondingInstanceAgentDelegationEnabled =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'agentDelegationEnabled',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"allowance"`
 */
export const useReadErc404BondingInstanceAllowance =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'allowance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadErc404BondingInstanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"bondingActive"`
 */
export const useReadErc404BondingInstanceBondingActive =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'bondingActive',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"bondingFeeBps"`
 */
export const useReadErc404BondingInstanceBondingFeeBps =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'bondingFeeBps',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"bondingMaturityTime"`
 */
export const useReadErc404BondingInstanceBondingMaturityTime =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'bondingMaturityTime',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"bondingOpenTime"`
 */
export const useReadErc404BondingInstanceBondingOpenTime =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'bondingOpenTime',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"curveParams"`
 */
export const useReadErc404BondingInstanceCurveParams =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'curveParams',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"decimals"`
 */
export const useReadErc404BondingInstanceDecimals =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'decimals',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"declaredMaxAllowanceBps"`
 */
export const useReadErc404BondingInstanceDeclaredMaxAllowanceBps =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'declaredMaxAllowanceBps',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"factory"`
 */
export const useReadErc404BondingInstanceFactory =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'factory',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"freeMintAllocation"`
 */
export const useReadErc404BondingInstanceFreeMintAllocation =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'freeMintAllocation',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"freeMintClaimed"`
 */
export const useReadErc404BondingInstanceFreeMintClaimed =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'freeMintClaimed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"freeMintsClaimed"`
 */
export const useReadErc404BondingInstanceFreeMintsClaimed =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'freeMintsClaimed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"gatingActive"`
 */
export const useReadErc404BondingInstanceGatingActive =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'gatingActive',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"gatingModule"`
 */
export const useReadErc404BondingInstanceGatingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'gatingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"gatingScope"`
 */
export const useReadErc404BondingInstanceGatingScope =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'gatingScope',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"getSkipNFT"`
 */
export const useReadErc404BondingInstanceGetSkipNft =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'getSkipNFT',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc404BondingInstanceGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"graduated"`
 */
export const useReadErc404BondingInstanceGraduated =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'graduated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"instanceType"`
 */
export const useReadErc404BondingInstanceInstanceType =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'instanceType',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"liquidityDeployer"`
 */
export const useReadErc404BondingInstanceLiquidityDeployer =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'liquidityDeployer',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"liquidityReserve"`
 */
export const useReadErc404BondingInstanceLiquidityReserve =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'liquidityReserve',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc404BondingInstanceMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"maxSupply"`
 */
export const useReadErc404BondingInstanceMaxSupply =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'maxSupply',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadErc404BondingInstanceMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"mirrorERC721"`
 */
export const useReadErc404BondingInstanceMirrorErc721 =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'mirrorERC721',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"modules"`
 */
export const useReadErc404BondingInstanceModules =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'modules',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"name"`
 */
export const useReadErc404BondingInstanceName =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'name',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc404BondingInstanceOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"ownerOf"`
 */
export const useReadErc404BondingInstanceOwnerOf =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'ownerOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc404BondingInstanceOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"previewCarve"`
 */
export const useReadErc404BondingInstancePreviewCarve =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'previewCarve',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc404BondingInstanceProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"reserve"`
 */
export const useReadErc404BondingInstanceReserve =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'reserve',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"stakingActive"`
 */
export const useReadErc404BondingInstanceStakingActive =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'stakingActive',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"stakingModule"`
 */
export const useReadErc404BondingInstanceStakingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'stakingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"styleUri"`
 */
export const useReadErc404BondingInstanceStyleUri =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'styleUri',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"symbol"`
 */
export const useReadErc404BondingInstanceSymbol =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'symbol',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"totalBondingSupply"`
 */
export const useReadErc404BondingInstanceTotalBondingSupply =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'totalBondingSupply',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"totalSupply"`
 */
export const useReadErc404BondingInstanceTotalSupply =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'totalSupply',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"unit"`
 */
export const useReadErc404BondingInstanceUnit =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'unit',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"vault"`
 */
export const useReadErc404BondingInstanceVault =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'vault',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc404BondingInstanceWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__
 */
export const useWriteErc404BondingInstance =
  /*#__PURE__*/ createUseWriteContract({ abi: erc404BondingInstanceAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"activateStaking"`
 */
export const useWriteErc404BondingInstanceActivateStaking =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'activateStaking',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"approve"`
 */
export const useWriteErc404BondingInstanceApprove =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'approve',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"buyBonding"`
 */
export const useWriteErc404BondingInstanceBuyBonding =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'buyBonding',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc404BondingInstanceCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"claimAllFees"`
 */
export const useWriteErc404BondingInstanceClaimAllFees =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'claimAllFees',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"claimFreeMint"`
 */
export const useWriteErc404BondingInstanceClaimFreeMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'claimFreeMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"claimStakingRewards"`
 */
export const useWriteErc404BondingInstanceClaimStakingRewards =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'claimStakingRewards',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc404BondingInstanceCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"deployLiquidity"`
 */
export const useWriteErc404BondingInstanceDeployLiquidity =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'deployLiquidity',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initModule"`
 */
export const useWriteErc404BondingInstanceInitModule =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initModule',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteErc404BondingInstanceInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initializeFreeMint"`
 */
export const useWriteErc404BondingInstanceInitializeFreeMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initializeFreeMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initializeMetadata"`
 */
export const useWriteErc404BondingInstanceInitializeMetadata =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initializeMetadata',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initializeProtocol"`
 */
export const useWriteErc404BondingInstanceInitializeProtocol =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initializeProtocol',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initializeStaking"`
 */
export const useWriteErc404BondingInstanceInitializeStaking =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initializeStaking',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"migrateVault"`
 */
export const useWriteErc404BondingInstanceMigrateVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc404BondingInstanceRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc404BondingInstanceRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"rerollSelectedNFTs"`
 */
export const useWriteErc404BondingInstanceRerollSelectedNfTs =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'rerollSelectedNFTs',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"sellBonding"`
 */
export const useWriteErc404BondingInstanceSellBonding =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'sellBonding',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setAgentDelegation"`
 */
export const useWriteErc404BondingInstanceSetAgentDelegation =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setAgentDelegation',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setAgentDelegationFromFactory"`
 */
export const useWriteErc404BondingInstanceSetAgentDelegationFromFactory =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setAgentDelegationFromFactory',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setBondingActive"`
 */
export const useWriteErc404BondingInstanceSetBondingActive =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setBondingActive',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setBondingMaturityTime"`
 */
export const useWriteErc404BondingInstanceSetBondingMaturityTime =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setBondingMaturityTime',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setBondingOpenTime"`
 */
export const useWriteErc404BondingInstanceSetBondingOpenTime =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setBondingOpenTime',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWriteErc404BondingInstanceSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setSkipNFT"`
 */
export const useWriteErc404BondingInstanceSetSkipNft =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setSkipNFT',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setStyle"`
 */
export const useWriteErc404BondingInstanceSetStyle =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setStyle',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"stake"`
 */
export const useWriteErc404BondingInstanceStake =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'stake',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"transfer"`
 */
export const useWriteErc404BondingInstanceTransfer =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'transfer',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useWriteErc404BondingInstanceTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'transferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc404BondingInstanceTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"unstake"`
 */
export const useWriteErc404BondingInstanceUnstake =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'unstake',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"withdrawDust"`
 */
export const useWriteErc404BondingInstanceWithdrawDust =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'withdrawDust',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__
 */
export const useSimulateErc404BondingInstance =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc404BondingInstanceAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"activateStaking"`
 */
export const useSimulateErc404BondingInstanceActivateStaking =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'activateStaking',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"approve"`
 */
export const useSimulateErc404BondingInstanceApprove =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'approve',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"buyBonding"`
 */
export const useSimulateErc404BondingInstanceBuyBonding =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'buyBonding',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc404BondingInstanceCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"claimAllFees"`
 */
export const useSimulateErc404BondingInstanceClaimAllFees =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'claimAllFees',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"claimFreeMint"`
 */
export const useSimulateErc404BondingInstanceClaimFreeMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'claimFreeMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"claimStakingRewards"`
 */
export const useSimulateErc404BondingInstanceClaimStakingRewards =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'claimStakingRewards',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc404BondingInstanceCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"deployLiquidity"`
 */
export const useSimulateErc404BondingInstanceDeployLiquidity =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'deployLiquidity',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initModule"`
 */
export const useSimulateErc404BondingInstanceInitModule =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initModule',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateErc404BondingInstanceInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initializeFreeMint"`
 */
export const useSimulateErc404BondingInstanceInitializeFreeMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initializeFreeMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initializeMetadata"`
 */
export const useSimulateErc404BondingInstanceInitializeMetadata =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initializeMetadata',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initializeProtocol"`
 */
export const useSimulateErc404BondingInstanceInitializeProtocol =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initializeProtocol',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"initializeStaking"`
 */
export const useSimulateErc404BondingInstanceInitializeStaking =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'initializeStaking',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"migrateVault"`
 */
export const useSimulateErc404BondingInstanceMigrateVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc404BondingInstanceRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc404BondingInstanceRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"rerollSelectedNFTs"`
 */
export const useSimulateErc404BondingInstanceRerollSelectedNfTs =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'rerollSelectedNFTs',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"sellBonding"`
 */
export const useSimulateErc404BondingInstanceSellBonding =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'sellBonding',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setAgentDelegation"`
 */
export const useSimulateErc404BondingInstanceSetAgentDelegation =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setAgentDelegation',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setAgentDelegationFromFactory"`
 */
export const useSimulateErc404BondingInstanceSetAgentDelegationFromFactory =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setAgentDelegationFromFactory',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setBondingActive"`
 */
export const useSimulateErc404BondingInstanceSetBondingActive =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setBondingActive',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setBondingMaturityTime"`
 */
export const useSimulateErc404BondingInstanceSetBondingMaturityTime =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setBondingMaturityTime',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setBondingOpenTime"`
 */
export const useSimulateErc404BondingInstanceSetBondingOpenTime =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setBondingOpenTime',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulateErc404BondingInstanceSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setSkipNFT"`
 */
export const useSimulateErc404BondingInstanceSetSkipNft =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setSkipNFT',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"setStyle"`
 */
export const useSimulateErc404BondingInstanceSetStyle =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'setStyle',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"stake"`
 */
export const useSimulateErc404BondingInstanceStake =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'stake',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"transfer"`
 */
export const useSimulateErc404BondingInstanceTransfer =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'transfer',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useSimulateErc404BondingInstanceTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'transferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc404BondingInstanceTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"unstake"`
 */
export const useSimulateErc404BondingInstanceUnstake =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'unstake',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `functionName` set to `"withdrawDust"`
 */
export const useSimulateErc404BondingInstanceWithdrawDust =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404BondingInstanceAbi,
    functionName: 'withdrawDust',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__
 */
export const useWatchErc404BondingInstanceEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc404BondingInstanceAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"AgentDelegationChanged"`
 */
export const useWatchErc404BondingInstanceAgentDelegationChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'AgentDelegationChanged',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"Approval"`
 */
export const useWatchErc404BondingInstanceApprovalEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'Approval',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"BondingActiveChanged"`
 */
export const useWatchErc404BondingInstanceBondingActiveChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'BondingActiveChanged',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"BondingFeePaid"`
 */
export const useWatchErc404BondingInstanceBondingFeePaidEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'BondingFeePaid',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"BondingMaturityTimeSet"`
 */
export const useWatchErc404BondingInstanceBondingMaturityTimeSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'BondingMaturityTimeSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"BondingOpenTimeSet"`
 */
export const useWatchErc404BondingInstanceBondingOpenTimeSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'BondingOpenTimeSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"BondingSale"`
 */
export const useWatchErc404BondingInstanceBondingSaleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'BondingSale',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"ETHTransferFallbackToWETH"`
 */
export const useWatchErc404BondingInstanceEthTransferFallbackToWethEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'ETHTransferFallbackToWETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"FreeMintClaimed"`
 */
export const useWatchErc404BondingInstanceFreeMintClaimedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'FreeMintClaimed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"LiquidityDeployed"`
 */
export const useWatchErc404BondingInstanceLiquidityDeployedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'LiquidityDeployed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"ModuleSet"`
 */
export const useWatchErc404BondingInstanceModuleSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'ModuleSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc404BondingInstanceOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc404BondingInstanceOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc404BondingInstanceOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"RerollCompleted"`
 */
export const useWatchErc404BondingInstanceRerollCompletedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'RerollCompleted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"RerollInitiated"`
 */
export const useWatchErc404BondingInstanceRerollInitiatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'RerollInitiated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"SkipNFTSet"`
 */
export const useWatchErc404BondingInstanceSkipNftSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'SkipNFTSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"Staked"`
 */
export const useWatchErc404BondingInstanceStakedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'Staked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"StakingActivated"`
 */
export const useWatchErc404BondingInstanceStakingActivatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'StakingActivated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"StakingRewardsClaimed"`
 */
export const useWatchErc404BondingInstanceStakingRewardsClaimedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'StakingRewardsClaimed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"StateChanged"`
 */
export const useWatchErc404BondingInstanceStateChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'StateChanged',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"Transfer"`
 */
export const useWatchErc404BondingInstanceTransferEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'Transfer',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404BondingInstanceAbi}__ and `eventName` set to `"Unstaked"`
 */
export const useWatchErc404BondingInstanceUnstakedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404BondingInstanceAbi,
    eventName: 'Unstaked',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__
 */
export const useReadErc404Factory = /*#__PURE__*/ createUseReadContract({
  abi: erc404FactoryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"PROTOCOL_ROLE"`
 */
export const useReadErc404FactoryProtocolRole =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'PROTOCOL_ROLE',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"bondingFeeBps"`
 */
export const useReadErc404FactoryBondingFeeBps =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'bondingFeeBps',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"carveBracketParams"`
 */
export const useReadErc404FactoryCarveBracketParams =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'carveBracketParams',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"componentRegistry"`
 */
export const useReadErc404FactoryComponentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'componentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"computeInstanceAddress"`
 */
export const useReadErc404FactoryComputeInstanceAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'computeInstanceAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"deployBondEscrow"`
 */
export const useReadErc404FactoryDeployBondEscrow =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'deployBondEscrow',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"effectiveCarveEth"`
 */
export const useReadErc404FactoryEffectiveCarveEth =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'effectiveCarveEth',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"features"`
 */
export const useReadErc404FactoryFeatures = /*#__PURE__*/ createUseReadContract(
  { abi: erc404FactoryAbi, functionName: 'features' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc404FactoryGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"hasAllRoles"`
 */
export const useReadErc404FactoryHasAllRoles =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'hasAllRoles',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"hasAnyRole"`
 */
export const useReadErc404FactoryHasAnyRole =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'hasAnyRole',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"implementation"`
 */
export const useReadErc404FactoryImplementation =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'implementation',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"launchManager"`
 */
export const useReadErc404FactoryLaunchManager =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'launchManager',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc404FactoryMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"minPoolEth"`
 */
export const useReadErc404FactoryMinPoolEth =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'minPoolEth',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc404FactoryOwner = /*#__PURE__*/ createUseReadContract({
  abi: erc404FactoryAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc404FactoryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"protocol"`
 */
export const useReadErc404FactoryProtocol = /*#__PURE__*/ createUseReadContract(
  { abi: erc404FactoryAbi, functionName: 'protocol' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc404FactoryProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"requiredFeatures"`
 */
export const useReadErc404FactoryRequiredFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'requiredFeatures',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"rolesOf"`
 */
export const useReadErc404FactoryRolesOf = /*#__PURE__*/ createUseReadContract({
  abi: erc404FactoryAbi,
  functionName: 'rolesOf',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc404FactoryWeth = /*#__PURE__*/ createUseReadContract({
  abi: erc404FactoryAbi,
  functionName: 'weth',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__
 */
export const useWriteErc404Factory = /*#__PURE__*/ createUseWriteContract({
  abi: erc404FactoryAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc404FactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc404FactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useWriteErc404FactoryCreateInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"grantRoles"`
 */
export const useWriteErc404FactoryGrantRoles =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'grantRoles',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc404FactoryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"renounceRoles"`
 */
export const useWriteErc404FactoryRenounceRoles =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'renounceRoles',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc404FactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"revokeRoles"`
 */
export const useWriteErc404FactoryRevokeRoles =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'revokeRoles',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setBondingFeeBps"`
 */
export const useWriteErc404FactorySetBondingFeeBps =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setBondingFeeBps',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setCarveBrackets"`
 */
export const useWriteErc404FactorySetCarveBrackets =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setCarveBrackets',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setDeployBondEscrow"`
 */
export const useWriteErc404FactorySetDeployBondEscrow =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setDeployBondEscrow',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setMinPoolEth"`
 */
export const useWriteErc404FactorySetMinPoolEth =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setMinPoolEth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteErc404FactorySetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useWriteErc404FactorySetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc404FactoryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"transferProtocolRole"`
 */
export const useWriteErc404FactoryTransferProtocolRole =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'transferProtocolRole',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__
 */
export const useSimulateErc404Factory = /*#__PURE__*/ createUseSimulateContract(
  { abi: erc404FactoryAbi },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc404FactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc404FactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useSimulateErc404FactoryCreateInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"grantRoles"`
 */
export const useSimulateErc404FactoryGrantRoles =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'grantRoles',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc404FactoryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"renounceRoles"`
 */
export const useSimulateErc404FactoryRenounceRoles =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'renounceRoles',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc404FactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"revokeRoles"`
 */
export const useSimulateErc404FactoryRevokeRoles =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'revokeRoles',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setBondingFeeBps"`
 */
export const useSimulateErc404FactorySetBondingFeeBps =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setBondingFeeBps',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setCarveBrackets"`
 */
export const useSimulateErc404FactorySetCarveBrackets =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setCarveBrackets',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setDeployBondEscrow"`
 */
export const useSimulateErc404FactorySetDeployBondEscrow =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setDeployBondEscrow',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setMinPoolEth"`
 */
export const useSimulateErc404FactorySetMinPoolEth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setMinPoolEth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateErc404FactorySetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useSimulateErc404FactorySetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc404FactoryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"transferProtocolRole"`
 */
export const useSimulateErc404FactoryTransferProtocolRole =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'transferProtocolRole',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__
 */
export const useWatchErc404FactoryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc404FactoryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"BondingFeeUpdated"`
 */
export const useWatchErc404FactoryBondingFeeUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'BondingFeeUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"CarveBracketsUpdated"`
 */
export const useWatchErc404FactoryCarveBracketsUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'CarveBracketsUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"DeclaredMaxAllowance"`
 */
export const useWatchErc404FactoryDeclaredMaxAllowanceEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'DeclaredMaxAllowance',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"DeployBondEscrowUpdated"`
 */
export const useWatchErc404FactoryDeployBondEscrowUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'DeployBondEscrowUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"InstanceCreated"`
 */
export const useWatchErc404FactoryInstanceCreatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'InstanceCreated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"MinPoolEthUpdated"`
 */
export const useWatchErc404FactoryMinPoolEthUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'MinPoolEthUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc404FactoryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc404FactoryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc404FactoryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchErc404FactoryProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"RolesUpdated"`
 */
export const useWatchErc404FactoryRolesUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'RolesUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"VaultCapabilityWarning"`
 */
export const useWatchErc404FactoryVaultCapabilityWarningEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'VaultCapabilityWarning',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__
 */
export const useReadErc404StakingModule = /*#__PURE__*/ createUseReadContract({
  abi: erc404StakingModuleAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"calculatePendingRewards"`
 */
export const useReadErc404StakingModuleCalculatePendingRewards =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'calculatePendingRewards',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"getStakingInfo"`
 */
export const useReadErc404StakingModuleGetStakingInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'getStakingInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc404StakingModuleMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"rewardPerTokenPaid"`
 */
export const useReadErc404StakingModuleRewardPerTokenPaid =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'rewardPerTokenPaid',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"rewardPerTokenStored"`
 */
export const useReadErc404StakingModuleRewardPerTokenStored =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'rewardPerTokenStored',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"rewardsAccrued"`
 */
export const useReadErc404StakingModuleRewardsAccrued =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'rewardsAccrued',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"stakedBalance"`
 */
export const useReadErc404StakingModuleStakedBalance =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'stakedBalance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"stakingEnabled"`
 */
export const useReadErc404StakingModuleStakingEnabled =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'stakingEnabled',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"totalStaked"`
 */
export const useReadErc404StakingModuleTotalStaked =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404StakingModuleAbi,
    functionName: 'totalStaked',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__
 */
export const useWriteErc404StakingModule = /*#__PURE__*/ createUseWriteContract(
  { abi: erc404StakingModuleAbi },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"computeClaim"`
 */
export const useWriteErc404StakingModuleComputeClaim =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404StakingModuleAbi,
    functionName: 'computeClaim',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"enableStaking"`
 */
export const useWriteErc404StakingModuleEnableStaking =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404StakingModuleAbi,
    functionName: 'enableStaking',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"recordFeesReceived"`
 */
export const useWriteErc404StakingModuleRecordFeesReceived =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404StakingModuleAbi,
    functionName: 'recordFeesReceived',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"recordStake"`
 */
export const useWriteErc404StakingModuleRecordStake =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404StakingModuleAbi,
    functionName: 'recordStake',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"recordUnstake"`
 */
export const useWriteErc404StakingModuleRecordUnstake =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404StakingModuleAbi,
    functionName: 'recordUnstake',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__
 */
export const useSimulateErc404StakingModule =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc404StakingModuleAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"computeClaim"`
 */
export const useSimulateErc404StakingModuleComputeClaim =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404StakingModuleAbi,
    functionName: 'computeClaim',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"enableStaking"`
 */
export const useSimulateErc404StakingModuleEnableStaking =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404StakingModuleAbi,
    functionName: 'enableStaking',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"recordFeesReceived"`
 */
export const useSimulateErc404StakingModuleRecordFeesReceived =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404StakingModuleAbi,
    functionName: 'recordFeesReceived',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"recordStake"`
 */
export const useSimulateErc404StakingModuleRecordStake =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404StakingModuleAbi,
    functionName: 'recordStake',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `functionName` set to `"recordUnstake"`
 */
export const useSimulateErc404StakingModuleRecordUnstake =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404StakingModuleAbi,
    functionName: 'recordUnstake',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404StakingModuleAbi}__
 */
export const useWatchErc404StakingModuleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc404StakingModuleAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `eventName` set to `"FeesReceived"`
 */
export const useWatchErc404StakingModuleFeesReceivedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404StakingModuleAbi,
    eventName: 'FeesReceived',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `eventName` set to `"RewardsClaimed"`
 */
export const useWatchErc404StakingModuleRewardsClaimedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404StakingModuleAbi,
    eventName: 'RewardsClaimed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `eventName` set to `"Staked"`
 */
export const useWatchErc404StakingModuleStakedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404StakingModuleAbi,
    eventName: 'Staked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `eventName` set to `"StakingEnabled"`
 */
export const useWatchErc404StakingModuleStakingEnabledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404StakingModuleAbi,
    eventName: 'StakingEnabled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404StakingModuleAbi}__ and `eventName` set to `"Unstaked"`
 */
export const useWatchErc404StakingModuleUnstakedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404StakingModuleAbi,
    eventName: 'Unstaked',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__
 */
export const useReadErc721AuctionFactory = /*#__PURE__*/ createUseReadContract({
  abi: erc721AuctionFactoryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"computeInstanceAddress"`
 */
export const useReadErc721AuctionFactoryComputeInstanceAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'computeInstanceAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"features"`
 */
export const useReadErc721AuctionFactoryFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'features',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc721AuctionFactoryGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc721AuctionFactoryMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc721AuctionFactoryOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc721AuctionFactoryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"protocol"`
 */
export const useReadErc721AuctionFactoryProtocol =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'protocol',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc721AuctionFactoryProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"requiredFeatures"`
 */
export const useReadErc721AuctionFactoryRequiredFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'requiredFeatures',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc721AuctionFactoryWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__
 */
export const useWriteErc721AuctionFactory =
  /*#__PURE__*/ createUseWriteContract({ abi: erc721AuctionFactoryAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc721AuctionFactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc721AuctionFactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useWriteErc721AuctionFactoryCreateInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc721AuctionFactoryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc721AuctionFactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteErc721AuctionFactorySetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useWriteErc721AuctionFactorySetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc721AuctionFactoryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__
 */
export const useSimulateErc721AuctionFactory =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc721AuctionFactoryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc721AuctionFactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc721AuctionFactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useSimulateErc721AuctionFactoryCreateInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc721AuctionFactoryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc721AuctionFactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateErc721AuctionFactorySetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useSimulateErc721AuctionFactorySetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc721AuctionFactoryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__
 */
export const useWatchErc721AuctionFactoryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc721AuctionFactoryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"InstanceCreated"`
 */
export const useWatchErc721AuctionFactoryInstanceCreatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'InstanceCreated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc721AuctionFactoryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc721AuctionFactoryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc721AuctionFactoryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchErc721AuctionFactoryProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"VaultCapabilityWarning"`
 */
export const useWatchErc721AuctionFactoryVaultCapabilityWarningEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'VaultCapabilityWarning',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__
 */
export const useReadErc721AuctionInstance = /*#__PURE__*/ createUseReadContract(
  { abi: erc721AuctionInstanceAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"agentDelegationEnabled"`
 */
export const useReadErc721AuctionInstanceAgentDelegationEnabled =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'agentDelegationEnabled',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"auctions"`
 */
export const useReadErc721AuctionInstanceAuctions =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'auctions',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadErc721AuctionInstanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"baseDuration"`
 */
export const useReadErc721AuctionInstanceBaseDuration =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'baseDuration',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"bidIncrement"`
 */
export const useReadErc721AuctionInstanceBidIncrement =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'bidIncrement',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"factory"`
 */
export const useReadErc721AuctionInstanceFactory =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'factory',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"getActiveAuction"`
 */
export const useReadErc721AuctionInstanceGetActiveAuction =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'getActiveAuction',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"getApproved"`
 */
export const useReadErc721AuctionInstanceGetApproved =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'getApproved',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"getAuction"`
 */
export const useReadErc721AuctionInstanceGetAuction =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'getAuction',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"getGlobalMessageRegistry"`
 */
export const useReadErc721AuctionInstanceGetGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'getGlobalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"getQueueLength"`
 */
export const useReadErc721AuctionInstanceGetQueueLength =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'getQueueLength',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc721AuctionInstanceGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"instanceType"`
 */
export const useReadErc721AuctionInstanceInstanceType =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'instanceType',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useReadErc721AuctionInstanceIsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"lineQueueHead"`
 */
export const useReadErc721AuctionInstanceLineQueueHead =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'lineQueueHead',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"lineQueues"`
 */
export const useReadErc721AuctionInstanceLineQueues =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'lineQueues',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"lines"`
 */
export const useReadErc721AuctionInstanceLines =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'lines',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc721AuctionInstanceMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"name"`
 */
export const useReadErc721AuctionInstanceName =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'name',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"nextTokenId"`
 */
export const useReadErc721AuctionInstanceNextTokenId =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'nextTokenId',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc721AuctionInstanceOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"ownerOf"`
 */
export const useReadErc721AuctionInstanceOwnerOf =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'ownerOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc721AuctionInstanceOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"pendingVaultCut"`
 */
export const useReadErc721AuctionInstancePendingVaultCut =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'pendingVaultCut',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc721AuctionInstanceProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"supportsInterface"`
 */
export const useReadErc721AuctionInstanceSupportsInterface =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'supportsInterface',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"symbol"`
 */
export const useReadErc721AuctionInstanceSymbol =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'symbol',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"timeBuffer"`
 */
export const useReadErc721AuctionInstanceTimeBuffer =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'timeBuffer',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"tokenURI"`
 */
export const useReadErc721AuctionInstanceTokenUri =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'tokenURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"vault"`
 */
export const useReadErc721AuctionInstanceVault =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'vault',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc721AuctionInstanceWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__
 */
export const useWriteErc721AuctionInstance =
  /*#__PURE__*/ createUseWriteContract({ abi: erc721AuctionInstanceAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"approve"`
 */
export const useWriteErc721AuctionInstanceApprove =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'approve',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc721AuctionInstanceCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"claimAllFees"`
 */
export const useWriteErc721AuctionInstanceClaimAllFees =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'claimAllFees',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"claimVaultFees"`
 */
export const useWriteErc721AuctionInstanceClaimVaultFees =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'claimVaultFees',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc721AuctionInstanceCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"createBid"`
 */
export const useWriteErc721AuctionInstanceCreateBid =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'createBid',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"flushPendingVaultCut"`
 */
export const useWriteErc721AuctionInstanceFlushPendingVaultCut =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'flushPendingVaultCut',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"migrateVault"`
 */
export const useWriteErc721AuctionInstanceMigrateVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"queuePiece"`
 */
export const useWriteErc721AuctionInstanceQueuePiece =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'queuePiece',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"reclaimUnsold"`
 */
export const useWriteErc721AuctionInstanceReclaimUnsold =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'reclaimUnsold',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc721AuctionInstanceRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc721AuctionInstanceRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useWriteErc721AuctionInstanceSafeTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"setAgentDelegation"`
 */
export const useWriteErc721AuctionInstanceSetAgentDelegation =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'setAgentDelegation',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"setAgentDelegationFromFactory"`
 */
export const useWriteErc721AuctionInstanceSetAgentDelegationFromFactory =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'setAgentDelegationFromFactory',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useWriteErc721AuctionInstanceSetApprovalForAll =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"settleAuction"`
 */
export const useWriteErc721AuctionInstanceSettleAuction =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'settleAuction',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useWriteErc721AuctionInstanceTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'transferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc721AuctionInstanceTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__
 */
export const useSimulateErc721AuctionInstance =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc721AuctionInstanceAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"approve"`
 */
export const useSimulateErc721AuctionInstanceApprove =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'approve',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc721AuctionInstanceCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"claimAllFees"`
 */
export const useSimulateErc721AuctionInstanceClaimAllFees =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'claimAllFees',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"claimVaultFees"`
 */
export const useSimulateErc721AuctionInstanceClaimVaultFees =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'claimVaultFees',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc721AuctionInstanceCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"createBid"`
 */
export const useSimulateErc721AuctionInstanceCreateBid =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'createBid',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"flushPendingVaultCut"`
 */
export const useSimulateErc721AuctionInstanceFlushPendingVaultCut =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'flushPendingVaultCut',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"migrateVault"`
 */
export const useSimulateErc721AuctionInstanceMigrateVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"queuePiece"`
 */
export const useSimulateErc721AuctionInstanceQueuePiece =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'queuePiece',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"reclaimUnsold"`
 */
export const useSimulateErc721AuctionInstanceReclaimUnsold =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'reclaimUnsold',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc721AuctionInstanceRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc721AuctionInstanceRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useSimulateErc721AuctionInstanceSafeTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"setAgentDelegation"`
 */
export const useSimulateErc721AuctionInstanceSetAgentDelegation =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'setAgentDelegation',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"setAgentDelegationFromFactory"`
 */
export const useSimulateErc721AuctionInstanceSetAgentDelegationFromFactory =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'setAgentDelegationFromFactory',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useSimulateErc721AuctionInstanceSetApprovalForAll =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"settleAuction"`
 */
export const useSimulateErc721AuctionInstanceSettleAuction =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'settleAuction',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"transferFrom"`
 */
export const useSimulateErc721AuctionInstanceTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'transferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc721AuctionInstanceTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionInstanceAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__
 */
export const useWatchErc721AuctionInstanceEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc721AuctionInstanceAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"AgentDelegationChanged"`
 */
export const useWatchErc721AuctionInstanceAgentDelegationChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'AgentDelegationChanged',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"Approval"`
 */
export const useWatchErc721AuctionInstanceApprovalEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'Approval',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useWatchErc721AuctionInstanceApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"AuctionSettled"`
 */
export const useWatchErc721AuctionInstanceAuctionSettledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'AuctionSettled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"AuctionStarted"`
 */
export const useWatchErc721AuctionInstanceAuctionStartedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'AuctionStarted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"BidPlaced"`
 */
export const useWatchErc721AuctionInstanceBidPlacedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'BidPlaced',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"ETHTransferFallbackToWETH"`
 */
export const useWatchErc721AuctionInstanceEthTransferFallbackToWethEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'ETHTransferFallbackToWETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc721AuctionInstanceOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc721AuctionInstanceOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc721AuctionInstanceOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"PieceQueued"`
 */
export const useWatchErc721AuctionInstancePieceQueuedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'PieceQueued',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"StateChanged"`
 */
export const useWatchErc721AuctionInstanceStateChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'StateChanged',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"Transfer"`
 */
export const useWatchErc721AuctionInstanceTransferEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'Transfer',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"UnsoldReclaimed"`
 */
export const useWatchErc721AuctionInstanceUnsoldReclaimedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'UnsoldReclaimed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionInstanceAbi}__ and `eventName` set to `"VaultContributionFailed"`
 */
export const useWatchErc721AuctionInstanceVaultContributionFailedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionInstanceAbi,
    eventName: 'VaultContributionFailed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__
 */
export const useReadFeaturedQueueManager = /*#__PURE__*/ createUseReadContract({
  abi: featuredQueueManagerAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"dailyDecayRate"`
 */
export const useReadFeaturedQueueManagerDailyDecayRate =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'dailyDecayRate',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"dailyRate"`
 */
export const useReadFeaturedQueueManagerDailyRate =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'dailyRate',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"getEffectiveRank"`
 */
export const useReadFeaturedQueueManagerGetEffectiveRank =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'getEffectiveRank',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"getFeaturedInstances"`
 */
export const useReadFeaturedQueueManagerGetFeaturedInstances =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'getFeaturedInstances',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"getRentalInfo"`
 */
export const useReadFeaturedQueueManagerGetRentalInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'getRentalInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadFeaturedQueueManagerMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"maxDuration"`
 */
export const useReadFeaturedQueueManagerMaxDuration =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'maxDuration',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"maxFeaturedSize"`
 */
export const useReadFeaturedQueueManagerMaxFeaturedSize =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'maxFeaturedSize',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"minDuration"`
 */
export const useReadFeaturedQueueManagerMinDuration =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'minDuration',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"owner"`
 */
export const useReadFeaturedQueueManagerOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadFeaturedQueueManagerOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadFeaturedQueueManagerProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadFeaturedQueueManagerProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"queueLength"`
 */
export const useReadFeaturedQueueManagerQueueLength =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'queueLength',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"quoteDurationCost"`
 */
export const useReadFeaturedQueueManagerQuoteDurationCost =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'quoteDurationCost',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"slots"`
 */
export const useReadFeaturedQueueManagerSlots =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'slots',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"weth"`
 */
export const useReadFeaturedQueueManagerWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__
 */
export const useWriteFeaturedQueueManager =
  /*#__PURE__*/ createUseWriteContract({ abi: featuredQueueManagerAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"boostRank"`
 */
export const useWriteFeaturedQueueManagerBoostRank =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'boostRank',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteFeaturedQueueManagerCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteFeaturedQueueManagerCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteFeaturedQueueManagerInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"pruneExpired"`
 */
export const useWriteFeaturedQueueManagerPruneExpired =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'pruneExpired',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"renewDuration"`
 */
export const useWriteFeaturedQueueManagerRenewDuration =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'renewDuration',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteFeaturedQueueManagerRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"rentFeatured"`
 */
export const useWriteFeaturedQueueManagerRentFeatured =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'rentFeatured',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteFeaturedQueueManagerRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDailyDecayRate"`
 */
export const useWriteFeaturedQueueManagerSetDailyDecayRate =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDailyDecayRate',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDailyRate"`
 */
export const useWriteFeaturedQueueManagerSetDailyRate =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDailyRate',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDurationBounds"`
 */
export const useWriteFeaturedQueueManagerSetDurationBounds =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDurationBounds',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useWriteFeaturedQueueManagerSetMasterRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setMaxFeaturedSize"`
 */
export const useWriteFeaturedQueueManagerSetMaxFeaturedSize =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setMaxFeaturedSize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteFeaturedQueueManagerSetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setWeth"`
 */
export const useWriteFeaturedQueueManagerSetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteFeaturedQueueManagerTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteFeaturedQueueManagerUpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__
 */
export const useSimulateFeaturedQueueManager =
  /*#__PURE__*/ createUseSimulateContract({ abi: featuredQueueManagerAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"boostRank"`
 */
export const useSimulateFeaturedQueueManagerBoostRank =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'boostRank',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateFeaturedQueueManagerCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateFeaturedQueueManagerCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateFeaturedQueueManagerInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"pruneExpired"`
 */
export const useSimulateFeaturedQueueManagerPruneExpired =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'pruneExpired',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"renewDuration"`
 */
export const useSimulateFeaturedQueueManagerRenewDuration =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'renewDuration',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateFeaturedQueueManagerRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"rentFeatured"`
 */
export const useSimulateFeaturedQueueManagerRentFeatured =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'rentFeatured',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateFeaturedQueueManagerRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDailyDecayRate"`
 */
export const useSimulateFeaturedQueueManagerSetDailyDecayRate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDailyDecayRate',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDailyRate"`
 */
export const useSimulateFeaturedQueueManagerSetDailyRate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDailyRate',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDurationBounds"`
 */
export const useSimulateFeaturedQueueManagerSetDurationBounds =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDurationBounds',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useSimulateFeaturedQueueManagerSetMasterRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setMaxFeaturedSize"`
 */
export const useSimulateFeaturedQueueManagerSetMaxFeaturedSize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setMaxFeaturedSize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateFeaturedQueueManagerSetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setWeth"`
 */
export const useSimulateFeaturedQueueManagerSetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateFeaturedQueueManagerTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateFeaturedQueueManagerUpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__
 */
export const useWatchFeaturedQueueManagerEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: featuredQueueManagerAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"DurationRenewed"`
 */
export const useWatchFeaturedQueueManagerDurationRenewedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'DurationRenewed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"ETHTransferFallbackToWETH"`
 */
export const useWatchFeaturedQueueManagerEthTransferFallbackToWethEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'ETHTransferFallbackToWETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"FeaturedRented"`
 */
export const useWatchFeaturedQueueManagerFeaturedRentedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'FeaturedRented',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"MasterRegistrySet"`
 */
export const useWatchFeaturedQueueManagerMasterRegistrySetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'MasterRegistrySet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchFeaturedQueueManagerOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchFeaturedQueueManagerOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchFeaturedQueueManagerOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchFeaturedQueueManagerProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"RankBoosted"`
 */
export const useWatchFeaturedQueueManagerRankBoostedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'RankBoosted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchFeaturedQueueManagerUpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__
 */
export const useReadGlobalMessageRegistry = /*#__PURE__*/ createUseReadContract(
  { abi: globalMessageRegistryAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadGlobalMessageRegistryMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"messageCount"`
 */
export const useReadGlobalMessageRegistryMessageCount =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'messageCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadGlobalMessageRegistryOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadGlobalMessageRegistryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postThreshold"`
 */
export const useReadGlobalMessageRegistryPostThreshold =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postThreshold',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadGlobalMessageRegistryProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__
 */
export const useWriteGlobalMessageRegistry =
  /*#__PURE__*/ createUseWriteContract({ abi: globalMessageRegistryAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteGlobalMessageRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteGlobalMessageRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteGlobalMessageRegistryInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"post"`
 */
export const useWriteGlobalMessageRegistryPost =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'post',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postBatch"`
 */
export const useWriteGlobalMessageRegistryPostBatch =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postBatch',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postForAction"`
 */
export const useWriteGlobalMessageRegistryPostForAction =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postForAction',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteGlobalMessageRegistryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteGlobalMessageRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useWriteGlobalMessageRegistrySetMasterRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"setPostThreshold"`
 */
export const useWriteGlobalMessageRegistrySetPostThreshold =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'setPostThreshold',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteGlobalMessageRegistryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteGlobalMessageRegistryUpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"withdrawETH"`
 */
export const useWriteGlobalMessageRegistryWithdrawEth =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'withdrawETH',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__
 */
export const useSimulateGlobalMessageRegistry =
  /*#__PURE__*/ createUseSimulateContract({ abi: globalMessageRegistryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateGlobalMessageRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateGlobalMessageRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateGlobalMessageRegistryInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"post"`
 */
export const useSimulateGlobalMessageRegistryPost =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'post',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postBatch"`
 */
export const useSimulateGlobalMessageRegistryPostBatch =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postBatch',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postForAction"`
 */
export const useSimulateGlobalMessageRegistryPostForAction =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postForAction',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateGlobalMessageRegistryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateGlobalMessageRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useSimulateGlobalMessageRegistrySetMasterRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"setPostThreshold"`
 */
export const useSimulateGlobalMessageRegistrySetPostThreshold =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'setPostThreshold',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateGlobalMessageRegistryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateGlobalMessageRegistryUpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"withdrawETH"`
 */
export const useSimulateGlobalMessageRegistryWithdrawEth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'withdrawETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__
 */
export const useWatchGlobalMessageRegistryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: globalMessageRegistryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"ETHWithdrawn"`
 */
export const useWatchGlobalMessageRegistryEthWithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'ETHWithdrawn',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"MasterRegistrySet"`
 */
export const useWatchGlobalMessageRegistryMasterRegistrySetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'MasterRegistrySet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"MessagePosted"`
 */
export const useWatchGlobalMessageRegistryMessagePostedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'MessagePosted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchGlobalMessageRegistryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchGlobalMessageRegistryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchGlobalMessageRegistryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"PostThresholdSet"`
 */
export const useWatchGlobalMessageRegistryPostThresholdSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'PostThresholdSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchGlobalMessageRegistryUpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iAlignmentRegistryDupAbi}__
 */
export const useReadIAlignmentRegistryDup = /*#__PURE__*/ createUseReadContract(
  { abi: iAlignmentRegistryDupAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iAlignmentRegistryDupAbi}__ and `functionName` set to `"isAlignmentTargetActive"`
 */
export const useReadIAlignmentRegistryDupIsAlignmentTargetActive =
  /*#__PURE__*/ createUseReadContract({
    abi: iAlignmentRegistryDupAbi,
    functionName: 'isAlignmentTargetActive',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iAlignmentRegistryDupAbi}__ and `functionName` set to `"tokenToTargetIds"`
 */
export const useReadIAlignmentRegistryDupTokenToTargetIds =
  /*#__PURE__*/ createUseReadContract({
    abi: iAlignmentRegistryDupAbi,
    functionName: 'tokenToTargetIds',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iCarveParamsSourceAbi}__
 */
export const useReadICarveParamsSource = /*#__PURE__*/ createUseReadContract({
  abi: iCarveParamsSourceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iCarveParamsSourceAbi}__ and `functionName` set to `"effectiveCarveEth"`
 */
export const useReadICarveParamsSourceEffectiveCarveEth =
  /*#__PURE__*/ createUseReadContract({
    abi: iCarveParamsSourceAbi,
    functionName: 'effectiveCarveEth',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iDeployBondEscrowAbi}__
 */
export const useReadIDeployBondEscrow = /*#__PURE__*/ createUseReadContract({
  abi: iDeployBondEscrowAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iDeployBondEscrowAbi}__ and `functionName` set to `"bondAmount"`
 */
export const useReadIDeployBondEscrowBondAmount =
  /*#__PURE__*/ createUseReadContract({
    abi: iDeployBondEscrowAbi,
    functionName: 'bondAmount',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iDeployBondEscrowAbi}__
 */
export const useWriteIDeployBondEscrow = /*#__PURE__*/ createUseWriteContract({
  abi: iDeployBondEscrowAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iDeployBondEscrowAbi}__ and `functionName` set to `"postBond"`
 */
export const useWriteIDeployBondEscrowPostBond =
  /*#__PURE__*/ createUseWriteContract({
    abi: iDeployBondEscrowAbi,
    functionName: 'postBond',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iDeployBondEscrowAbi}__
 */
export const useSimulateIDeployBondEscrow =
  /*#__PURE__*/ createUseSimulateContract({ abi: iDeployBondEscrowAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iDeployBondEscrowAbi}__ and `functionName` set to `"postBond"`
 */
export const useSimulateIDeployBondEscrowPostBond =
  /*#__PURE__*/ createUseSimulateContract({
    abi: iDeployBondEscrowAbi,
    functionName: 'postBond',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155BalanceAbi}__
 */
export const useReadIerc1155Balance = /*#__PURE__*/ createUseReadContract({
  abi: ierc1155BalanceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155BalanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadIerc1155BalanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155BalanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155BalanceAbi}__ and `functionName` set to `"getAllEditionIds"`
 */
export const useReadIerc1155BalanceGetAllEditionIds =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155BalanceAbi,
    functionName: 'getAllEditionIds',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155BalanceAbi}__ and `functionName` set to `"getEditionCount"`
 */
export const useReadIerc1155BalanceGetEditionCount =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155BalanceAbi,
    functionName: 'getEditionCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155EditionReaderAbi}__
 */
export const useReadIerc1155EditionReader = /*#__PURE__*/ createUseReadContract(
  { abi: ierc1155EditionReaderAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155EditionReaderAbi}__ and `functionName` set to `"getCurrentPrice"`
 */
export const useReadIerc1155EditionReaderGetCurrentPrice =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155EditionReaderAbi,
    functionName: 'getCurrentPrice',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155EditionReaderAbi}__ and `functionName` set to `"getEdition"`
 */
export const useReadIerc1155EditionReaderGetEdition =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155EditionReaderAbi,
    functionName: 'getEdition',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155EditionReaderAbi}__ and `functionName` set to `"nextEditionId"`
 */
export const useReadIerc1155EditionReaderNextEditionId =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155EditionReaderAbi,
    functionName: 'nextEditionId',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__
 */
export const useWriteIerc1155Receiver = /*#__PURE__*/ createUseWriteContract({
  abi: ierc1155ReceiverAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155BatchReceived"`
 */
export const useWriteIerc1155ReceiverOnErc1155BatchReceived =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155BatchReceived',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155Received"`
 */
export const useWriteIerc1155ReceiverOnErc1155Received =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155Received',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__
 */
export const useSimulateIerc1155Receiver =
  /*#__PURE__*/ createUseSimulateContract({ abi: ierc1155ReceiverAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155BatchReceived"`
 */
export const useSimulateIerc1155ReceiverOnErc1155BatchReceived =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155BatchReceived',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155Received"`
 */
export const useSimulateIerc1155ReceiverOnErc1155Received =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155Received',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404BalanceAbi}__
 */
export const useReadIerc404Balance = /*#__PURE__*/ createUseReadContract({
  abi: ierc404BalanceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404BalanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadIerc404BalanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc404BalanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404StakingAbi}__
 */
export const useReadIerc404Staking = /*#__PURE__*/ createUseReadContract({
  abi: ierc404StakingAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404StakingAbi}__ and `functionName` set to `"calculatePendingRewards"`
 */
export const useReadIerc404StakingCalculatePendingRewards =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc404StakingAbi,
    functionName: 'calculatePendingRewards',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404StakingAbi}__ and `functionName` set to `"stakedBalance"`
 */
export const useReadIerc404StakingStakedBalance =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc404StakingAbi,
    functionName: 'stakedBalance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404StakingAbi}__ and `functionName` set to `"stakingEnabled"`
 */
export const useReadIerc404StakingStakingEnabled =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc404StakingAbi,
    functionName: 'stakingEnabled',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iFeaturedQueueManagerAbi}__
 */
export const useReadIFeaturedQueueManager = /*#__PURE__*/ createUseReadContract(
  { abi: iFeaturedQueueManagerAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iFeaturedQueueManagerAbi}__ and `functionName` set to `"getFeaturedInstances"`
 */
export const useReadIFeaturedQueueManagerGetFeaturedInstances =
  /*#__PURE__*/ createUseReadContract({
    abi: iFeaturedQueueManagerAbi,
    functionName: 'getFeaturedInstances',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iFeaturedQueueManagerAbi}__ and `functionName` set to `"getRentalInfo"`
 */
export const useReadIFeaturedQueueManagerGetRentalInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: iFeaturedQueueManagerAbi,
    functionName: 'getRentalInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iGlobalMessageRegistryAbi}__
 */
export const useReadIGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({ abi: iGlobalMessageRegistryAbi })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iGlobalMessageRegistryAbi}__ and `functionName` set to `"messageCount"`
 */
export const useReadIGlobalMessageRegistryMessageCount =
  /*#__PURE__*/ createUseReadContract({
    abi: iGlobalMessageRegistryAbi,
    functionName: 'messageCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iMasterRegistryMinAbi}__
 */
export const useReadIMasterRegistryMin = /*#__PURE__*/ createUseReadContract({
  abi: iMasterRegistryMinAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iMasterRegistryMinAbi}__ and `functionName` set to `"isRegisteredInstance"`
 */
export const useReadIMasterRegistryMinIsRegisteredInstance =
  /*#__PURE__*/ createUseReadContract({
    abi: iMasterRegistryMinAbi,
    functionName: 'isRegisteredInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iMerkleGatingModuleAbi}__
 */
export const useWriteIMerkleGatingModule = /*#__PURE__*/ createUseWriteContract(
  { abi: iMerkleGatingModuleAbi },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iMerkleGatingModuleAbi}__ and `functionName` set to `"configureFor"`
 */
export const useWriteIMerkleGatingModuleConfigureFor =
  /*#__PURE__*/ createUseWriteContract({
    abi: iMerkleGatingModuleAbi,
    functionName: 'configureFor',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iMerkleGatingModuleAbi}__
 */
export const useSimulateIMerkleGatingModule =
  /*#__PURE__*/ createUseSimulateContract({ abi: iMerkleGatingModuleAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iMerkleGatingModuleAbi}__ and `functionName` set to `"configureFor"`
 */
export const useSimulateIMerkleGatingModuleConfigureFor =
  /*#__PURE__*/ createUseSimulateContract({
    abi: iMerkleGatingModuleAbi,
    functionName: 'configureFor',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOverlayInstanceAbi}__
 */
export const useReadIOverlayInstance = /*#__PURE__*/ createUseReadContract({
  abi: iOverlayInstanceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOverlayInstanceAbi}__ and `functionName` set to `"owner"`
 */
export const useReadIOverlayInstanceOwner = /*#__PURE__*/ createUseReadContract(
  { abi: iOverlayInstanceAbi, functionName: 'owner' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOverlayInstanceAbi}__ and `functionName` set to `"ownerOf"`
 */
export const useReadIOverlayInstanceOwnerOf =
  /*#__PURE__*/ createUseReadContract({
    abi: iOverlayInstanceAbi,
    functionName: 'ownerOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOverlayInstanceAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadIOverlayInstanceProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: iOverlayInstanceAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOverlayInstanceAbi}__ and `functionName` set to `"stakingModule"`
 */
export const useReadIOverlayInstanceStakingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: iOverlayInstanceAbi,
    functionName: 'stakingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOverlayInstanceAbi}__ and `functionName` set to `"vault"`
 */
export const useReadIOverlayInstanceVault = /*#__PURE__*/ createUseReadContract(
  { abi: iOverlayInstanceAbi, functionName: 'vault' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOverlayStakedReaderAbi}__
 */
export const useReadIOverlayStakedReader = /*#__PURE__*/ createUseReadContract({
  abi: iOverlayStakedReaderAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOverlayStakedReaderAbi}__ and `functionName` set to `"stakedBalance"`
 */
export const useReadIOverlayStakedReaderStakedBalance =
  /*#__PURE__*/ createUseReadContract({
    abi: iOverlayStakedReaderAbi,
    functionName: 'stakedBalance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOwnableAbi}__
 */
export const useReadIOwnable = /*#__PURE__*/ createUseReadContract({
  abi: iOwnableAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iOwnableAbi}__ and `functionName` set to `"owner"`
 */
export const useReadIOwnableOwner = /*#__PURE__*/ createUseReadContract({
  abi: iOwnableAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iStakedBalanceReaderAbi}__
 */
export const useReadIStakedBalanceReader = /*#__PURE__*/ createUseReadContract({
  abi: iStakedBalanceReaderAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iStakedBalanceReaderAbi}__ and `functionName` set to `"stakedBalance"`
 */
export const useReadIStakedBalanceReaderStakedBalance =
  /*#__PURE__*/ createUseReadContract({
    abi: iStakedBalanceReaderAbi,
    functionName: 'stakedBalance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iStataTokenAbi}__
 */
export const useReadIStataToken = /*#__PURE__*/ createUseReadContract({
  abi: iStataTokenAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iStataTokenAbi}__ and `functionName` set to `"asset"`
 */
export const useReadIStataTokenAsset = /*#__PURE__*/ createUseReadContract({
  abi: iStataTokenAbi,
  functionName: 'asset',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iStataTokenAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadIStataTokenBalanceOf = /*#__PURE__*/ createUseReadContract({
  abi: iStataTokenAbi,
  functionName: 'balanceOf',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iStataTokenAbi}__ and `functionName` set to `"convertToAssets"`
 */
export const useReadIStataTokenConvertToAssets =
  /*#__PURE__*/ createUseReadContract({
    abi: iStataTokenAbi,
    functionName: 'convertToAssets',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iStataTokenAbi}__ and `functionName` set to `"maxWithdraw"`
 */
export const useReadIStataTokenMaxWithdraw =
  /*#__PURE__*/ createUseReadContract({
    abi: iStataTokenAbi,
    functionName: 'maxWithdraw',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iStataTokenAbi}__
 */
export const useWriteIStataToken = /*#__PURE__*/ createUseWriteContract({
  abi: iStataTokenAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iStataTokenAbi}__ and `functionName` set to `"deposit"`
 */
export const useWriteIStataTokenDeposit = /*#__PURE__*/ createUseWriteContract({
  abi: iStataTokenAbi,
  functionName: 'deposit',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iStataTokenAbi}__ and `functionName` set to `"withdraw"`
 */
export const useWriteIStataTokenWithdraw = /*#__PURE__*/ createUseWriteContract(
  { abi: iStataTokenAbi, functionName: 'withdraw' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iStataTokenAbi}__
 */
export const useSimulateIStataToken = /*#__PURE__*/ createUseSimulateContract({
  abi: iStataTokenAbi,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iStataTokenAbi}__ and `functionName` set to `"deposit"`
 */
export const useSimulateIStataTokenDeposit =
  /*#__PURE__*/ createUseSimulateContract({
    abi: iStataTokenAbi,
    functionName: 'deposit',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iStataTokenAbi}__ and `functionName` set to `"withdraw"`
 */
export const useSimulateIStataTokenWithdraw =
  /*#__PURE__*/ createUseSimulateContract({
    abi: iStataTokenAbi,
    functionName: 'withdraw',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iTierInstanceAbi}__
 */
export const useReadITierInstance = /*#__PURE__*/ createUseReadContract({
  abi: iTierInstanceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iTierInstanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadITierInstanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: iTierInstanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iTierInstanceAbi}__ and `functionName` set to `"stakingModule"`
 */
export const useReadITierInstanceStakingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: iTierInstanceAbi,
    functionName: 'stakingModule',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iwethAbi}__
 */
export const useWriteIweth = /*#__PURE__*/ createUseWriteContract({
  abi: iwethAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iwethAbi}__ and `functionName` set to `"approve"`
 */
export const useWriteIwethApprove = /*#__PURE__*/ createUseWriteContract({
  abi: iwethAbi,
  functionName: 'approve',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iwethAbi}__ and `functionName` set to `"deposit"`
 */
export const useWriteIwethDeposit = /*#__PURE__*/ createUseWriteContract({
  abi: iwethAbi,
  functionName: 'deposit',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link iwethAbi}__ and `functionName` set to `"withdraw"`
 */
export const useWriteIwethWithdraw = /*#__PURE__*/ createUseWriteContract({
  abi: iwethAbi,
  functionName: 'withdraw',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iwethAbi}__
 */
export const useSimulateIweth = /*#__PURE__*/ createUseSimulateContract({
  abi: iwethAbi,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iwethAbi}__ and `functionName` set to `"approve"`
 */
export const useSimulateIwethApprove = /*#__PURE__*/ createUseSimulateContract({
  abi: iwethAbi,
  functionName: 'approve',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iwethAbi}__ and `functionName` set to `"deposit"`
 */
export const useSimulateIwethDeposit = /*#__PURE__*/ createUseSimulateContract({
  abi: iwethAbi,
  functionName: 'deposit',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link iwethAbi}__ and `functionName` set to `"withdraw"`
 */
export const useSimulateIwethWithdraw = /*#__PURE__*/ createUseSimulateContract(
  { abi: iwethAbi, functionName: 'withdraw' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__
 */
export const useReadLiquidityDeployerModule =
  /*#__PURE__*/ createUseReadContract({ abi: liquidityDeployerModuleAbi })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"MAX_INIT_PRICE_DEVIATION_BPS"`
 */
export const useReadLiquidityDeployerModuleMaxInitPriceDeviationBps =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'MAX_INIT_PRICE_DEVIATION_BPS',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadLiquidityDeployerModuleMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadLiquidityDeployerModuleMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"owner"`
 */
export const useReadLiquidityDeployerModuleOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadLiquidityDeployerModuleOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"poolFee"`
 */
export const useReadLiquidityDeployerModulePoolFee =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'poolFee',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"tickSpacing"`
 */
export const useReadLiquidityDeployerModuleTickSpacing =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'tickSpacing',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"v4PoolManager"`
 */
export const useReadLiquidityDeployerModuleV4PoolManager =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'v4PoolManager',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"weth"`
 */
export const useReadLiquidityDeployerModuleWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__
 */
export const useWriteLiquidityDeployerModule =
  /*#__PURE__*/ createUseWriteContract({ abi: liquidityDeployerModuleAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteLiquidityDeployerModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteLiquidityDeployerModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"deployLiquidity"`
 */
export const useWriteLiquidityDeployerModuleDeployLiquidity =
  /*#__PURE__*/ createUseWriteContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'deployLiquidity',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteLiquidityDeployerModuleRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteLiquidityDeployerModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWriteLiquidityDeployerModuleSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteLiquidityDeployerModuleTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"unlockCallback"`
 */
export const useWriteLiquidityDeployerModuleUnlockCallback =
  /*#__PURE__*/ createUseWriteContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'unlockCallback',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__
 */
export const useSimulateLiquidityDeployerModule =
  /*#__PURE__*/ createUseSimulateContract({ abi: liquidityDeployerModuleAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateLiquidityDeployerModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateLiquidityDeployerModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"deployLiquidity"`
 */
export const useSimulateLiquidityDeployerModuleDeployLiquidity =
  /*#__PURE__*/ createUseSimulateContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'deployLiquidity',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateLiquidityDeployerModuleRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateLiquidityDeployerModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulateLiquidityDeployerModuleSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateLiquidityDeployerModuleTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `functionName` set to `"unlockCallback"`
 */
export const useSimulateLiquidityDeployerModuleUnlockCallback =
  /*#__PURE__*/ createUseSimulateContract({
    abi: liquidityDeployerModuleAbi,
    functionName: 'unlockCallback',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__
 */
export const useWatchLiquidityDeployerModuleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: liquidityDeployerModuleAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `eventName` set to `"CreatorCarvePaid"`
 */
export const useWatchLiquidityDeployerModuleCreatorCarvePaidEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: liquidityDeployerModuleAbi,
    eventName: 'CreatorCarvePaid',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `eventName` set to `"GraduationFeePaid"`
 */
export const useWatchLiquidityDeployerModuleGraduationFeePaidEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: liquidityDeployerModuleAbi,
    eventName: 'GraduationFeePaid',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `eventName` set to `"GraduationVaultContribution"`
 */
export const useWatchLiquidityDeployerModuleGraduationVaultContributionEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: liquidityDeployerModuleAbi,
    eventName: 'GraduationVaultContribution',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `eventName` set to `"LiquidityDeployed"`
 */
export const useWatchLiquidityDeployerModuleLiquidityDeployedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: liquidityDeployerModuleAbi,
    eventName: 'LiquidityDeployed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `eventName` set to `"MetadataURIUpdated"`
 */
export const useWatchLiquidityDeployerModuleMetadataUriUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: liquidityDeployerModuleAbi,
    eventName: 'MetadataURIUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchLiquidityDeployerModuleOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: liquidityDeployerModuleAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchLiquidityDeployerModuleOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: liquidityDeployerModuleAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link liquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchLiquidityDeployerModuleOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: liquidityDeployerModuleAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__
 */
export const useReadMasterRegistryV1 = /*#__PURE__*/ createUseReadContract({
  abi: masterRegistryV1Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"alignmentRegistry"`
 */
export const useReadMasterRegistryV1AlignmentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'alignmentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"componentRegistry"`
 */
export const useReadMasterRegistryV1ComponentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'componentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"emergencyRevoker"`
 */
export const useReadMasterRegistryV1EmergencyRevoker =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'emergencyRevoker',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"factoryIdToAddress"`
 */
export const useReadMasterRegistryV1FactoryIdToAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'factoryIdToAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"factoryInfo"`
 */
export const useReadMasterRegistryV1FactoryInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'factoryInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getActiveVault"`
 */
export const useReadMasterRegistryV1GetActiveVault =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getActiveVault',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getFactoryInfo"`
 */
export const useReadMasterRegistryV1GetFactoryInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getFactoryInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getFactoryInfoByAddress"`
 */
export const useReadMasterRegistryV1GetFactoryInfoByAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getFactoryInfoByAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getInstanceInfo"`
 */
export const useReadMasterRegistryV1GetInstanceInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getInstanceInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getInstanceVaults"`
 */
export const useReadMasterRegistryV1GetInstanceVaults =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getInstanceVaults',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getTotalFactories"`
 */
export const useReadMasterRegistryV1GetTotalFactories =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getTotalFactories',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getVaultInfo"`
 */
export const useReadMasterRegistryV1GetVaultInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getVaultInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"instanceInfo"`
 */
export const useReadMasterRegistryV1InstanceInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'instanceInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isAgent"`
 */
export const useReadMasterRegistryV1IsAgent =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isAgent',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isFactoryRegistered"`
 */
export const useReadMasterRegistryV1IsFactoryRegistered =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isFactoryRegistered',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isInstanceFromApprovedFactory"`
 */
export const useReadMasterRegistryV1IsInstanceFromApprovedFactory =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isInstanceFromApprovedFactory',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isNameTaken"`
 */
export const useReadMasterRegistryV1IsNameTaken =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isNameTaken',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isRegisteredInstance"`
 */
export const useReadMasterRegistryV1IsRegisteredInstance =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isRegisteredInstance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isVaultRegistered"`
 */
export const useReadMasterRegistryV1IsVaultRegistered =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isVaultRegistered',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"nameHashes"`
 */
export const useReadMasterRegistryV1NameHashes =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'nameHashes',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"nextFactoryId"`
 */
export const useReadMasterRegistryV1NextFactoryId =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'nextFactoryId',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"owner"`
 */
export const useReadMasterRegistryV1Owner = /*#__PURE__*/ createUseReadContract(
  { abi: masterRegistryV1Abi, functionName: 'owner' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadMasterRegistryV1OwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadMasterRegistryV1ProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registeredFactories"`
 */
export const useReadMasterRegistryV1RegisteredFactories =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'registeredFactories',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registeredVaults"`
 */
export const useReadMasterRegistryV1RegisteredVaults =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'registeredVaults',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokedInstances"`
 */
export const useReadMasterRegistryV1RevokedInstances =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokedInstances',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"vaultInfo"`
 */
export const useReadMasterRegistryV1VaultInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'vaultInfo',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__
 */
export const useWriteMasterRegistryV1 = /*#__PURE__*/ createUseWriteContract({
  abi: masterRegistryV1Abi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteMasterRegistryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteMasterRegistryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"deactivateFactory"`
 */
export const useWriteMasterRegistryV1DeactivateFactory =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'deactivateFactory',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"deactivateVault"`
 */
export const useWriteMasterRegistryV1DeactivateVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'deactivateVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useWriteMasterRegistryV1Initialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"migrateVault"`
 */
export const useWriteMasterRegistryV1MigrateVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerFactory"`
 */
export const useWriteMasterRegistryV1RegisterFactory =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerFactory',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerInstance"`
 */
export const useWriteMasterRegistryV1RegisterInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerVault"`
 */
export const useWriteMasterRegistryV1RegisterVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteMasterRegistryV1RenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteMasterRegistryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokeAgent"`
 */
export const useWriteMasterRegistryV1RevokeAgent =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokeAgent',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokeInstance"`
 */
export const useWriteMasterRegistryV1RevokeInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokeInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setAgent"`
 */
export const useWriteMasterRegistryV1SetAgent =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'setAgent',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setAlignmentRegistry"`
 */
export const useWriteMasterRegistryV1SetAlignmentRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'setAlignmentRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setComponentRegistry"`
 */
export const useWriteMasterRegistryV1SetComponentRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'setComponentRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setEmergencyRevoker"`
 */
export const useWriteMasterRegistryV1SetEmergencyRevoker =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'setEmergencyRevoker',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteMasterRegistryV1TransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"updateInstanceMetadata"`
 */
export const useWriteMasterRegistryV1UpdateInstanceMetadata =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'updateInstanceMetadata',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteMasterRegistryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__
 */
export const useSimulateMasterRegistryV1 =
  /*#__PURE__*/ createUseSimulateContract({ abi: masterRegistryV1Abi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateMasterRegistryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateMasterRegistryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"deactivateFactory"`
 */
export const useSimulateMasterRegistryV1DeactivateFactory =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'deactivateFactory',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"deactivateVault"`
 */
export const useSimulateMasterRegistryV1DeactivateVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'deactivateVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateMasterRegistryV1Initialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"migrateVault"`
 */
export const useSimulateMasterRegistryV1MigrateVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerFactory"`
 */
export const useSimulateMasterRegistryV1RegisterFactory =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerFactory',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerInstance"`
 */
export const useSimulateMasterRegistryV1RegisterInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerVault"`
 */
export const useSimulateMasterRegistryV1RegisterVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateMasterRegistryV1RenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateMasterRegistryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokeAgent"`
 */
export const useSimulateMasterRegistryV1RevokeAgent =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokeAgent',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokeInstance"`
 */
export const useSimulateMasterRegistryV1RevokeInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokeInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setAgent"`
 */
export const useSimulateMasterRegistryV1SetAgent =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'setAgent',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setAlignmentRegistry"`
 */
export const useSimulateMasterRegistryV1SetAlignmentRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'setAlignmentRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setComponentRegistry"`
 */
export const useSimulateMasterRegistryV1SetComponentRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'setComponentRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setEmergencyRevoker"`
 */
export const useSimulateMasterRegistryV1SetEmergencyRevoker =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'setEmergencyRevoker',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateMasterRegistryV1TransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"updateInstanceMetadata"`
 */
export const useSimulateMasterRegistryV1UpdateInstanceMetadata =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'updateInstanceMetadata',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateMasterRegistryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__
 */
export const useWatchMasterRegistryV1Event =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: masterRegistryV1Abi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"AgentUpdated"`
 */
export const useWatchMasterRegistryV1AgentUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'AgentUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"AlignmentRegistrySet"`
 */
export const useWatchMasterRegistryV1AlignmentRegistrySetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'AlignmentRegistrySet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"ComponentRegistrySet"`
 */
export const useWatchMasterRegistryV1ComponentRegistrySetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'ComponentRegistrySet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"CreatorInstanceAdded"`
 */
export const useWatchMasterRegistryV1CreatorInstanceAddedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'CreatorInstanceAdded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"EmergencyRevokerSet"`
 */
export const useWatchMasterRegistryV1EmergencyRevokerSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'EmergencyRevokerSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"FactoryDeactivated"`
 */
export const useWatchMasterRegistryV1FactoryDeactivatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'FactoryDeactivated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"FactoryRegistered"`
 */
export const useWatchMasterRegistryV1FactoryRegisteredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'FactoryRegistered',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"InstanceMetadataUpdated"`
 */
export const useWatchMasterRegistryV1InstanceMetadataUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'InstanceMetadataUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"InstanceRegistered"`
 */
export const useWatchMasterRegistryV1InstanceRegisteredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'InstanceRegistered',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"InstanceRevoked"`
 */
export const useWatchMasterRegistryV1InstanceRevokedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'InstanceRevoked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"InstanceVaultMigrated"`
 */
export const useWatchMasterRegistryV1InstanceVaultMigratedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'InstanceVaultMigrated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchMasterRegistryV1OwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchMasterRegistryV1OwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchMasterRegistryV1OwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchMasterRegistryV1UpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"VaultDeactivated"`
 */
export const useWatchMasterRegistryV1VaultDeactivatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'VaultDeactivated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"VaultRegistered"`
 */
export const useWatchMasterRegistryV1VaultRegisteredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'VaultRegistered',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__
 */
export const useReadMerkleGatingModule = /*#__PURE__*/ createUseReadContract({
  abi: merkleGatingModuleAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"claimed"`
 */
export const useReadMerkleGatingModuleClaimed =
  /*#__PURE__*/ createUseReadContract({
    abi: merkleGatingModuleAbi,
    functionName: 'claimed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"configured"`
 */
export const useReadMerkleGatingModuleConfigured =
  /*#__PURE__*/ createUseReadContract({
    abi: merkleGatingModuleAbi,
    functionName: 'configured',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"getRoots"`
 */
export const useReadMerkleGatingModuleGetRoots =
  /*#__PURE__*/ createUseReadContract({
    abi: merkleGatingModuleAbi,
    functionName: 'getRoots',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"getTierOpenTimes"`
 */
export const useReadMerkleGatingModuleGetTierOpenTimes =
  /*#__PURE__*/ createUseReadContract({
    abi: merkleGatingModuleAbi,
    functionName: 'getTierOpenTimes',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadMerkleGatingModuleMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: merkleGatingModuleAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadMerkleGatingModuleMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: merkleGatingModuleAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"owner"`
 */
export const useReadMerkleGatingModuleOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: merkleGatingModuleAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadMerkleGatingModuleOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: merkleGatingModuleAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__
 */
export const useWriteMerkleGatingModule = /*#__PURE__*/ createUseWriteContract({
  abi: merkleGatingModuleAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"canMint"`
 */
export const useWriteMerkleGatingModuleCanMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'canMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteMerkleGatingModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteMerkleGatingModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"configureFor"`
 */
export const useWriteMerkleGatingModuleConfigureFor =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'configureFor',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"onMint"`
 */
export const useWriteMerkleGatingModuleOnMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'onMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteMerkleGatingModuleRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteMerkleGatingModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWriteMerkleGatingModuleSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteMerkleGatingModuleTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: merkleGatingModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__
 */
export const useSimulateMerkleGatingModule =
  /*#__PURE__*/ createUseSimulateContract({ abi: merkleGatingModuleAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"canMint"`
 */
export const useSimulateMerkleGatingModuleCanMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'canMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateMerkleGatingModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateMerkleGatingModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"configureFor"`
 */
export const useSimulateMerkleGatingModuleConfigureFor =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'configureFor',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"onMint"`
 */
export const useSimulateMerkleGatingModuleOnMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'onMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateMerkleGatingModuleRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateMerkleGatingModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulateMerkleGatingModuleSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateMerkleGatingModuleTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: merkleGatingModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link merkleGatingModuleAbi}__
 */
export const useWatchMerkleGatingModuleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: merkleGatingModuleAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `eventName` set to `"MetadataURIUpdated"`
 */
export const useWatchMerkleGatingModuleMetadataUriUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: merkleGatingModuleAbi,
    eventName: 'MetadataURIUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchMerkleGatingModuleOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: merkleGatingModuleAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchMerkleGatingModuleOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: merkleGatingModuleAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link merkleGatingModuleAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchMerkleGatingModuleOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: merkleGatingModuleAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__
 */
export const useReadMetadataOverlayModule = /*#__PURE__*/ createUseReadContract(
  { abi: metadataOverlayModuleAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"autoLatest"`
 */
export const useReadMetadataOverlayModuleAutoLatest =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'autoLatest',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"commissionTerms"`
 */
export const useReadMetadataOverlayModuleCommissionTerms =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'commissionTerms',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"commissionURI"`
 */
export const useReadMetadataOverlayModuleCommissionUri =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'commissionURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"commissionVisible"`
 */
export const useReadMetadataOverlayModuleCommissionVisible =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'commissionVisible',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"configured"`
 */
export const useReadMetadataOverlayModuleConfigured =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'configured',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"defaultPayout"`
 */
export const useReadMetadataOverlayModuleDefaultPayout =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'defaultPayout',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadMetadataOverlayModuleMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadMetadataOverlayModuleMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"owner"`
 */
export const useReadMetadataOverlayModuleOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadMetadataOverlayModuleOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"paid"`
 */
export const useReadMetadataOverlayModulePaid =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'paid',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"resolve"`
 */
export const useReadMetadataOverlayModuleResolve =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'resolve',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"selection"`
 */
export const useReadMetadataOverlayModuleSelection =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'selection',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"waveCount"`
 */
export const useReadMetadataOverlayModuleWaveCount =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'waveCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"waveEligible"`
 */
export const useReadMetadataOverlayModuleWaveEligible =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'waveEligible',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"wavePaid"`
 */
export const useReadMetadataOverlayModuleWavePaid =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'wavePaid',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"waves"`
 */
export const useReadMetadataOverlayModuleWaves =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'waves',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__
 */
export const useWriteMetadataOverlayModule =
  /*#__PURE__*/ createUseWriteContract({ abi: metadataOverlayModuleAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteMetadataOverlayModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteMetadataOverlayModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"initConfig"`
 */
export const useWriteMetadataOverlayModuleInitConfig =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'initConfig',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"publishWave"`
 */
export const useWriteMetadataOverlayModulePublishWave =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'publishWave',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteMetadataOverlayModuleRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteMetadataOverlayModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"select"`
 */
export const useWriteMetadataOverlayModuleSelect =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'select',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"setAutoLatest"`
 */
export const useWriteMetadataOverlayModuleSetAutoLatest =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'setAutoLatest',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"setCommission"`
 */
export const useWriteMetadataOverlayModuleSetCommission =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'setCommission',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWriteMetadataOverlayModuleSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteMetadataOverlayModuleTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"unlock"`
 */
export const useWriteMetadataOverlayModuleUnlock =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'unlock',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"unlockWave"`
 */
export const useWriteMetadataOverlayModuleUnlockWave =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'unlockWave',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__
 */
export const useSimulateMetadataOverlayModule =
  /*#__PURE__*/ createUseSimulateContract({ abi: metadataOverlayModuleAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateMetadataOverlayModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateMetadataOverlayModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"initConfig"`
 */
export const useSimulateMetadataOverlayModuleInitConfig =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'initConfig',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"publishWave"`
 */
export const useSimulateMetadataOverlayModulePublishWave =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'publishWave',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateMetadataOverlayModuleRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateMetadataOverlayModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"select"`
 */
export const useSimulateMetadataOverlayModuleSelect =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'select',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"setAutoLatest"`
 */
export const useSimulateMetadataOverlayModuleSetAutoLatest =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'setAutoLatest',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"setCommission"`
 */
export const useSimulateMetadataOverlayModuleSetCommission =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'setCommission',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulateMetadataOverlayModuleSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateMetadataOverlayModuleTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"unlock"`
 */
export const useSimulateMetadataOverlayModuleUnlock =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'unlock',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `functionName` set to `"unlockWave"`
 */
export const useSimulateMetadataOverlayModuleUnlockWave =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataOverlayModuleAbi,
    functionName: 'unlockWave',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__
 */
export const useWatchMetadataOverlayModuleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: metadataOverlayModuleAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"AutoLatestSet"`
 */
export const useWatchMetadataOverlayModuleAutoLatestSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'AutoLatestSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"CommissionSet"`
 */
export const useWatchMetadataOverlayModuleCommissionSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'CommissionSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"MetadataURIUpdated"`
 */
export const useWatchMetadataOverlayModuleMetadataUriUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'MetadataURIUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"OverlayConfigured"`
 */
export const useWatchMetadataOverlayModuleOverlayConfiguredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'OverlayConfigured',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchMetadataOverlayModuleOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchMetadataOverlayModuleOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchMetadataOverlayModuleOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"SelectionChanged"`
 */
export const useWatchMetadataOverlayModuleSelectionChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'SelectionChanged',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"Unlocked"`
 */
export const useWatchMetadataOverlayModuleUnlockedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'Unlocked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataOverlayModuleAbi}__ and `eventName` set to `"WavePublished"`
 */
export const useWatchMetadataOverlayModuleWavePublishedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataOverlayModuleAbi,
    eventName: 'WavePublished',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__
 */
export const useReadMetadataResolverRouter =
  /*#__PURE__*/ createUseReadContract({ abi: metadataResolverRouterAbi })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadMetadataResolverRouterMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataResolverRouterAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadMetadataResolverRouterMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataResolverRouterAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"owner"`
 */
export const useReadMetadataResolverRouterOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataResolverRouterAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadMetadataResolverRouterOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataResolverRouterAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"resolve"`
 */
export const useReadMetadataResolverRouterResolve =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataResolverRouterAbi,
    functionName: 'resolve',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"resolverCount"`
 */
export const useReadMetadataResolverRouterResolverCount =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataResolverRouterAbi,
    functionName: 'resolverCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"resolvers"`
 */
export const useReadMetadataResolverRouterResolvers =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataResolverRouterAbi,
    functionName: 'resolvers',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"sealed_"`
 */
export const useReadMetadataResolverRouterSealed =
  /*#__PURE__*/ createUseReadContract({
    abi: metadataResolverRouterAbi,
    functionName: 'sealed_',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__
 */
export const useWriteMetadataResolverRouter =
  /*#__PURE__*/ createUseWriteContract({ abi: metadataResolverRouterAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteMetadataResolverRouterCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataResolverRouterAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteMetadataResolverRouterCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataResolverRouterAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"initResolvers"`
 */
export const useWriteMetadataResolverRouterInitResolvers =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataResolverRouterAbi,
    functionName: 'initResolvers',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteMetadataResolverRouterRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataResolverRouterAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteMetadataResolverRouterRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataResolverRouterAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWriteMetadataResolverRouterSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataResolverRouterAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteMetadataResolverRouterTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: metadataResolverRouterAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__
 */
export const useSimulateMetadataResolverRouter =
  /*#__PURE__*/ createUseSimulateContract({ abi: metadataResolverRouterAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateMetadataResolverRouterCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataResolverRouterAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateMetadataResolverRouterCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataResolverRouterAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"initResolvers"`
 */
export const useSimulateMetadataResolverRouterInitResolvers =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataResolverRouterAbi,
    functionName: 'initResolvers',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateMetadataResolverRouterRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataResolverRouterAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateMetadataResolverRouterRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataResolverRouterAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulateMetadataResolverRouterSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataResolverRouterAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateMetadataResolverRouterTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: metadataResolverRouterAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataResolverRouterAbi}__
 */
export const useWatchMetadataResolverRouterEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: metadataResolverRouterAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `eventName` set to `"MetadataURIUpdated"`
 */
export const useWatchMetadataResolverRouterMetadataUriUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataResolverRouterAbi,
    eventName: 'MetadataURIUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchMetadataResolverRouterOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataResolverRouterAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchMetadataResolverRouterOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataResolverRouterAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchMetadataResolverRouterOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataResolverRouterAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link metadataResolverRouterAbi}__ and `eventName` set to `"ResolversSealed"`
 */
export const useWatchMetadataResolverRouterResolversSealedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: metadataResolverRouterAbi,
    eventName: 'ResolversSealed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__
 */
export const useReadPasswordTierGatingModule =
  /*#__PURE__*/ createUseReadContract({ abi: passwordTierGatingModuleAbi })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"configured"`
 */
export const useReadPasswordTierGatingModuleConfigured =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'configured',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"getConfig"`
 */
export const useReadPasswordTierGatingModuleGetConfig =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'getConfig',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadPasswordTierGatingModuleMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadPasswordTierGatingModuleMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"owner"`
 */
export const useReadPasswordTierGatingModuleOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadPasswordTierGatingModuleOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"tierByPasswordHash"`
 */
export const useReadPasswordTierGatingModuleTierByPasswordHash =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'tierByPasswordHash',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"userPurchaseVolume"`
 */
export const useReadPasswordTierGatingModuleUserPurchaseVolume =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'userPurchaseVolume',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"userTierUnlocked"`
 */
export const useReadPasswordTierGatingModuleUserTierUnlocked =
  /*#__PURE__*/ createUseReadContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'userTierUnlocked',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__
 */
export const useWritePasswordTierGatingModule =
  /*#__PURE__*/ createUseWriteContract({ abi: passwordTierGatingModuleAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"canMint"`
 */
export const useWritePasswordTierGatingModuleCanMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'canMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWritePasswordTierGatingModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWritePasswordTierGatingModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"configureFor"`
 */
export const useWritePasswordTierGatingModuleConfigureFor =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'configureFor',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"onMint"`
 */
export const useWritePasswordTierGatingModuleOnMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'onMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWritePasswordTierGatingModuleRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWritePasswordTierGatingModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWritePasswordTierGatingModuleSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWritePasswordTierGatingModuleTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__
 */
export const useSimulatePasswordTierGatingModule =
  /*#__PURE__*/ createUseSimulateContract({ abi: passwordTierGatingModuleAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"canMint"`
 */
export const useSimulatePasswordTierGatingModuleCanMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'canMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulatePasswordTierGatingModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulatePasswordTierGatingModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"configureFor"`
 */
export const useSimulatePasswordTierGatingModuleConfigureFor =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'configureFor',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"onMint"`
 */
export const useSimulatePasswordTierGatingModuleOnMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'onMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulatePasswordTierGatingModuleRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulatePasswordTierGatingModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulatePasswordTierGatingModuleSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulatePasswordTierGatingModuleTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: passwordTierGatingModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__
 */
export const useWatchPasswordTierGatingModuleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: passwordTierGatingModuleAbi,
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `eventName` set to `"MetadataURIUpdated"`
 */
export const useWatchPasswordTierGatingModuleMetadataUriUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: passwordTierGatingModuleAbi,
    eventName: 'MetadataURIUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchPasswordTierGatingModuleOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: passwordTierGatingModuleAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchPasswordTierGatingModuleOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: passwordTierGatingModuleAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link passwordTierGatingModuleAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchPasswordTierGatingModuleOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: passwordTierGatingModuleAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link profileRegistryAbi}__
 */
export const useReadProfileRegistry = /*#__PURE__*/ createUseReadContract({
  abi: profileRegistryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"profileURI"`
 */
export const useReadProfileRegistryProfileUri =
  /*#__PURE__*/ createUseReadContract({
    abi: profileRegistryAbi,
    functionName: 'profileURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link profileRegistryAbi}__
 */
export const useWriteProfileRegistry = /*#__PURE__*/ createUseWriteContract({
  abi: profileRegistryAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"clearProfile"`
 */
export const useWriteProfileRegistryClearProfile =
  /*#__PURE__*/ createUseWriteContract({
    abi: profileRegistryAbi,
    functionName: 'clearProfile',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"setProfile"`
 */
export const useWriteProfileRegistrySetProfile =
  /*#__PURE__*/ createUseWriteContract({
    abi: profileRegistryAbi,
    functionName: 'setProfile',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link profileRegistryAbi}__
 */
export const useSimulateProfileRegistry =
  /*#__PURE__*/ createUseSimulateContract({ abi: profileRegistryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"clearProfile"`
 */
export const useSimulateProfileRegistryClearProfile =
  /*#__PURE__*/ createUseSimulateContract({
    abi: profileRegistryAbi,
    functionName: 'clearProfile',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"setProfile"`
 */
export const useSimulateProfileRegistrySetProfile =
  /*#__PURE__*/ createUseSimulateContract({
    abi: profileRegistryAbi,
    functionName: 'setProfile',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link profileRegistryAbi}__
 */
export const useWatchProfileRegistryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: profileRegistryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link profileRegistryAbi}__ and `eventName` set to `"ProfileUpdated"`
 */
export const useWatchProfileRegistryProfileUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: profileRegistryAbi,
    eventName: 'ProfileUpdated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__
 */
export const useReadProtocolTreasuryV1 = /*#__PURE__*/ createUseReadContract({
  abi: protocolTreasuryV1Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"getBalance"`
 */
export const useReadProtocolTreasuryV1GetBalance =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'getBalance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"getPolPosition"`
 */
export const useReadProtocolTreasuryV1GetPolPosition =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'getPolPosition',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"getRevenueBySource"`
 */
export const useReadProtocolTreasuryV1GetRevenueBySource =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'getRevenueBySource',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadProtocolTreasuryV1MasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"onERC721Received"`
 */
export const useReadProtocolTreasuryV1OnErc721Received =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'onERC721Received',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"owner"`
 */
export const useReadProtocolTreasuryV1Owner =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadProtocolTreasuryV1OwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"polInstanceCount"`
 */
export const useReadProtocolTreasuryV1PolInstanceCount =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'polInstanceCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"polInstances"`
 */
export const useReadProtocolTreasuryV1PolInstances =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'polInstances',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadProtocolTreasuryV1ProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"revenueConductor"`
 */
export const useReadProtocolTreasuryV1RevenueConductor =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'revenueConductor',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"totalReceived"`
 */
export const useReadProtocolTreasuryV1TotalReceived =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'totalReceived',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"totalWithdrawn"`
 */
export const useReadProtocolTreasuryV1TotalWithdrawn =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'totalWithdrawn',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"v4PoolManager"`
 */
export const useReadProtocolTreasuryV1V4PoolManager =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'v4PoolManager',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"weth"`
 */
export const useReadProtocolTreasuryV1Weth =
  /*#__PURE__*/ createUseReadContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__
 */
export const useWriteProtocolTreasuryV1 = /*#__PURE__*/ createUseWriteContract({
  abi: protocolTreasuryV1Abi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteProtocolTreasuryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"claimPOLFees"`
 */
export const useWriteProtocolTreasuryV1ClaimPolFees =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'claimPOLFees',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteProtocolTreasuryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"deposit"`
 */
export const useWriteProtocolTreasuryV1Deposit =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'deposit',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useWriteProtocolTreasuryV1Initialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"receivePOL"`
 */
export const useWriteProtocolTreasuryV1ReceivePol =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'receivePOL',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteProtocolTreasuryV1RenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteProtocolTreasuryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"routeToDAO"`
 */
export const useWriteProtocolTreasuryV1RouteToDao =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'routeToDAO',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useWriteProtocolTreasuryV1SetMasterRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"setRevenueConductor"`
 */
export const useWriteProtocolTreasuryV1SetRevenueConductor =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'setRevenueConductor',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"setV4PoolManager"`
 */
export const useWriteProtocolTreasuryV1SetV4PoolManager =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'setV4PoolManager',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"setWETH"`
 */
export const useWriteProtocolTreasuryV1SetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'setWETH',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteProtocolTreasuryV1TransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"unlockCallback"`
 */
export const useWriteProtocolTreasuryV1UnlockCallback =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'unlockCallback',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteProtocolTreasuryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"withdrawERC20"`
 */
export const useWriteProtocolTreasuryV1WithdrawErc20 =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'withdrawERC20',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"withdrawERC721"`
 */
export const useWriteProtocolTreasuryV1WithdrawErc721 =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'withdrawERC721',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"withdrawETH"`
 */
export const useWriteProtocolTreasuryV1WithdrawEth =
  /*#__PURE__*/ createUseWriteContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'withdrawETH',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__
 */
export const useSimulateProtocolTreasuryV1 =
  /*#__PURE__*/ createUseSimulateContract({ abi: protocolTreasuryV1Abi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateProtocolTreasuryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"claimPOLFees"`
 */
export const useSimulateProtocolTreasuryV1ClaimPolFees =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'claimPOLFees',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateProtocolTreasuryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"deposit"`
 */
export const useSimulateProtocolTreasuryV1Deposit =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'deposit',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateProtocolTreasuryV1Initialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"receivePOL"`
 */
export const useSimulateProtocolTreasuryV1ReceivePol =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'receivePOL',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateProtocolTreasuryV1RenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateProtocolTreasuryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"routeToDAO"`
 */
export const useSimulateProtocolTreasuryV1RouteToDao =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'routeToDAO',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useSimulateProtocolTreasuryV1SetMasterRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"setRevenueConductor"`
 */
export const useSimulateProtocolTreasuryV1SetRevenueConductor =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'setRevenueConductor',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"setV4PoolManager"`
 */
export const useSimulateProtocolTreasuryV1SetV4PoolManager =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'setV4PoolManager',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"setWETH"`
 */
export const useSimulateProtocolTreasuryV1SetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'setWETH',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateProtocolTreasuryV1TransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"unlockCallback"`
 */
export const useSimulateProtocolTreasuryV1UnlockCallback =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'unlockCallback',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateProtocolTreasuryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"withdrawERC20"`
 */
export const useSimulateProtocolTreasuryV1WithdrawErc20 =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'withdrawERC20',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"withdrawERC721"`
 */
export const useSimulateProtocolTreasuryV1WithdrawErc721 =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'withdrawERC721',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `functionName` set to `"withdrawETH"`
 */
export const useSimulateProtocolTreasuryV1WithdrawEth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: protocolTreasuryV1Abi,
    functionName: 'withdrawETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__
 */
export const useWatchProtocolTreasuryV1Event =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: protocolTreasuryV1Abi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"ERC20Withdrawn"`
 */
export const useWatchProtocolTreasuryV1Erc20WithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'ERC20Withdrawn',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"ERC721Withdrawn"`
 */
export const useWatchProtocolTreasuryV1Erc721WithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'ERC721Withdrawn',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"ETHWithdrawn"`
 */
export const useWatchProtocolTreasuryV1EthWithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'ETHWithdrawn',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"MasterRegistryUpdated"`
 */
export const useWatchProtocolTreasuryV1MasterRegistryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'MasterRegistryUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchProtocolTreasuryV1OwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchProtocolTreasuryV1OwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchProtocolTreasuryV1OwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"POLFeesCollected"`
 */
export const useWatchProtocolTreasuryV1PolFeesCollectedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'POLFeesCollected',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"POLPositionDeployed"`
 */
export const useWatchProtocolTreasuryV1PolPositionDeployedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'POLPositionDeployed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"RevenueConductorUpdated"`
 */
export const useWatchProtocolTreasuryV1RevenueConductorUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'RevenueConductorUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"RevenueReceived"`
 */
export const useWatchProtocolTreasuryV1RevenueReceivedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'RevenueReceived',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"RevenueRouted"`
 */
export const useWatchProtocolTreasuryV1RevenueRoutedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'RevenueRouted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchProtocolTreasuryV1UpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"V4PoolManagerUpdated"`
 */
export const useWatchProtocolTreasuryV1V4PoolManagerUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'V4PoolManagerUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link protocolTreasuryV1Abi}__ and `eventName` set to `"WETHUpdated"`
 */
export const useWatchProtocolTreasuryV1WethUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: protocolTreasuryV1Abi,
    eventName: 'WETHUpdated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__
 */
export const useReadQueryAggregator = /*#__PURE__*/ createUseReadContract({
  abi: queryAggregatorAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"MAX_QUERY_LIMIT"`
 */
export const useReadQueryAggregatorMaxQueryLimit =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'MAX_QUERY_LIMIT',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"featuredQueueManager"`
 */
export const useReadQueryAggregatorFeaturedQueueManager =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'featuredQueueManager',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"getERC1155EditionsBatch"`
 */
export const useReadQueryAggregatorGetErc1155EditionsBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'getERC1155EditionsBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"getHomePageData"`
 */
export const useReadQueryAggregatorGetHomePageData =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'getHomePageData',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"getPortfolioData"`
 */
export const useReadQueryAggregatorGetPortfolioData =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'getPortfolioData',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"getProjectCardsBatch"`
 */
export const useReadQueryAggregatorGetProjectCardsBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'getProjectCardsBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadQueryAggregatorGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadQueryAggregatorMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"owner"`
 */
export const useReadQueryAggregatorOwner = /*#__PURE__*/ createUseReadContract({
  abi: queryAggregatorAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadQueryAggregatorOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadQueryAggregatorProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__
 */
export const useWriteQueryAggregator = /*#__PURE__*/ createUseWriteContract({
  abi: queryAggregatorAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteQueryAggregatorCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteQueryAggregatorCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteQueryAggregatorInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteQueryAggregatorRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteQueryAggregatorRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"setRegistries"`
 */
export const useWriteQueryAggregatorSetRegistries =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'setRegistries',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteQueryAggregatorTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteQueryAggregatorUpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__
 */
export const useSimulateQueryAggregator =
  /*#__PURE__*/ createUseSimulateContract({ abi: queryAggregatorAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateQueryAggregatorCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateQueryAggregatorCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateQueryAggregatorInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateQueryAggregatorRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateQueryAggregatorRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"setRegistries"`
 */
export const useSimulateQueryAggregatorSetRegistries =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'setRegistries',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateQueryAggregatorTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateQueryAggregatorUpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__
 */
export const useWatchQueryAggregatorEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: queryAggregatorAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"Initialized"`
 */
export const useWatchQueryAggregatorInitializedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'Initialized',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchQueryAggregatorOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchQueryAggregatorOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchQueryAggregatorOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchQueryAggregatorUpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__
 */
export const useReadTierRevealModule = /*#__PURE__*/ createUseReadContract({
  abi: tierRevealModuleAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadTierRevealModuleMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: tierRevealModuleAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadTierRevealModuleMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: tierRevealModuleAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"owner"`
 */
export const useReadTierRevealModuleOwner = /*#__PURE__*/ createUseReadContract(
  { abi: tierRevealModuleAbi, functionName: 'owner' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadTierRevealModuleOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: tierRevealModuleAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"resolve"`
 */
export const useReadTierRevealModuleResolve =
  /*#__PURE__*/ createUseReadContract({
    abi: tierRevealModuleAbi,
    functionName: 'resolve',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"sealed_"`
 */
export const useReadTierRevealModuleSealed =
  /*#__PURE__*/ createUseReadContract({
    abi: tierRevealModuleAbi,
    functionName: 'sealed_',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"tierCount"`
 */
export const useReadTierRevealModuleTierCount =
  /*#__PURE__*/ createUseReadContract({
    abi: tierRevealModuleAbi,
    functionName: 'tierCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"tiers"`
 */
export const useReadTierRevealModuleTiers = /*#__PURE__*/ createUseReadContract(
  { abi: tierRevealModuleAbi, functionName: 'tiers' },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link tierRevealModuleAbi}__
 */
export const useWriteTierRevealModule = /*#__PURE__*/ createUseWriteContract({
  abi: tierRevealModuleAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteTierRevealModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: tierRevealModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteTierRevealModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: tierRevealModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"initTiers"`
 */
export const useWriteTierRevealModuleInitTiers =
  /*#__PURE__*/ createUseWriteContract({
    abi: tierRevealModuleAbi,
    functionName: 'initTiers',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteTierRevealModuleRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: tierRevealModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteTierRevealModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: tierRevealModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWriteTierRevealModuleSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: tierRevealModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteTierRevealModuleTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: tierRevealModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link tierRevealModuleAbi}__
 */
export const useSimulateTierRevealModule =
  /*#__PURE__*/ createUseSimulateContract({ abi: tierRevealModuleAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateTierRevealModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: tierRevealModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateTierRevealModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: tierRevealModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"initTiers"`
 */
export const useSimulateTierRevealModuleInitTiers =
  /*#__PURE__*/ createUseSimulateContract({
    abi: tierRevealModuleAbi,
    functionName: 'initTiers',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateTierRevealModuleRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: tierRevealModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateTierRevealModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: tierRevealModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulateTierRevealModuleSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: tierRevealModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateTierRevealModuleTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: tierRevealModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link tierRevealModuleAbi}__
 */
export const useWatchTierRevealModuleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: tierRevealModuleAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `eventName` set to `"MetadataURIUpdated"`
 */
export const useWatchTierRevealModuleMetadataUriUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: tierRevealModuleAbi,
    eventName: 'MetadataURIUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchTierRevealModuleOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: tierRevealModuleAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchTierRevealModuleOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: tierRevealModuleAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchTierRevealModuleOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: tierRevealModuleAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link tierRevealModuleAbi}__ and `eventName` set to `"TiersSealed"`
 */
export const useWatchTierRevealModuleTiersSealedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: tierRevealModuleAbi,
    eventName: 'TiersSealed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__
 */
export const useReadZammLiquidityDeployerModule =
  /*#__PURE__*/ createUseReadContract({ abi: zammLiquidityDeployerModuleAbi })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"MAX_INIT_PRICE_DEVIATION_BPS"`
 */
export const useReadZammLiquidityDeployerModuleMaxInitPriceDeviationBps =
  /*#__PURE__*/ createUseReadContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'MAX_INIT_PRICE_DEVIATION_BPS',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"feeOrHook"`
 */
export const useReadZammLiquidityDeployerModuleFeeOrHook =
  /*#__PURE__*/ createUseReadContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'feeOrHook',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadZammLiquidityDeployerModuleMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"metadataURI"`
 */
export const useReadZammLiquidityDeployerModuleMetadataUri =
  /*#__PURE__*/ createUseReadContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'metadataURI',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"owner"`
 */
export const useReadZammLiquidityDeployerModuleOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadZammLiquidityDeployerModuleOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"zamm"`
 */
export const useReadZammLiquidityDeployerModuleZamm =
  /*#__PURE__*/ createUseReadContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'zamm',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__
 */
export const useWriteZammLiquidityDeployerModule =
  /*#__PURE__*/ createUseWriteContract({ abi: zammLiquidityDeployerModuleAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteZammLiquidityDeployerModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteZammLiquidityDeployerModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"deployLiquidity"`
 */
export const useWriteZammLiquidityDeployerModuleDeployLiquidity =
  /*#__PURE__*/ createUseWriteContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'deployLiquidity',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteZammLiquidityDeployerModuleRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteZammLiquidityDeployerModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useWriteZammLiquidityDeployerModuleSetMetadataUri =
  /*#__PURE__*/ createUseWriteContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteZammLiquidityDeployerModuleTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__
 */
export const useSimulateZammLiquidityDeployerModule =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zammLiquidityDeployerModuleAbi,
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateZammLiquidityDeployerModuleCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateZammLiquidityDeployerModuleCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"deployLiquidity"`
 */
export const useSimulateZammLiquidityDeployerModuleDeployLiquidity =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'deployLiquidity',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateZammLiquidityDeployerModuleRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateZammLiquidityDeployerModuleRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"setMetadataURI"`
 */
export const useSimulateZammLiquidityDeployerModuleSetMetadataUri =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'setMetadataURI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateZammLiquidityDeployerModuleTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zammLiquidityDeployerModuleAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__
 */
export const useWatchZammLiquidityDeployerModuleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `eventName` set to `"CreatorCarvePaid"`
 */
export const useWatchZammLiquidityDeployerModuleCreatorCarvePaidEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
    eventName: 'CreatorCarvePaid',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `eventName` set to `"GraduationFeePaid"`
 */
export const useWatchZammLiquidityDeployerModuleGraduationFeePaidEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
    eventName: 'GraduationFeePaid',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `eventName` set to `"GraduationVaultContribution"`
 */
export const useWatchZammLiquidityDeployerModuleGraduationVaultContributionEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
    eventName: 'GraduationVaultContribution',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `eventName` set to `"LiquidityDeployed"`
 */
export const useWatchZammLiquidityDeployerModuleLiquidityDeployedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
    eventName: 'LiquidityDeployed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `eventName` set to `"MetadataURIUpdated"`
 */
export const useWatchZammLiquidityDeployerModuleMetadataUriUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
    eventName: 'MetadataURIUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchZammLiquidityDeployerModuleOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchZammLiquidityDeployerModuleOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zammLiquidityDeployerModuleAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchZammLiquidityDeployerModuleOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zammLiquidityDeployerModuleAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zRouterAbi}__
 */
export const useReadZRouter = /*#__PURE__*/ createUseReadContract({
  abi: zRouterAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"onERC721Received"`
 */
export const useReadZRouterOnErc721Received =
  /*#__PURE__*/ createUseReadContract({
    abi: zRouterAbi,
    functionName: 'onERC721Received',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"safeExecutor"`
 */
export const useReadZRouterSafeExecutor = /*#__PURE__*/ createUseReadContract({
  abi: zRouterAbi,
  functionName: 'safeExecutor',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__
 */
export const useWriteZRouter = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"addLiquidity"`
 */
export const useWriteZRouterAddLiquidity = /*#__PURE__*/ createUseWriteContract(
  { abi: zRouterAbi, functionName: 'addLiquidity' },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"deposit"`
 */
export const useWriteZRouterDeposit = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'deposit',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"ensureAllowance"`
 */
export const useWriteZRouterEnsureAllowance =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'ensureAllowance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"ethToExactSTETH"`
 */
export const useWriteZRouterEthToExactSteth =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'ethToExactSTETH',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"ethToExactWSTETH"`
 */
export const useWriteZRouterEthToExactWsteth =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'ethToExactWSTETH',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"exactETHToSTETH"`
 */
export const useWriteZRouterExactEthToSteth =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'exactETHToSTETH',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"exactETHToWSTETH"`
 */
export const useWriteZRouterExactEthToWsteth =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'exactETHToWSTETH',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"execute"`
 */
export const useWriteZRouterExecute = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'execute',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"multicall"`
 */
export const useWriteZRouterMulticall = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'multicall',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"permit"`
 */
export const useWriteZRouterPermit = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'permit',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"permit2BatchTransferFrom"`
 */
export const useWriteZRouterPermit2BatchTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'permit2BatchTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"permit2TransferFrom"`
 */
export const useWriteZRouterPermit2TransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'permit2TransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"permitDAI"`
 */
export const useWriteZRouterPermitDai = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'permitDAI',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"revealName"`
 */
export const useWriteZRouterRevealName = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'revealName',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"snwap"`
 */
export const useWriteZRouterSnwap = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'snwap',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"snwapMulti"`
 */
export const useWriteZRouterSnwapMulti = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'snwapMulti',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapCurve"`
 */
export const useWriteZRouterSwapCurve = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'swapCurve',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapV2"`
 */
export const useWriteZRouterSwapV2 = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'swapV2',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapV3"`
 */
export const useWriteZRouterSwapV3 = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'swapV3',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapV4"`
 */
export const useWriteZRouterSwapV4 = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'swapV4',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapVZ"`
 */
export const useWriteZRouterSwapVz = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'swapVZ',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"sweep"`
 */
export const useWriteZRouterSweep = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'sweep',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteZRouterTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"trust"`
 */
export const useWriteZRouterTrust = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'trust',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"unlockCallback"`
 */
export const useWriteZRouterUnlockCallback =
  /*#__PURE__*/ createUseWriteContract({
    abi: zRouterAbi,
    functionName: 'unlockCallback',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"unwrap"`
 */
export const useWriteZRouterUnwrap = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'unwrap',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"wrap"`
 */
export const useWriteZRouterWrap = /*#__PURE__*/ createUseWriteContract({
  abi: zRouterAbi,
  functionName: 'wrap',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__
 */
export const useSimulateZRouter = /*#__PURE__*/ createUseSimulateContract({
  abi: zRouterAbi,
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"addLiquidity"`
 */
export const useSimulateZRouterAddLiquidity =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'addLiquidity',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"deposit"`
 */
export const useSimulateZRouterDeposit =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'deposit',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"ensureAllowance"`
 */
export const useSimulateZRouterEnsureAllowance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'ensureAllowance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"ethToExactSTETH"`
 */
export const useSimulateZRouterEthToExactSteth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'ethToExactSTETH',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"ethToExactWSTETH"`
 */
export const useSimulateZRouterEthToExactWsteth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'ethToExactWSTETH',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"exactETHToSTETH"`
 */
export const useSimulateZRouterExactEthToSteth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'exactETHToSTETH',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"exactETHToWSTETH"`
 */
export const useSimulateZRouterExactEthToWsteth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'exactETHToWSTETH',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"execute"`
 */
export const useSimulateZRouterExecute =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'execute',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"multicall"`
 */
export const useSimulateZRouterMulticall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'multicall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"permit"`
 */
export const useSimulateZRouterPermit = /*#__PURE__*/ createUseSimulateContract(
  { abi: zRouterAbi, functionName: 'permit' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"permit2BatchTransferFrom"`
 */
export const useSimulateZRouterPermit2BatchTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'permit2BatchTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"permit2TransferFrom"`
 */
export const useSimulateZRouterPermit2TransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'permit2TransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"permitDAI"`
 */
export const useSimulateZRouterPermitDai =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'permitDAI',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"revealName"`
 */
export const useSimulateZRouterRevealName =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'revealName',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"snwap"`
 */
export const useSimulateZRouterSnwap = /*#__PURE__*/ createUseSimulateContract({
  abi: zRouterAbi,
  functionName: 'snwap',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"snwapMulti"`
 */
export const useSimulateZRouterSnwapMulti =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'snwapMulti',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapCurve"`
 */
export const useSimulateZRouterSwapCurve =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'swapCurve',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapV2"`
 */
export const useSimulateZRouterSwapV2 = /*#__PURE__*/ createUseSimulateContract(
  { abi: zRouterAbi, functionName: 'swapV2' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapV3"`
 */
export const useSimulateZRouterSwapV3 = /*#__PURE__*/ createUseSimulateContract(
  { abi: zRouterAbi, functionName: 'swapV3' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapV4"`
 */
export const useSimulateZRouterSwapV4 = /*#__PURE__*/ createUseSimulateContract(
  { abi: zRouterAbi, functionName: 'swapV4' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"swapVZ"`
 */
export const useSimulateZRouterSwapVz = /*#__PURE__*/ createUseSimulateContract(
  { abi: zRouterAbi, functionName: 'swapVZ' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"sweep"`
 */
export const useSimulateZRouterSweep = /*#__PURE__*/ createUseSimulateContract({
  abi: zRouterAbi,
  functionName: 'sweep',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateZRouterTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"trust"`
 */
export const useSimulateZRouterTrust = /*#__PURE__*/ createUseSimulateContract({
  abi: zRouterAbi,
  functionName: 'trust',
})

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"unlockCallback"`
 */
export const useSimulateZRouterUnlockCallback =
  /*#__PURE__*/ createUseSimulateContract({
    abi: zRouterAbi,
    functionName: 'unlockCallback',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"unwrap"`
 */
export const useSimulateZRouterUnwrap = /*#__PURE__*/ createUseSimulateContract(
  { abi: zRouterAbi, functionName: 'unwrap' },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link zRouterAbi}__ and `functionName` set to `"wrap"`
 */
export const useSimulateZRouterWrap = /*#__PURE__*/ createUseSimulateContract({
  abi: zRouterAbi,
  functionName: 'wrap',
})

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zRouterAbi}__
 */
export const useWatchZRouterEvent = /*#__PURE__*/ createUseWatchContractEvent({
  abi: zRouterAbi,
})

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link zRouterAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchZRouterOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: zRouterAbi,
    eventName: 'OwnershipTransferred',
  })
