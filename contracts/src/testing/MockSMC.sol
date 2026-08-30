// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @dev Minimal interface exposing only the store function that the SMC mock
///     forwards to. Mirrors the production call path.
interface IS3ntimentSurveyStore {
    function registerInPool(
        string calldata poolId,
        string calldata nullifier,
        address batchId,
        bytes calldata signature
    ) external;

    function rotateMember(
        string calldata poolId,
        address newLeaf,
        bytes calldata signature
    ) external;
}

/// @title MockSMC
/// @notice Test-only mock of the respondent's gas-abstraction layer (SMC).
///
///     S3ntimentSurveyStore.registerInPool() resolves the respondent identity
///     via ISMC(msg.sender).owner() — the contract expects msg.sender to be an
///     SMC whose `owner` is the fresh pool-wallet EOA. This mock lets tests
///     drive that path without a real SMC: it returns a configurable owner and
///     forwards registration calls to the store.
contract MockSMC {
    address public immutable owner;

    constructor(address _owner) {
        owner = _owner;
    }

    function register(
        address store,
        string calldata poolId,
        string calldata nullifier,
        address batchId,
        bytes calldata signature
    ) external {
        IS3ntimentSurveyStore(store).registerInPool(
            poolId,
            nullifier,
            batchId,
            signature
        );
    }

    function rotate(
        address store,
        string calldata poolId,
        address newLeaf,
        bytes calldata signature
    ) external {
        IS3ntimentSurveyStore(store).rotateMember(
            poolId,
            newLeaf,
            signature
        );
    }
}
