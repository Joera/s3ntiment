// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @title S3ntimentSurveyStore
 * @notice Manages pools, surveys, and anonymous respondent registration.
 *
 * Core model:
 *   - A pool is a named collection of surveys with a shared respondent registry
 *   - A standalone survey is just a pool with one survey — no special casing
 *   - Respondents join a pool once via a physical card (one on-chain write)
 *   - Survey participation is off-chain (nilDB); no per-survey on-chain interaction
 *
 * Ownership model / authority:
 *   - The per-pool authority is pools[poolId].safe — the Safe multisig that owns it
 *   - A pool is created implicitly when the first survey references it
 *   - The _requirePoolSafe(poolId) internal function is the SINGLE choke-point for
 *     every Safe-gated write (createSurvey on an existing pool, updateSurvey, registerBatch,
 *     revokeMember)
 *   - registerBatch() and revokeMember() are Safe-executed (governance)
 *
 * Card generation flow (off-chain):
 *   1. Pool Safe signs a random seed → derives an ephemeral batch wallet
 *   2. Batch wallet address is registered on-chain via createSurvey() or registerBatch()
 *   3. Each card's nullifier is signed locally by the batch wallet (no popups)
 *   4. Cards are printed as QR codes: { nullifier, batchId, signature, poolId }
 *
 * Registration flow (on-chain):
 *   1. WaaP creates a fresh EOA — the pool wallet (unlinkable to master identity)
 *   2. Pool wallet EOA owns an SMC; SMC calls registerInPool()
 *   3. Contract resolves identity via ISMC(msg.sender).owner() → pool wallet EOA
 *   4. Nullifier is burned, pool wallet EOA is recorded as pool member
 *   5. One on-chain write, ever, for this respondent in this pool
 *
 * Survey participation flow (off-chain):
 *   1. Lit Protocol checks isPoolMember(poolId, address) as access condition
 *   2. :userAddress resolves to the pool wallet EOA (Lit auth signed by that key)
 *   3. Survey-level nullifiers (double-response prevention) live in nilDB
 *
 * Privacy properties:
 *   - Pool wallet is a fresh EOA — no link to any existing identity
 *   - Chain only records "this address is a member of this pool"
 *   - Survey participation is invisible on-chain
 *   - Cross-survey correlation within a pool is expected (panel model)
 *   - No cross-pool correlation possible
 *
 * Key design decisions:
 *   - batchId === batch wallet address (no separate UUID)
 *   - Batches are scoped to a pool, not a survey
 *   - Batch signers are immutable once registered — protects printed cards
 *   - The SMC is purely a gas abstraction — identity is ISMC(msg.sender).owner()
 *   - No events emitted — storage is read directly by Lit and frontend
 */

interface ISMC {
    function owner() external view returns (address);
}


contract S3ntimentSurveyStore {

    // -------------------------------------------------------------------------
    // Data structures
    // -------------------------------------------------------------------------

    struct Pool {
        address safe;           // Safe multisig that owns this pool
        uint256 createdAt;
    }

    struct Survey {
        string ipfsCid;
        string poolId;
        uint256 createdAt;
    }

    struct Batch {
        uint256 createdAt;
        uint256 cardCount;      // cards redeemed from this batch
    }

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    // Pool registry
    mapping(string => Pool) private pools;
    mapping(address => string[]) private safePools;         // safe → poolIds

    // Surveys — keyed by surveyId, linked to a pool
    mapping(string => Survey) private surveys;
    mapping(string => string[]) private poolSurveys;        // poolId → surveyIds

    // Batch management — scoped to pool
    mapping(string => mapping(address => Batch)) private batches;
    mapping(string => address[]) private poolBatchIds;

    // Nullifiers — scoped per pool, prevent card reuse WITHIN a pool. The outer
    // key (poolId) is defense-in-depth on top of messageHash (which already
    // embeds the poolId), so a card burned in one pool can never affect another.
    mapping(string => mapping(bytes32 => bool)) private usedNullifiers;

    // Pool membership — pool wallet EOA is the member identity
    mapping(string => mapping(address => bool)) private poolMembers;

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error PoolNotFound();
    error PoolAlreadyExists();
    error NotPoolSafe();
    error SurveyNotFound();
    error SurveyAlreadyExists();
    error BatchNotFound();
    error BatchAlreadyRegistered();
    error InvalidBatchId();
    error InvalidMemberAddress();
    error NullifierAlreadyUsed();
    error InvalidSignature();
    error AlreadyPoolMember();

    // -------------------------------------------------------------------------
    // Authority choke-point (single internal function)
    // -------------------------------------------------------------------------

    /**
     * @dev The single authority choke-point for all Safe-gated writes.
     *      Per-pool authority is pools[poolId].safe — the only caller permitted
     *      to mutate a pool is that pool's Safe.
     *        1. Existence: the pool must already be registered (else PoolNotFound).
     *        2. Actor: msg.sender must be the pool's Safe (else NotPoolSafe).
     *      Any future Safe-gated method must route through this function, not
     *      re-check the Safe inline, so no privileged path can bypass auth.
     */
    function _requirePoolSafe(string memory poolId) internal view {
        if (pools[poolId].safe == address(0)) revert PoolNotFound();
        if (pools[poolId].safe != msg.sender) revert NotPoolSafe();
    }

    // =========================================================================
    // Survey management (creates pool implicitly)
    // =========================================================================

    /**
     * @dev Create a survey. If the pool does not exist yet, it is created
     *      implicitly and msg.sender is recorded as the pool's Safe.
     *      Always Safe-executed (msg.sender = Safe address).
     *
     *      New pool (poolId not yet registered):
     *        - Pool is bootstrapped with msg.sender as the owning Safe
     *        - batchIds are registered for the new pool
     *
     *      Existing pool:
     *        - msg.sender must be the pool's Safe
     *        - batchIds are ignored (use registerBatch() for new print runs)
     *
     * @param surveyId  Unique identifier, generated client-side
     * @param poolId    Pool this survey belongs to (created if new)
     * @param ipfsCid   IPFS content identifier for survey metadata
     * @param batchIds  Batch wallet addresses — only used when bootstrapping a new pool
     */
    function createSurvey(
        string memory surveyId,
        string memory poolId,
        string memory ipfsCid,
        address[] memory batchIds
    ) external {
        require(bytes(surveyId).length > 0, "Survey ID cannot be empty");
        require(bytes(poolId).length > 0, "Pool ID cannot be empty");
        require(bytes(ipfsCid).length > 0, "IPFS CID cannot be empty");
        if (surveys[surveyId].createdAt != 0) revert SurveyAlreadyExists();

        // Pool bootstrap or Safe-authority check.
        if (pools[poolId].safe == address(0)) {
            // New pool — msg.sender becomes the Safe (no authority check yet:
            // the pool does not exist, so there is nothing to be Safe of).
            _createPool(poolId, msg.sender);
            for (uint256 i = 0; i < batchIds.length; i++) {
                _registerBatch(poolId, batchIds[i]);
            }
            _recordSurvey(surveyId, poolId, ipfsCid);
        } else {
            // Existing pool — caller must be the pool's Safe (shared choke-point).
            _requirePoolSafe(poolId);
            _recordSurvey(surveyId, poolId, ipfsCid);
        }
    }

    function _recordSurvey(
        string memory surveyId,
        string memory poolId,
        string memory ipfsCid
    ) internal {
        surveys[surveyId] = Survey({
            ipfsCid: ipfsCid,
            poolId: poolId,
            createdAt: block.timestamp
        });

        poolSurveys[poolId].push(surveyId);
    }

    /**
     * @dev Update survey IPFS CID. Must be Safe-executed by the pool's Safe.
     */
    function updateSurvey(
        string memory surveyId,
        string memory newIpfsCid
    ) external {
        Survey storage survey = surveys[surveyId];
        if (survey.createdAt == 0) revert SurveyNotFound();

        // Path the pool's authority through the shared choke-point; the poolId
        // is derived from the stored survey, so its existence is guaranteed here.
        _requirePoolSafe(survey.poolId);

        survey.ipfsCid = newIpfsCid;
    }

    function getSurvey(string memory surveyId)
        external
        view
        returns (string memory ipfsCid, string memory poolId, uint256 createdAt)
    {
        Survey memory survey = surveys[surveyId];
        if (survey.createdAt == 0) revert SurveyNotFound();
        return (survey.ipfsCid, survey.poolId, survey.createdAt);
    }

    function surveyExists(string memory surveyId) external view returns (bool) {
        return surveys[surveyId].createdAt != 0;
    }

    function getPoolSurveys(string memory poolId) external view returns (string[] memory) {
        return poolSurveys[poolId];
    }

    // =========================================================================
    // Pool read methods
    // =========================================================================

    function getPool(string memory poolId)
        external
        view
        returns (address safe, uint256 createdAt)
    {
        Pool memory pool = pools[poolId];
        if (pool.safe == address(0)) revert PoolNotFound();
        return (pool.safe, pool.createdAt);
    }

    function poolExists(string memory poolId) external view returns (bool) {
        return pools[poolId].safe != address(0);
    }

    function isPoolSafe(address addr, string memory poolId) external view returns (bool) {
        return pools[poolId].safe == addr;
    }

    function getSafePools(address safe) external view returns (string[] memory) {
        return safePools[safe];
    }

    // =========================================================================
    // Batch management (Safe-executed)
    // =========================================================================

    /**
     * @dev Register an additional batch wallet for an existing pool.
     *      Called by the pool's Safe (governance tx).
     *      For initial batches, pass them in createSurvey() when bootstrapping the pool.
     *
     * @param poolId   Pool this batch belongs to
     * @param batchId  Ephemeral batch wallet address
     */
    function registerBatch(
        string memory poolId,
        address batchId
    ) external {
        _requirePoolSafe(poolId);
        _registerBatch(poolId, batchId);
    }

    function getBatch(string memory poolId, address batchId)
        external
        view
        returns (uint256 createdAt, uint256 cardCount)
    {
        Batch memory batch = batches[poolId][batchId];
        if (batch.createdAt == 0) revert BatchNotFound();
        return (batch.createdAt, batch.cardCount);
    }

    function getPoolBatches(string memory poolId) external view returns (address[] memory) {
        return poolBatchIds[poolId];
    }

    // =========================================================================
    // Pool registration (one-time, card-based, via SMC)
    // =========================================================================

    /**
     * @dev Validate a card and register the pool wallet EOA as a pool member.
     *      Called by the respondent's SMC (gas abstraction layer).
     *      Identity resolved via ISMC(msg.sender).owner() → pool wallet EOA.
     *
     * @param poolId     Pool to join
     * @param nullifier  Unique card identifier from QR code
     * @param batchId    Batch wallet address this card belongs to
     * @param signature  Signature of the pool/contract/chain-bound card message
     *                   by the batch wallet
     */
    function registerInPool(
        string memory poolId,
        string memory nullifier,
        address batchId,
        bytes memory signature
    ) external {
        if (pools[poolId].safe == address(0)) revert PoolNotFound();
        if (batches[poolId][batchId].createdAt == 0) revert BatchNotFound();

        // Verify the card signature over the pool/contract/chain-bound digest.
        //   messageHash = keccak256(abi.encode(poolId, nullifier, batchId, address(this), block.chainid))
        // abi.encode (NOT encodePacked) is required: with two dynamic fields
        // (poolId, nullifier), packed concatenation is no longer collision-safe.
        // Binding address(this) + block.chainid scopes the card to this contract
        // on this chain (audit #6), and poolId scopes it to this pool (audit #1).
        bytes32 messageHash = keccak256(
            abi.encode(poolId, nullifier, batchId, address(this), block.chainid)
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        address signer = _recoverSigner(ethSignedHash, signature);

        if (signer != batchId) revert InvalidSignature();
        if (usedNullifiers[poolId][messageHash]) revert NullifierAlreadyUsed();

        // Burn nullifier (scoped per pool; messageHash already embeds poolId).
        usedNullifiers[poolId][messageHash] = true;
        batches[poolId][batchId].cardCount++;

        // Resolve identity: SMC owner is the pool wallet EOA
        address poolWallet = ISMC(msg.sender).owner();
        // Reject a zero-address owner (audit #7): a malicious SMC must not write
        // a bogus poolMembers[poolId][address(0)] = true. Reverting here rolls
        // back the nullifier burn + cardCount increment above.
        if (poolWallet == address(0)) revert InvalidMemberAddress();
        if (poolMembers[poolId][poolWallet]) revert AlreadyPoolMember();
        poolMembers[poolId][poolWallet] = true;
    }

    /**
     * @dev Revoke a member from a pool (governance). Safe-gated: msg.sender must
     *      be the pool's Safe. Approval runs through the shared _requirePoolSafe
     *      choke-point, so no privileged path can bypass auth.
     *
     *      Setting poolMembers[poolId][member] to false is idempotent: revoking an
     *      already-removed (or never-registered) member is a no-op that succeeds,
     *      consistent with registerBatch-style governance writes (no revert on a
     *      missing entry).
     *
     * @param poolId  Pool the member belongs to
     * @param member  Pool-wallet EOA to revoke from the pool
     */
    function revokeMember(string memory poolId, address member) external {
        _requirePoolSafe(poolId);
        poolMembers[poolId][member] = false;
    }

    /**
     * @dev Check if an address is a registered member of a pool.
     *      Used by Lit Protocol as an access condition.
     *      :userAddress resolves to the pool wallet EOA.
     */
    function isPoolMember(string memory poolId, address member) external view returns (bool) {
        return poolMembers[poolId][member];
    }

    function isNullifierUsed(
        string memory poolId,
        string memory nullifier,
        address batchId
    ) external view returns (bool) {
        bytes32 cardHash = keccak256(
            abi.encode(poolId, nullifier, batchId, address(this), block.chainid)
        );
        if (usedNullifiers[poolId][cardHash]) return true;
        return false;
    }

    // =========================================================================
    // Internal
    // =========================================================================

    function _createPool(
        string memory poolId,
        address safe
    ) internal {
        pools[poolId] = Pool({
            safe: safe,
            createdAt: block.timestamp
        });

        safePools[safe].push(poolId);
    }

    function _registerBatch(
        string memory poolId,
        address batchId
    ) internal {
        if (batchId == address(0)) revert InvalidBatchId();
        if (batches[poolId][batchId].createdAt != 0) revert BatchAlreadyRegistered();

        batches[poolId][batchId] = Batch({
            createdAt: block.timestamp,
            cardCount: 0
        });

        poolBatchIds[poolId].push(batchId);
    }

    function _recoverSigner(bytes32 messageHash, bytes memory signature)
        internal
        pure
        returns (address)
    {
        require(signature.length == 65, "Invalid signature length");

        bytes32 r;
        bytes32 s;
        uint8 v;

        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        if (v < 27) v += 27;
        require(v == 27 || v == 28, "Invalid signature recovery value");

        return ecrecover(messageHash, v, r, s);
    }
}

