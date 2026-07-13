// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title ReturnBond
/// @notice Escrows native MON deposits for peer-to-peer physical item lending agreements.
contract ReturnBond is ReentrancyGuard {
    enum Status {
        Created,
        Funded,
        Active,
        ReturnRequested,
        ClaimRequested,
        Disputed,
        Refunded,
        Claimed,
        Cancelled
    }

    struct Agreement {
        uint256 id;
        address owner;
        address borrower;
        address arbiter;
        string itemName;
        string itemMetadataURI;
        uint256 depositAmount;
        uint64 handoverDeadline;
        uint64 returnDeadline;
        uint64 inspectionPeriod;
        uint64 claimResponsePeriod;
        Status status;
        uint64 fundingTimestamp;
        uint64 handoverTimestamp;
        uint64 returnRequestTimestamp;
        uint64 claimCreationTimestamp;
        uint256 claimAmount;
        string returnProofURI;
        string claimEvidenceURI;
    }

    error AgreementNotFound(uint256 agreementId);
    error ZeroAddress();
    error RolesMustBeDistinct();
    error ZeroDeposit();
    error InvalidHandoverDeadline();
    error InvalidReturnDeadline();
    error ZeroInspectionPeriod();
    error ZeroClaimResponsePeriod();
    error EmptyItemName();
    error EmptyMetadataURI();
    error EmptyReturnProofURI();
    error EmptyClaimEvidenceURI();
    error Unauthorized(uint256 agreementId, address caller);
    error InvalidStatus(uint256 agreementId, Status expected, Status actual);
    error IncorrectDeposit(uint256 expected, uint256 received);
    error DeadlineExpired(uint256 agreementId, uint256 deadline);
    error DeadlineNotReached(uint256 agreementId, uint256 deadline);
    error InvalidClaimAmount(uint256 claimAmount, uint256 depositAmount);
    error NativeTransferFailed(address recipient, uint256 amount);
    error TimestampOverflow();

    event AgreementCreated(
        uint256 indexed agreementId,
        address indexed owner,
        address indexed borrower,
        address arbiter,
        uint256 depositAmount
    );
    event AgreementCancelled(
        uint256 indexed agreementId, address indexed owner, address indexed actor, bool depositRefunded
    );
    event AgreementFunded(
        uint256 indexed agreementId, address indexed borrower, uint256 amount, uint64 fundingTimestamp
    );
    event HandoverConfirmed(uint256 indexed agreementId, address indexed owner, uint64 handoverTimestamp);
    event ReturnRequested(
        uint256 indexed agreementId, address indexed borrower, string returnProofURI, uint64 returnRequestTimestamp
    );
    event ReturnConfirmed(
        uint256 indexed agreementId,
        address indexed actor,
        address indexed borrower,
        uint256 refundedAmount,
        bool timedOut
    );
    event ClaimRaised(
        uint256 indexed agreementId,
        address indexed owner,
        uint256 claimAmount,
        string claimEvidenceURI,
        bool overdue,
        uint64 claimCreationTimestamp
    );
    event ClaimDisputed(uint256 indexed agreementId, address indexed borrower, address indexed arbiter);
    event ClaimAccepted(
        uint256 indexed agreementId,
        address indexed borrower,
        address indexed owner,
        uint256 ownerAward,
        uint256 borrowerRefund
    );
    event ClaimFinalized(
        uint256 indexed agreementId,
        address indexed owner,
        address indexed borrower,
        uint256 ownerAward,
        uint256 borrowerRefund
    );
    event DisputeResolved(
        uint256 indexed agreementId,
        address indexed arbiter,
        address indexed owner,
        address borrower,
        uint256 ownerAward,
        uint256 borrowerRefund
    );

    uint256 private _nextAgreementId = 1;
    mapping(uint256 agreementId => Agreement agreement) private _agreements;
    mapping(address account => uint256[] agreementIds) private _ownerAgreementIds;
    mapping(address account => uint256[] agreementIds) private _borrowerAgreementIds;
    mapping(address account => uint256[] agreementIds) private _arbiterAgreementIds;

    function createAgreement(
        address borrower,
        address arbiter,
        string calldata itemName,
        string calldata itemMetadataURI,
        uint256 depositAmount,
        uint64 handoverDeadline,
        uint64 returnDeadline,
        uint64 inspectionPeriod,
        uint64 claimResponsePeriod
    ) external returns (uint256 agreementId) {
        address owner = msg.sender;
        if (owner == address(0) || borrower == address(0) || arbiter == address(0)) revert ZeroAddress();
        if (owner == borrower || owner == arbiter || borrower == arbiter) revert RolesMustBeDistinct();
        if (depositAmount == 0) revert ZeroDeposit();
        if (_deadlineReached(handoverDeadline)) revert InvalidHandoverDeadline();
        if (returnDeadline <= handoverDeadline) revert InvalidReturnDeadline();
        if (inspectionPeriod == 0) revert ZeroInspectionPeriod();
        if (claimResponsePeriod == 0) revert ZeroClaimResponsePeriod();
        if (bytes(itemName).length == 0) revert EmptyItemName();
        if (bytes(itemMetadataURI).length == 0) revert EmptyMetadataURI();

        agreementId = _nextAgreementId++;
        Agreement storage agreement = _agreements[agreementId];
        agreement.id = agreementId;
        agreement.owner = owner;
        agreement.borrower = borrower;
        agreement.arbiter = arbiter;
        agreement.itemName = itemName;
        agreement.itemMetadataURI = itemMetadataURI;
        agreement.depositAmount = depositAmount;
        agreement.handoverDeadline = handoverDeadline;
        agreement.returnDeadline = returnDeadline;
        agreement.inspectionPeriod = inspectionPeriod;
        agreement.claimResponsePeriod = claimResponsePeriod;
        agreement.status = Status.Created;

        _ownerAgreementIds[owner].push(agreementId);
        _borrowerAgreementIds[borrower].push(agreementId);
        _arbiterAgreementIds[arbiter].push(agreementId);

        _emitAgreementCreated(agreement);
    }

    function cancelAgreement(uint256 agreementId) external {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.owner);
        _requireStatus(agreement, Status.Created);

        agreement.status = Status.Cancelled;
        emit AgreementCancelled(agreementId, agreement.owner, msg.sender, false);
    }

    function fundAgreement(uint256 agreementId) external payable {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.borrower);
        _requireStatus(agreement, Status.Created);
        if (_deadlineReached(agreement.handoverDeadline)) {
            revert DeadlineExpired(agreementId, agreement.handoverDeadline);
        }
        if (msg.value != agreement.depositAmount) revert IncorrectDeposit(agreement.depositAmount, msg.value);

        uint64 timestamp = _timestamp();
        agreement.status = Status.Funded;
        agreement.fundingTimestamp = timestamp;
        emit AgreementFunded(agreementId, msg.sender, msg.value, timestamp);
    }

    function confirmHandover(uint256 agreementId) external {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.owner);
        _requireStatus(agreement, Status.Funded);
        if (_deadlineReached(agreement.handoverDeadline)) {
            revert DeadlineExpired(agreementId, agreement.handoverDeadline);
        }

        uint64 timestamp = _timestamp();
        agreement.status = Status.Active;
        agreement.handoverTimestamp = timestamp;
        emit HandoverConfirmed(agreementId, msg.sender, timestamp);
    }

    function refundUnhandedAgreement(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.borrower);
        _requireStatus(agreement, Status.Funded);
        if (!_deadlineReached(agreement.handoverDeadline)) {
            revert DeadlineNotReached(agreementId, agreement.handoverDeadline);
        }

        agreement.status = Status.Cancelled;
        _sendNative(agreement.borrower, agreement.depositAmount);
        emit AgreementCancelled(agreementId, agreement.owner, msg.sender, true);
    }

    function requestReturn(uint256 agreementId, string calldata returnProofURI) external {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.borrower);
        _requireStatus(agreement, Status.Active);
        if (bytes(returnProofURI).length == 0) revert EmptyReturnProofURI();

        uint64 timestamp = _timestamp();
        agreement.status = Status.ReturnRequested;
        agreement.returnRequestTimestamp = timestamp;
        agreement.returnProofURI = returnProofURI;
        emit ReturnRequested(agreementId, msg.sender, returnProofURI, timestamp);
    }

    function confirmSuccessfulReturn(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.owner);
        _requireStatus(agreement, Status.ReturnRequested);
        uint256 deadline = _inspectionDeadline(agreement);
        if (_deadlineReached(deadline)) revert DeadlineExpired(agreementId, deadline);

        agreement.status = Status.Refunded;
        _sendNative(agreement.borrower, agreement.depositAmount);
        emit ReturnConfirmed(agreementId, msg.sender, agreement.borrower, agreement.depositAmount, false);
    }

    function finalizeUnansweredReturn(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.borrower);
        _requireStatus(agreement, Status.ReturnRequested);
        uint256 deadline = _inspectionDeadline(agreement);
        if (!_deadlineReached(deadline)) revert DeadlineNotReached(agreementId, deadline);

        agreement.status = Status.Refunded;
        _sendNative(agreement.borrower, agreement.depositAmount);
        emit ReturnConfirmed(agreementId, msg.sender, agreement.borrower, agreement.depositAmount, true);
    }

    function raiseDamageClaim(uint256 agreementId, uint256 claimAmount, string calldata claimEvidenceURI) external {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.owner);
        _requireStatus(agreement, Status.ReturnRequested);
        uint256 deadline = _inspectionDeadline(agreement);
        if (_deadlineReached(deadline)) revert DeadlineExpired(agreementId, deadline);

        _raiseClaim(agreement, claimAmount, claimEvidenceURI, false);
    }

    function raiseOverdueClaim(uint256 agreementId, uint256 claimAmount, string calldata claimEvidenceURI) external {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.owner);
        _requireStatus(agreement, Status.Active);
        if (!_deadlineReached(agreement.returnDeadline)) {
            revert DeadlineNotReached(agreementId, agreement.returnDeadline);
        }

        _raiseClaim(agreement, claimAmount, claimEvidenceURI, true);
    }

    function acceptClaim(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.borrower);
        _requireStatus(agreement, Status.ClaimRequested);
        uint256 deadline = _claimResponseDeadline(agreement);
        if (_deadlineReached(deadline)) revert DeadlineExpired(agreementId, deadline);

        uint256 ownerAward = agreement.claimAmount;
        uint256 borrowerRefund = agreement.depositAmount - ownerAward;
        agreement.status = Status.Claimed;
        _distribute(agreement, ownerAward, borrowerRefund);
        emit ClaimAccepted(agreementId, agreement.borrower, agreement.owner, ownerAward, borrowerRefund);
    }

    function disputeClaim(uint256 agreementId) external {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.borrower);
        _requireStatus(agreement, Status.ClaimRequested);
        uint256 deadline = _claimResponseDeadline(agreement);
        if (_deadlineReached(deadline)) revert DeadlineExpired(agreementId, deadline);

        agreement.status = Status.Disputed;
        emit ClaimDisputed(agreementId, agreement.borrower, agreement.arbiter);
    }

    function finalizeUnansweredClaim(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.owner);
        _requireStatus(agreement, Status.ClaimRequested);
        uint256 deadline = _claimResponseDeadline(agreement);
        if (!_deadlineReached(deadline)) revert DeadlineNotReached(agreementId, deadline);

        uint256 ownerAward = agreement.claimAmount;
        uint256 borrowerRefund = agreement.depositAmount - ownerAward;
        agreement.status = Status.Claimed;
        _distribute(agreement, ownerAward, borrowerRefund);
        emit ClaimFinalized(agreementId, agreement.owner, agreement.borrower, ownerAward, borrowerRefund);
    }

    function resolveDispute(uint256 agreementId, uint256 ownerAward) external nonReentrant {
        Agreement storage agreement = _agreement(agreementId);
        _requireRole(agreementId, msg.sender, agreement.arbiter);
        _requireStatus(agreement, Status.Disputed);
        if (ownerAward > agreement.depositAmount) {
            revert InvalidClaimAmount(ownerAward, agreement.depositAmount);
        }

        uint256 borrowerRefund = agreement.depositAmount - ownerAward;
        agreement.status = ownerAward == 0 ? Status.Refunded : Status.Claimed;
        _distribute(agreement, ownerAward, borrowerRefund);
        emit DisputeResolved(
            agreementId, agreement.arbiter, agreement.owner, agreement.borrower, ownerAward, borrowerRefund
        );
    }

    function getAgreement(uint256 agreementId) external view returns (Agreement memory) {
        Agreement storage agreement = _agreement(agreementId);
        return agreement;
    }

    function getOwnerAgreementIds(address owner) external view returns (uint256[] memory) {
        return _ownerAgreementIds[owner];
    }

    function getBorrowerAgreementIds(address borrower) external view returns (uint256[] memory) {
        return _borrowerAgreementIds[borrower];
    }

    function getArbiterAgreementIds(address arbiter) external view returns (uint256[] memory) {
        return _arbiterAgreementIds[arbiter];
    }

    function totalAgreementCount() external view returns (uint256) {
        return _nextAgreementId - 1;
    }

    function _agreement(uint256 agreementId) private view returns (Agreement storage agreement) {
        agreement = _agreements[agreementId];
        if (agreement.id == 0) revert AgreementNotFound(agreementId);
    }

    function _requireRole(uint256 agreementId, address caller, address requiredRole) private pure {
        if (caller != requiredRole) revert Unauthorized(agreementId, caller);
    }

    function _requireStatus(Agreement storage agreement, Status expected) private view {
        if (agreement.status != expected) revert InvalidStatus(agreement.id, expected, agreement.status);
    }

    function _raiseClaim(
        Agreement storage agreement,
        uint256 claimAmount,
        string calldata claimEvidenceURI,
        bool overdue
    ) private {
        if (claimAmount == 0 || claimAmount > agreement.depositAmount) {
            revert InvalidClaimAmount(claimAmount, agreement.depositAmount);
        }
        if (bytes(claimEvidenceURI).length == 0) revert EmptyClaimEvidenceURI();

        uint64 timestamp = _timestamp();
        agreement.status = Status.ClaimRequested;
        agreement.claimCreationTimestamp = timestamp;
        agreement.claimAmount = claimAmount;
        agreement.claimEvidenceURI = claimEvidenceURI;
        emit ClaimRaised(agreement.id, agreement.owner, claimAmount, claimEvidenceURI, overdue, timestamp);
    }

    function _inspectionDeadline(Agreement storage agreement) private view returns (uint256) {
        return uint256(agreement.returnRequestTimestamp) + uint256(agreement.inspectionPeriod);
    }

    function _emitAgreementCreated(Agreement storage agreement) private {
        emit AgreementCreated(
            agreement.id, agreement.owner, agreement.borrower, agreement.arbiter, agreement.depositAmount
        );
    }

    function _claimResponseDeadline(Agreement storage agreement) private view returns (uint256) {
        return uint256(agreement.claimCreationTimestamp) + uint256(agreement.claimResponsePeriod);
    }

    function _distribute(Agreement storage agreement, uint256 ownerAward, uint256 borrowerRefund) private {
        if (ownerAward != 0) _sendNative(agreement.owner, ownerAward);
        if (borrowerRefund != 0) _sendNative(agreement.borrower, borrowerRefund);
    }

    function _sendNative(address recipient, uint256 amount) private {
        (bool success,) = payable(recipient).call{value: amount}("");
        if (!success) revert NativeTransferFailed(recipient, amount);
    }

    function _timestamp() private view returns (uint64) {
        uint256 currentTimestamp = _clock();
        if (currentTimestamp > type(uint64).max) revert TimestampOverflow();
        // The explicit upper-bound check above proves this conversion cannot truncate.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint64(currentTimestamp);
    }

    function _deadlineReached(uint256 deadline) private view returns (bool) {
        return _clock() >= deadline;
    }

    function _clock() private view returns (uint256) {
        return block.timestamp;
    }
}
