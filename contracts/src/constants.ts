/**
 * Per-network typed constants for the deployed S3ntimentSurveyStore contract.
 *
 * The contract is single and non-upgradeable. Its `address` and `abi` are read
 * from the committed hardhat-deploy deployment artifact
 * `deployments/<network>/S3ntimentSurveyStore.json` (the single source of
 * truth) — never duplicated as literal `0x…` strings here or in consumers.
 * `chainId` is recorded beside the address so each network's constant is
 * self-describing.
 *
 * NOTE: this module intentionally lives in the `s3ntiment-contracts` package
 * (which already re-exports `./deployments/*`). It must NOT live in
 * `@s3ntiment/shared`: shared deliberately does not depend on
 * s3ntiment-contracts, and doing so would create a dependency cycle.
 */

import surveyStoreBase from '../deployments/base/S3ntimentSurveyStore.json' with { type: 'json' };

export interface S3ntimentSurveyStoreConstant {
	/** Deployed contract address, derived from the deployment JSON. */
	address: `0x${string}`;
	/** ABI entries, derived from the deployment JSON. */
	abi: typeof surveyStoreBase['abi'];
	/** EVM chain id the contract is deployed on. */
	chainId: number;
}

/** Base mainnet (chainId 8453) deployment of S3ntimentSurveyStore. */
export const S3NTIMENT_STORE: S3ntimentSurveyStoreConstant = {
	address: surveyStoreBase.address as `0x${string}`,
	abi: surveyStoreBase.abi,
	chainId: 8453,
};

/**
 * Network-keyed registry of the deployed S3ntimentSurveyStore constants.
 * Extend with e.g. `sepolia: S3NTIMENT_STORE_SEPOLIA` if/when a Sepolia
 * deployment JSON exists.
 */
export const S3NTIMENT_STORE_BY_NETWORK = {
	base: S3NTIMENT_STORE,
} as const;

export type S3ntimentNetwork = keyof typeof S3NTIMENT_STORE_BY_NETWORK;
