// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * Minimal, testnet-grade implementations of the three ERC-8004 ("Trustless
 * Agents") registries — Identity, Reputation, Validation — faithful to the
 * spec's function surface (see docs/erc8004-acp-benchmark.md) with two
 * documented simplifications for this stage:
 *
 *  - Identity is a plain ownable registry rather than a full ERC-721
 *    (no transfers/approvals; the agent's own account registers itself,
 *    so owner == agent address).
 *  - getSummary() aggregates raw values without per-entry decimal
 *    normalization (we always publish valueDecimals = 0).
 *
 * The property that matters is preserved exactly: the Reputation registry
 * REJECTS feedback from an agent's own owner — the spec's enforcement of
 * this project's founding rule, grader ≠ solver. Scores and verdicts about
 * an agent can only ever be published by someone else (here: the oracle).
 */

contract ERC8004IdentityRegistry {
    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event AgentURIUpdated(uint256 indexed agentId, string newURI);
    event MetadataSet(uint256 indexed agentId, string key, bytes value);

    uint256 public nextAgentId = 1;
    mapping(uint256 => address) public ownerOf;
    mapping(uint256 => string) public agentURI;
    mapping(uint256 => mapping(string => bytes)) private _metadata;

    /// @notice Register the caller as a new agent. agentURI should resolve
    ///         to an ERC-8004 registration file (our /api/agents/:id/card).
    function register(string calldata uri) external returns (uint256 agentId) {
        agentId = nextAgentId++;
        ownerOf[agentId] = msg.sender;
        agentURI[agentId] = uri;
        emit Registered(agentId, uri, msg.sender);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(msg.sender == ownerOf[agentId], "not agent owner");
        agentURI[agentId] = newURI;
        emit AgentURIUpdated(agentId, newURI);
    }

    function getAgentWallet(uint256 agentId) external view returns (address) {
        return ownerOf[agentId];
    }

    function setMetadata(uint256 agentId, string calldata key, bytes calldata value) external {
        require(msg.sender == ownerOf[agentId], "not agent owner");
        _metadata[agentId][key] = value;
        emit MetadataSet(agentId, key, value);
    }

    function getMetadata(uint256 agentId, string calldata key) external view returns (bytes memory) {
        return _metadata[agentId][key];
    }
}

contract ERC8004ReputationRegistry {
    struct Feedback {
        int128 value;
        uint8 valueDecimals;
        string tag1;
        string tag2;
        bool isRevoked;
    }

    event FeedbackGiven(
        uint256 indexed agentId,
        address indexed clientAddress,
        uint64 indexed feedbackIndex,
        int128 value,
        string tag1,
        string tag2,
        string feedbackURI
    );
    event FeedbackRevoked(uint256 indexed agentId, address indexed clientAddress, uint64 indexed feedbackIndex);

    ERC8004IdentityRegistry public immutable identity;
    mapping(uint256 => mapping(address => Feedback[])) private _feedback;

    constructor(address identityRegistry) {
        identity = ERC8004IdentityRegistry(identityRegistry);
    }

    function giveFeedback(
        uint256 agentId,
        int128 value,
        uint8 valueDecimals,
        string calldata tag1,
        string calldata tag2,
        string calldata, /* endpoint */
        string calldata feedbackURI,
        bytes32 /* feedbackHash */
    ) external {
        require(valueDecimals <= 18, "decimals > 18");
        require(identity.ownerOf(agentId) != address(0), "unknown agent");
        // The spec's core integrity rule: no self-attestation.
        require(msg.sender != identity.ownerOf(agentId), "self-feedback forbidden");

        _feedback[agentId][msg.sender].push(Feedback(value, valueDecimals, tag1, tag2, false));
        emit FeedbackGiven(
            agentId,
            msg.sender,
            uint64(_feedback[agentId][msg.sender].length - 1),
            value,
            tag1,
            tag2,
            feedbackURI
        );
    }

    function revokeFeedback(uint256 agentId, uint64 feedbackIndex) external {
        Feedback storage f = _feedback[agentId][msg.sender][feedbackIndex];
        f.isRevoked = true;
        emit FeedbackRevoked(agentId, msg.sender, feedbackIndex);
    }

    function readFeedback(uint256 agentId, address clientAddress, uint64 feedbackIndex)
        external
        view
        returns (int128 value, uint8 valueDecimals, string memory tag1, string memory tag2, bool isRevoked)
    {
        Feedback storage f = _feedback[agentId][clientAddress][feedbackIndex];
        return (f.value, f.valueDecimals, f.tag1, f.tag2, f.isRevoked);
    }

    function feedbackCount(uint256 agentId, address clientAddress) external view returns (uint256) {
        return _feedback[agentId][clientAddress].length;
    }

    /// @notice Average of non-revoked feedback values from the given
    ///         clients (raw values; we always publish valueDecimals = 0).
    function getSummary(uint256 agentId, address[] calldata clientAddresses, string calldata tag1)
        external
        view
        returns (uint64 count, int128 summaryValue)
    {
        int256 total = 0;
        for (uint256 i = 0; i < clientAddresses.length; i++) {
            Feedback[] storage list = _feedback[agentId][clientAddresses[i]];
            for (uint256 j = 0; j < list.length; j++) {
                if (list[j].isRevoked) continue;
                if (bytes(tag1).length > 0 && keccak256(bytes(list[j].tag1)) != keccak256(bytes(tag1))) continue;
                total += list[j].value;
                count++;
            }
        }
        summaryValue = count > 0 ? int128(total / int256(uint256(count))) : int128(0);
    }
}

contract ERC8004ValidationRegistry {
    struct Validation {
        address validatorAddress;
        uint256 agentId;
        uint8 response; // 0–100
        bytes32 responseHash;
        string tag;
        uint256 lastUpdate;
        bool responded;
        bool exists;
    }

    event ValidationRequested(bytes32 indexed requestHash, address indexed validatorAddress, uint256 indexed agentId, string requestURI);
    event ValidationResponded(bytes32 indexed requestHash, uint256 indexed agentId, uint8 response, string tag);

    ERC8004IdentityRegistry public immutable identity;
    mapping(bytes32 => Validation) private _validations;
    mapping(uint256 => bytes32[]) private _agentRequests;

    constructor(address identityRegistry) {
        identity = ERC8004IdentityRegistry(identityRegistry);
    }

    /// @notice The agent (owner) asks a validator to attest to something —
    ///         requestURI/requestHash identify the work being validated.
    function validationRequest(address validatorAddress, uint256 agentId, string calldata requestURI, bytes32 requestHash) external {
        require(msg.sender == identity.ownerOf(agentId), "not agent owner");
        require(!_validations[requestHash].exists, "request exists");
        _validations[requestHash] = Validation(validatorAddress, agentId, 0, bytes32(0), "", block.timestamp, false, true);
        _agentRequests[agentId].push(requestHash);
        emit ValidationRequested(requestHash, validatorAddress, agentId, requestURI);
    }

    /// @notice Only the addressed validator can respond; re-responding is
    ///         allowed (spec: progressive/updated validations).
    function validationResponse(bytes32 requestHash, uint8 response, string calldata, /* responseURI */ bytes32 responseHash, string calldata tag) external {
        Validation storage v = _validations[requestHash];
        require(v.exists, "unknown request");
        require(msg.sender == v.validatorAddress, "not the validator");
        require(response <= 100, "response > 100");
        v.response = response;
        v.responseHash = responseHash;
        v.tag = tag;
        v.lastUpdate = block.timestamp;
        v.responded = true;
        emit ValidationResponded(requestHash, v.agentId, response, tag);
    }

    function getValidationStatus(bytes32 requestHash)
        external
        view
        returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string memory tag, uint256 lastUpdate)
    {
        Validation storage v = _validations[requestHash];
        require(v.exists, "unknown request");
        return (v.validatorAddress, v.agentId, v.response, v.responseHash, v.tag, v.lastUpdate);
    }

    function getSummary(uint256 agentId, address[] calldata validatorAddresses, string calldata tag)
        external
        view
        returns (uint64 count, uint8 averageResponse)
    {
        uint256 total = 0;
        bytes32[] storage hashes = _agentRequests[agentId];
        for (uint256 i = 0; i < hashes.length; i++) {
            Validation storage v = _validations[hashes[i]];
            if (!v.responded) continue;
            if (bytes(tag).length > 0 && keccak256(bytes(v.tag)) != keccak256(bytes(tag))) continue;
            if (validatorAddresses.length > 0) {
                bool match_ = false;
                for (uint256 j = 0; j < validatorAddresses.length; j++) {
                    if (v.validatorAddress == validatorAddresses[j]) {
                        match_ = true;
                        break;
                    }
                }
                if (!match_) continue;
            }
            total += v.response;
            count++;
        }
        averageResponse = count > 0 ? uint8(total / count) : 0;
    }

    function getAgentValidations(uint256 agentId) external view returns (bytes32[] memory) {
        return _agentRequests[agentId];
    }
}
