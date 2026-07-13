// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {ReturnBond} from "../src/ReturnBond.sol";

contract ReentrantParticipant {
    ReturnBond private immutable _returnBond;
    bytes private _reentryCall;

    bool public rejectTransfers;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryError;

    constructor(ReturnBond returnBond_) {
        _returnBond = returnBond_;
    }

    function execute(bytes calldata callData) external payable returns (bytes memory result) {
        (bool success, bytes memory returnData) = address(_returnBond).call{value: msg.value}(callData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return returnData;
    }

    function configureReentry(bytes calldata callData) external {
        _reentryCall = callData;
        reentryAttempted = false;
        reentrySucceeded = false;
        reentryError = bytes4(0);
    }

    function setRejectTransfers(bool shouldReject) external {
        rejectTransfers = shouldReject;
    }

    receive() external payable {
        if (rejectTransfers) revert();
        if (_reentryCall.length != 0 && !reentryAttempted) {
            reentryAttempted = true;
            bytes memory callData = _reentryCall;
            bytes memory returnData;
            (reentrySucceeded, returnData) = address(_returnBond).call(callData);
            if (returnData.length >= 4) {
                bytes4 selector;
                assembly ("memory-safe") {
                    selector := mload(add(returnData, 0x20))
                }
                reentryError = selector;
            }
        }
    }
}

contract ReturnBondTest is Test {
    ReturnBond private returnBond;

    address private constant OWNER = address(0xA11CE);
    address private constant BORROWER = address(0xB0B);
    address private constant ARBITER = address(0xA4B17E4);
    address private constant OUTSIDER = address(0xBAD);

    uint256 private constant DEPOSIT = 10 ether;
    uint64 private constant INSPECTION_PERIOD = 2 days;
    uint64 private constant CLAIM_RESPONSE_PERIOD = 1 days;
    string private constant ITEM_NAME = "Camera";
    string private constant ITEM_METADATA_URI = "ipfs://camera-metadata";
    string private constant RETURN_PROOF_URI = "ipfs://return-proof";
    string private constant CLAIM_EVIDENCE_URI = "ipfs://damage-evidence";

    uint64 private handoverDeadline;
    uint64 private returnDeadline;

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

    function setUp() external {
        vm.warp(1_000_000);
        returnBond = new ReturnBond();
        handoverDeadline = uint64(block.timestamp + 1 days);
        returnDeadline = uint64(block.timestamp + 7 days);
        vm.deal(OWNER, 1_000 ether);
        vm.deal(BORROWER, 1_000 ether);
    }

    function testCreateAgreementStoresDataEmitsEventAndIndexesRoles() external {
        vm.expectEmit(true, true, true, true);
        emit AgreementCreated(1, OWNER, BORROWER, ARBITER, DEPOSIT);
        uint256 agreementId = _createAgreement();

        ReturnBond.Agreement memory agreement = returnBond.getAgreement(agreementId);
        assertEq(agreement.id, 1);
        assertEq(agreement.owner, OWNER);
        assertEq(agreement.borrower, BORROWER);
        assertEq(agreement.arbiter, ARBITER);
        assertEq(agreement.itemName, ITEM_NAME);
        assertEq(agreement.itemMetadataURI, ITEM_METADATA_URI);
        assertEq(agreement.depositAmount, DEPOSIT);
        assertEq(agreement.handoverDeadline, handoverDeadline);
        assertEq(agreement.returnDeadline, returnDeadline);
        assertEq(agreement.inspectionPeriod, INSPECTION_PERIOD);
        assertEq(agreement.claimResponsePeriod, CLAIM_RESPONSE_PERIOD);
        assertEq(uint256(agreement.status), uint256(ReturnBond.Status.Created));
        assertEq(returnBond.totalAgreementCount(), 1);
        assertEq(returnBond.getOwnerAgreementIds(OWNER), _singleId(1));
        assertEq(returnBond.getBorrowerAgreementIds(BORROWER), _singleId(1));
        assertEq(returnBond.getArbiterAgreementIds(ARBITER), _singleId(1));
    }

    function testAgreementIdsAreUniqueAndSequential() external {
        assertEq(_createAgreement(), 1);
        assertEq(_createAgreement(), 2);
        assertEq(returnBond.totalAgreementCount(), 2);
    }

    function testGetUnknownAgreementReverts() external {
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.AgreementNotFound.selector, 99));
        returnBond.getAgreement(99);
    }

    function testCreateRejectsZeroBorrower() external {
        _expectCreateRevert(
            ReturnBond.ZeroAddress.selector,
            address(0),
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsZeroArbiter() external {
        _expectCreateRevert(
            ReturnBond.ZeroAddress.selector,
            BORROWER,
            address(0),
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsOwnerAsBorrower() external {
        _expectCreateRevert(
            ReturnBond.RolesMustBeDistinct.selector,
            OWNER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsOwnerAsArbiter() external {
        _expectCreateRevert(
            ReturnBond.RolesMustBeDistinct.selector,
            BORROWER,
            OWNER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsBorrowerAsArbiter() external {
        _expectCreateRevert(
            ReturnBond.RolesMustBeDistinct.selector,
            BORROWER,
            BORROWER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsZeroDeposit() external {
        _expectCreateRevert(
            ReturnBond.ZeroDeposit.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            0,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsPastOrCurrentHandoverDeadline() external {
        _expectCreateRevert(
            ReturnBond.InvalidHandoverDeadline.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            uint64(block.timestamp),
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsReturnDeadlineNotAfterHandover() external {
        _expectCreateRevert(
            ReturnBond.InvalidReturnDeadline.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            handoverDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsZeroInspectionPeriod() external {
        _expectCreateRevert(
            ReturnBond.ZeroInspectionPeriod.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            0,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsZeroClaimResponsePeriod() external {
        _expectCreateRevert(
            ReturnBond.ZeroClaimResponsePeriod.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            0
        );
    }

    function testCreateRejectsEmptyItemName() external {
        _expectCreateRevert(
            ReturnBond.EmptyItemName.selector,
            BORROWER,
            ARBITER,
            "",
            ITEM_METADATA_URI,
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testCreateRejectsEmptyMetadataURI() external {
        _expectCreateRevert(
            ReturnBond.EmptyMetadataURI.selector,
            BORROWER,
            ARBITER,
            ITEM_NAME,
            "",
            DEPOSIT,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function testOwnerCanCancelUnfundedAgreement() external {
        uint256 agreementId = _createAgreement();
        vm.expectEmit(true, true, true, true);
        emit AgreementCancelled(agreementId, OWNER, OWNER, false);
        vm.prank(OWNER);
        returnBond.cancelAgreement(agreementId);
        _assertStatus(agreementId, ReturnBond.Status.Cancelled);
    }

    function testOnlyOwnerCanCancelAndFundedAgreementCannotBeCancelled() external {
        uint256 agreementId = _createAgreement();
        _expectUnauthorized(agreementId, OUTSIDER);
        vm.prank(OUTSIDER);
        returnBond.cancelAgreement(agreementId);

        _fund(agreementId, DEPOSIT, BORROWER);
        _expectStatus(agreementId, ReturnBond.Status.Created, ReturnBond.Status.Funded);
        vm.prank(OWNER);
        returnBond.cancelAgreement(agreementId);
    }

    function testBorrowerFundsExactDepositOnce() external {
        uint256 agreementId = _createAgreement();
        vm.expectEmit(true, true, false, true);
        emit AgreementFunded(agreementId, BORROWER, DEPOSIT, uint64(block.timestamp));
        _fund(agreementId, DEPOSIT, BORROWER);

        ReturnBond.Agreement memory agreement = returnBond.getAgreement(agreementId);
        assertEq(uint256(agreement.status), uint256(ReturnBond.Status.Funded));
        assertEq(agreement.fundingTimestamp, block.timestamp);
        assertEq(address(returnBond).balance, DEPOSIT);

        _expectStatus(agreementId, ReturnBond.Status.Created, ReturnBond.Status.Funded);
        _fund(agreementId, DEPOSIT, BORROWER);
    }

    function testBorrowerCanFundOneSecondBeforeHandoverDeadline() external {
        uint256 agreementId = _createAgreement();
        vm.warp(uint256(handoverDeadline) - 1);

        _fund(agreementId, DEPOSIT, BORROWER);

        _assertStatus(agreementId, ReturnBond.Status.Funded);
        assertEq(address(returnBond).balance, DEPOSIT);
    }

    function testFundingAtHandoverDeadlineRevertsWithoutChangingStateOrBalance() external {
        uint256 agreementId = _createAgreement();
        uint256 balanceBefore = address(returnBond).balance;
        vm.warp(handoverDeadline);

        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineExpired.selector, agreementId, handoverDeadline));
        _fund(agreementId, DEPOSIT, BORROWER);

        _assertStatus(agreementId, ReturnBond.Status.Created);
        assertEq(address(returnBond).balance, balanceBefore);
    }

    function testFundingAfterHandoverDeadlineRevertsWithoutChangingStateOrBalance() external {
        uint256 agreementId = _createAgreement();
        uint256 balanceBefore = address(returnBond).balance;
        vm.warp(uint256(handoverDeadline) + 1);

        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineExpired.selector, agreementId, handoverDeadline));
        _fund(agreementId, DEPOSIT, BORROWER);

        _assertStatus(agreementId, ReturnBond.Status.Created);
        assertEq(address(returnBond).balance, balanceBefore);
    }

    function testFundingRejectsWrongRoleAndIncorrectAmounts() external {
        uint256 agreementId = _createAgreement();
        _expectUnauthorized(agreementId, OWNER);
        _fund(agreementId, DEPOSIT, OWNER);

        vm.expectRevert(abi.encodeWithSelector(ReturnBond.IncorrectDeposit.selector, DEPOSIT, DEPOSIT - 1));
        _fund(agreementId, DEPOSIT - 1, BORROWER);
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.IncorrectDeposit.selector, DEPOSIT, DEPOSIT + 1));
        _fund(agreementId, DEPOSIT + 1, BORROWER);
    }

    function testOwnerConfirmsHandoverBeforeDeadline() external {
        uint256 agreementId = _fundedAgreement();
        vm.expectEmit(true, true, false, true);
        emit HandoverConfirmed(agreementId, OWNER, uint64(block.timestamp));
        vm.prank(OWNER);
        returnBond.confirmHandover(agreementId);
        ReturnBond.Agreement memory agreement = returnBond.getAgreement(agreementId);
        assertEq(uint256(agreement.status), uint256(ReturnBond.Status.Active));
        assertEq(agreement.handoverTimestamp, block.timestamp);
    }

    function testHandoverRejectsWrongRoleInvalidStatusAndDeadlineBoundary() external {
        uint256 agreementId = _fundedAgreement();
        uint256 createdId = _createAgreement();
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        returnBond.confirmHandover(agreementId);

        vm.warp(handoverDeadline);
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineExpired.selector, agreementId, handoverDeadline));
        vm.prank(OWNER);
        returnBond.confirmHandover(agreementId);

        _expectStatus(createdId, ReturnBond.Status.Funded, ReturnBond.Status.Created);
        vm.prank(OWNER);
        returnBond.confirmHandover(createdId);
    }

    function testBorrowerRefundsMissedHandoverAtDeadline() external {
        uint256 agreementId = _fundedAgreement();
        uint256 balanceBefore = BORROWER.balance;
        vm.warp(handoverDeadline);
        vm.expectEmit(true, true, true, true);
        emit AgreementCancelled(agreementId, OWNER, BORROWER, true);
        vm.prank(BORROWER);
        returnBond.refundUnhandedAgreement(agreementId);
        assertEq(BORROWER.balance, balanceBefore + DEPOSIT);
        assertEq(address(returnBond).balance, 0);
        _assertStatus(agreementId, ReturnBond.Status.Cancelled);
    }

    function testMissedHandoverRefundRejectsWrongRoleAndEarlyCall() external {
        uint256 agreementId = _fundedAgreement();
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        returnBond.refundUnhandedAgreement(agreementId);

        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineNotReached.selector, agreementId, handoverDeadline));
        vm.prank(BORROWER);
        returnBond.refundUnhandedAgreement(agreementId);
    }

    function testBorrowerRequestsReturnWithProof() external {
        uint256 agreementId = _activeAgreement();
        vm.expectEmit(true, true, false, true);
        emit ReturnRequested(agreementId, BORROWER, RETURN_PROOF_URI, uint64(block.timestamp));
        vm.prank(BORROWER);
        returnBond.requestReturn(agreementId, RETURN_PROOF_URI);
        ReturnBond.Agreement memory agreement = returnBond.getAgreement(agreementId);
        assertEq(uint256(agreement.status), uint256(ReturnBond.Status.ReturnRequested));
        assertEq(agreement.returnRequestTimestamp, block.timestamp);
        assertEq(agreement.returnProofURI, RETURN_PROOF_URI);
    }

    function testReturnRequestRejectsWrongRoleEmptyProofAndInvalidStatus() external {
        uint256 agreementId = _activeAgreement();
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        returnBond.requestReturn(agreementId, RETURN_PROOF_URI);

        vm.expectRevert(ReturnBond.EmptyReturnProofURI.selector);
        vm.prank(BORROWER);
        returnBond.requestReturn(agreementId, "");

        uint256 fundedId = _fundedAgreement();
        _expectStatus(fundedId, ReturnBond.Status.Active, ReturnBond.Status.Funded);
        vm.prank(BORROWER);
        returnBond.requestReturn(fundedId, RETURN_PROOF_URI);
    }

    function testOwnerConfirmsSuccessfulReturnAndRefundsDeposit() external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 balanceBefore = BORROWER.balance;
        vm.expectEmit(true, true, true, true);
        emit ReturnConfirmed(agreementId, OWNER, BORROWER, DEPOSIT, false);
        vm.prank(OWNER);
        returnBond.confirmSuccessfulReturn(agreementId);
        assertEq(BORROWER.balance, balanceBefore + DEPOSIT);
        _assertStatus(agreementId, ReturnBond.Status.Refunded);
    }

    function testSuccessfulReturnRejectsWrongRoleAndInspectionDeadlineBoundary() external {
        uint256 agreementId = _returnRequestedAgreement();
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        returnBond.confirmSuccessfulReturn(agreementId);

        vm.warp(block.timestamp + INSPECTION_PERIOD);
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineExpired.selector, agreementId, block.timestamp));
        vm.prank(OWNER);
        returnBond.confirmSuccessfulReturn(agreementId);
    }

    function testBorrowerFinalizesUnansweredReturnAtInspectionDeadline() external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 balanceBefore = BORROWER.balance;
        vm.warp(block.timestamp + INSPECTION_PERIOD);
        vm.expectEmit(true, true, true, true);
        emit ReturnConfirmed(agreementId, BORROWER, BORROWER, DEPOSIT, true);
        vm.prank(BORROWER);
        returnBond.finalizeUnansweredReturn(agreementId);
        assertEq(BORROWER.balance, balanceBefore + DEPOSIT);
        _assertStatus(agreementId, ReturnBond.Status.Refunded);
    }

    function testUnansweredReturnFinalizationRejectsWrongRoleAndEarlyCall() external {
        uint256 agreementId = _returnRequestedAgreement();
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        returnBond.finalizeUnansweredReturn(agreementId);

        uint256 deadline = block.timestamp + INSPECTION_PERIOD;
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineNotReached.selector, agreementId, deadline));
        vm.prank(BORROWER);
        returnBond.finalizeUnansweredReturn(agreementId);
    }

    function testOwnerRaisesPartialDamageClaim() external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 claimAmount = 4 ether;
        vm.expectEmit(true, true, false, true);
        emit ClaimRaised(agreementId, OWNER, claimAmount, CLAIM_EVIDENCE_URI, false, uint64(block.timestamp));
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, claimAmount, CLAIM_EVIDENCE_URI);
        _assertClaim(agreementId, claimAmount, false);
    }

    function testDamageClaimRejectsWrongRoleInvalidAmountEmptyEvidenceAndExpiredWindow() external {
        uint256 agreementId = _returnRequestedAgreement();
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        returnBond.raiseDamageClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);

        vm.expectRevert(abi.encodeWithSelector(ReturnBond.InvalidClaimAmount.selector, 0, DEPOSIT));
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, 0, CLAIM_EVIDENCE_URI);
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.InvalidClaimAmount.selector, DEPOSIT + 1, DEPOSIT));
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, DEPOSIT + 1, CLAIM_EVIDENCE_URI);
        vm.expectRevert(ReturnBond.EmptyClaimEvidenceURI.selector);
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, 1 ether, "");

        vm.warp(block.timestamp + INSPECTION_PERIOD);
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineExpired.selector, agreementId, block.timestamp));
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);
    }

    function testOwnerRaisesOverdueClaimAtReturnDeadline() external {
        uint256 agreementId = _activeAgreement();
        vm.warp(returnDeadline);
        vm.expectEmit(true, true, false, true);
        emit ClaimRaised(agreementId, OWNER, DEPOSIT, CLAIM_EVIDENCE_URI, true, uint64(block.timestamp));
        vm.prank(OWNER);
        returnBond.raiseOverdueClaim(agreementId, DEPOSIT, CLAIM_EVIDENCE_URI);
        _assertClaim(agreementId, DEPOSIT, true);
    }

    function testOverdueClaimRejectsWrongRoleEarlyCallInvalidAmountAndEvidence() external {
        uint256 agreementId = _activeAgreement();
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        returnBond.raiseOverdueClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);

        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineNotReached.selector, agreementId, returnDeadline));
        vm.prank(OWNER);
        returnBond.raiseOverdueClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);

        vm.warp(returnDeadline);
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.InvalidClaimAmount.selector, 0, DEPOSIT));
        vm.prank(OWNER);
        returnBond.raiseOverdueClaim(agreementId, 0, CLAIM_EVIDENCE_URI);
        vm.expectRevert(ReturnBond.EmptyClaimEvidenceURI.selector);
        vm.prank(OWNER);
        returnBond.raiseOverdueClaim(agreementId, 1 ether, "");
    }

    function testBorrowerAcceptsPartialClaimAndConservesPayout() external {
        uint256 claimAmount = 4 ether;
        uint256 agreementId = _claimRequestedAgreement(claimAmount);
        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.expectEmit(true, true, true, true);
        emit ClaimAccepted(agreementId, BORROWER, OWNER, claimAmount, DEPOSIT - claimAmount);
        vm.prank(BORROWER);
        returnBond.acceptClaim(agreementId);
        assertEq(OWNER.balance - ownerBefore, claimAmount);
        assertEq(BORROWER.balance - borrowerBefore, DEPOSIT - claimAmount);
        assertEq(address(returnBond).balance, 0);
        _assertStatus(agreementId, ReturnBond.Status.Claimed);
    }

    function testBorrowerAcceptsFullClaim() external {
        uint256 agreementId = _claimRequestedAgreement(DEPOSIT);
        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.prank(BORROWER);
        returnBond.acceptClaim(agreementId);
        assertEq(OWNER.balance - ownerBefore, DEPOSIT);
        assertEq(BORROWER.balance, borrowerBefore);
    }

    function testClaimAcceptanceRejectsWrongRoleAndResponseDeadlineBoundary() external {
        uint256 agreementId = _claimRequestedAgreement(4 ether);
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        returnBond.acceptClaim(agreementId);

        vm.warp(block.timestamp + CLAIM_RESPONSE_PERIOD);
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineExpired.selector, agreementId, block.timestamp));
        vm.prank(BORROWER);
        returnBond.acceptClaim(agreementId);
    }

    function testBorrowerDisputesClaim() external {
        uint256 agreementId = _claimRequestedAgreement(4 ether);
        vm.expectEmit(true, true, true, true);
        emit ClaimDisputed(agreementId, BORROWER, ARBITER);
        vm.prank(BORROWER);
        returnBond.disputeClaim(agreementId);
        _assertStatus(agreementId, ReturnBond.Status.Disputed);
    }

    function testClaimDisputeRejectsWrongRoleAndResponseDeadlineBoundary() external {
        uint256 agreementId = _claimRequestedAgreement(4 ether);
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        returnBond.disputeClaim(agreementId);

        vm.warp(block.timestamp + CLAIM_RESPONSE_PERIOD);
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineExpired.selector, agreementId, block.timestamp));
        vm.prank(BORROWER);
        returnBond.disputeClaim(agreementId);
    }

    function testOwnerFinalizesUnansweredPartialClaimAtDeadline() external {
        uint256 claimAmount = 4 ether;
        uint256 agreementId = _claimRequestedAgreement(claimAmount);
        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.warp(block.timestamp + CLAIM_RESPONSE_PERIOD);
        vm.expectEmit(true, true, true, true);
        emit ClaimFinalized(agreementId, OWNER, BORROWER, claimAmount, DEPOSIT - claimAmount);
        vm.prank(OWNER);
        returnBond.finalizeUnansweredClaim(agreementId);
        assertEq(OWNER.balance - ownerBefore, claimAmount);
        assertEq(BORROWER.balance - borrowerBefore, DEPOSIT - claimAmount);
        _assertStatus(agreementId, ReturnBond.Status.Claimed);
    }

    function testUnansweredClaimFinalizationRejectsWrongRoleAndEarlyCall() external {
        uint256 agreementId = _claimRequestedAgreement(4 ether);
        _expectUnauthorized(agreementId, BORROWER);
        vm.prank(BORROWER);
        returnBond.finalizeUnansweredClaim(agreementId);

        uint256 deadline = block.timestamp + CLAIM_RESPONSE_PERIOD;
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.DeadlineNotReached.selector, agreementId, deadline));
        vm.prank(OWNER);
        returnBond.finalizeUnansweredClaim(agreementId);
    }

    function testArbiterResolvesDisputeWithZeroAwardAsRefunded() external {
        _assertDisputeResolution(0, ReturnBond.Status.Refunded);
    }

    function testArbiterResolvesDisputeWithPartialAwardAsClaimed() external {
        _assertDisputeResolution(4 ether, ReturnBond.Status.Claimed);
    }

    function testArbiterResolvesDisputeWithFullAwardAsClaimed() external {
        _assertDisputeResolution(DEPOSIT, ReturnBond.Status.Claimed);
    }

    function testDisputeResolutionRejectsWrongRoleInvalidStatusAndExcessAward() external {
        uint256 agreementId = _disputedAgreement(4 ether);
        _expectUnauthorized(agreementId, OWNER);
        vm.prank(OWNER);
        returnBond.resolveDispute(agreementId, 1 ether);

        vm.expectRevert(abi.encodeWithSelector(ReturnBond.InvalidClaimAmount.selector, DEPOSIT + 1, DEPOSIT));
        vm.prank(ARBITER);
        returnBond.resolveDispute(agreementId, DEPOSIT + 1);

        uint256 claimId = _claimRequestedAgreement(1 ether);
        _expectStatus(claimId, ReturnBond.Status.Disputed, ReturnBond.Status.ClaimRequested);
        vm.prank(ARBITER);
        returnBond.resolveDispute(claimId, 1 ether);
    }

    function testTerminalAgreementCannotTransitionAgain() external {
        uint256 agreementId = _returnRequestedAgreement();
        vm.prank(OWNER);
        returnBond.confirmSuccessfulReturn(agreementId);
        _expectStatus(agreementId, ReturnBond.Status.ReturnRequested, ReturnBond.Status.Refunded);
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, 1 ether, CLAIM_EVIDENCE_URI);
    }

    function testForcedNativeTokenDoesNotAffectAgreementAccounting() external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 forcedAmount = 3 ether;
        vm.deal(address(returnBond), DEPOSIT + forcedAmount);
        uint256 borrowerBefore = BORROWER.balance;

        vm.prank(OWNER);
        returnBond.confirmSuccessfulReturn(agreementId);

        assertEq(BORROWER.balance - borrowerBefore, DEPOSIT);
        assertEq(address(returnBond).balance, forcedAmount);
    }

    function testRejectingReceiverRevertsPayoutAndPreservesState() external {
        ReentrantParticipant receiver = new ReentrantParticipant(returnBond);
        uint256 agreementId = _returnRequestedAgreementWithBorrower(address(receiver));
        receiver.setRejectTransfers(true);

        vm.expectRevert(abi.encodeWithSelector(ReturnBond.NativeTransferFailed.selector, address(receiver), DEPOSIT));
        vm.prank(OWNER);
        returnBond.confirmSuccessfulReturn(agreementId);
        _assertStatus(agreementId, ReturnBond.Status.ReturnRequested);
        assertEq(address(returnBond).balance, DEPOSIT);
    }

    function testReentrancyBlockedOnMissedHandoverRefund() external {
        ReentrantParticipant receiver = new ReentrantParticipant(returnBond);
        uint256 agreementId = _fundedAgreementWithBorrower(address(receiver));
        receiver.configureReentry(abi.encodeCall(ReturnBond.refundUnhandedAgreement, (agreementId)));
        vm.warp(handoverDeadline);
        receiver.execute(abi.encodeCall(ReturnBond.refundUnhandedAgreement, (agreementId)));
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnSuccessfulReturnConfirmation() external {
        ReentrantParticipant receiver = new ReentrantParticipant(returnBond);
        uint256 agreementId = _returnRequestedAgreementWithBorrower(address(receiver));
        receiver.configureReentry(abi.encodeCall(ReturnBond.finalizeUnansweredReturn, (agreementId)));
        vm.prank(OWNER);
        returnBond.confirmSuccessfulReturn(agreementId);
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnUnansweredReturnFinalization() external {
        ReentrantParticipant receiver = new ReentrantParticipant(returnBond);
        uint256 agreementId = _returnRequestedAgreementWithBorrower(address(receiver));
        receiver.configureReentry(abi.encodeCall(ReturnBond.finalizeUnansweredReturn, (agreementId)));
        vm.warp(block.timestamp + INSPECTION_PERIOD);
        receiver.execute(abi.encodeCall(ReturnBond.finalizeUnansweredReturn, (agreementId)));
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnClaimAcceptance() external {
        ReentrantParticipant receiver = new ReentrantParticipant(returnBond);
        uint256 agreementId = _claimRequestedAgreementWithBorrower(address(receiver), 4 ether);
        receiver.configureReentry(abi.encodeCall(ReturnBond.acceptClaim, (agreementId)));
        receiver.execute(abi.encodeCall(ReturnBond.acceptClaim, (agreementId)));
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnUnansweredClaimFinalization() external {
        ReentrantParticipant receiver = new ReentrantParticipant(returnBond);
        uint256 agreementId = _claimRequestedAgreementWithBorrower(address(receiver), 4 ether);
        receiver.configureReentry(abi.encodeCall(ReturnBond.acceptClaim, (agreementId)));
        vm.warp(block.timestamp + CLAIM_RESPONSE_PERIOD);
        vm.prank(OWNER);
        returnBond.finalizeUnansweredClaim(agreementId);
        _assertReentryBlocked(receiver);
    }

    function testReentrancyBlockedOnDisputeResolution() external {
        ReentrantParticipant receiver = new ReentrantParticipant(returnBond);
        uint256 agreementId = _claimRequestedAgreementWithBorrower(address(receiver), 4 ether);
        receiver.execute(abi.encodeCall(ReturnBond.disputeClaim, (agreementId)));
        receiver.configureReentry(abi.encodeCall(ReturnBond.resolveDispute, (agreementId, 3 ether)));
        vm.prank(ARBITER);
        returnBond.resolveDispute(agreementId, 3 ether);
        _assertReentryBlocked(receiver);
    }

    function testFuzzDisputePayoutConservation(uint96 rawDeposit, uint96 rawAward) external {
        uint256 deposit = bound(uint256(rawDeposit), 1, 1_000 ether);
        uint256 award = bound(uint256(rawAward), 0, deposit);
        vm.deal(BORROWER, deposit);
        uint256 agreementId = _createAgreementWith(BORROWER, deposit);
        _fund(agreementId, deposit, BORROWER);
        vm.prank(OWNER);
        returnBond.confirmHandover(agreementId);
        vm.prank(BORROWER);
        returnBond.requestReturn(agreementId, RETURN_PROOF_URI);
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, deposit, CLAIM_EVIDENCE_URI);
        vm.prank(BORROWER);
        returnBond.disputeClaim(agreementId);

        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.prank(ARBITER);
        returnBond.resolveDispute(agreementId, award);

        assertEq(OWNER.balance - ownerBefore, award);
        assertEq(BORROWER.balance - borrowerBefore, deposit - award);
        assertEq((OWNER.balance - ownerBefore) + (BORROWER.balance - borrowerBefore), deposit);
        assertEq(address(returnBond).balance, 0);
    }

    function testFuzzExactDepositEnforcement(uint96 rawDeposit, uint96 rawPayment) external {
        uint256 deposit = bound(uint256(rawDeposit), 1, 1_000 ether);
        uint256 payment = bound(uint256(rawPayment), 0, 1_001 ether);
        vm.deal(BORROWER, payment);
        uint256 agreementId = _createAgreementWith(BORROWER, deposit);
        if (payment == deposit) {
            _fund(agreementId, payment, BORROWER);
            _assertStatus(agreementId, ReturnBond.Status.Funded);
        } else {
            vm.expectRevert(abi.encodeWithSelector(ReturnBond.IncorrectDeposit.selector, deposit, payment));
            _fund(agreementId, payment, BORROWER);
            _assertStatus(agreementId, ReturnBond.Status.Created);
        }
    }

    function testFuzzFundingBeforeHandoverDeadline(uint32 secondsBeforeDeadline) external {
        uint256 agreementId = _createAgreement();
        uint256 offset = bound(uint256(secondsBeforeDeadline), 1, 1 days);
        vm.warp(uint256(handoverDeadline) - offset);

        _fund(agreementId, DEPOSIT, BORROWER);

        _assertStatus(agreementId, ReturnBond.Status.Funded);
    }

    function testFuzzHandoverDeadlineBoundary(uint32 secondsBeforeDeadline) external {
        uint256 agreementId = _fundedAgreement();
        uint256 offset = bound(uint256(secondsBeforeDeadline), 1, 1 days);
        vm.warp(uint256(handoverDeadline) - offset);
        vm.prank(OWNER);
        returnBond.confirmHandover(agreementId);
        _assertStatus(agreementId, ReturnBond.Status.Active);
    }

    function testFuzzInspectionDeadlineBoundary(uint32 secondsBeforeDeadline) external {
        uint256 agreementId = _returnRequestedAgreement();
        uint256 offset = bound(uint256(secondsBeforeDeadline), 1, INSPECTION_PERIOD);
        vm.warp(block.timestamp + INSPECTION_PERIOD - offset);
        vm.prank(OWNER);
        returnBond.confirmSuccessfulReturn(agreementId);
        _assertStatus(agreementId, ReturnBond.Status.Refunded);
    }

    function _createAgreement() private returns (uint256) {
        return _createAgreementWith(BORROWER, DEPOSIT);
    }

    function _createAgreementWith(address borrower, uint256 deposit) private returns (uint256) {
        vm.prank(OWNER);
        return returnBond.createAgreement(
            borrower,
            ARBITER,
            ITEM_NAME,
            ITEM_METADATA_URI,
            deposit,
            handoverDeadline,
            returnDeadline,
            INSPECTION_PERIOD,
            CLAIM_RESPONSE_PERIOD
        );
    }

    function _fundedAgreement() private returns (uint256 agreementId) {
        agreementId = _createAgreement();
        _fund(agreementId, DEPOSIT, BORROWER);
    }

    function _fundedAgreementWithBorrower(address borrower) private returns (uint256 agreementId) {
        vm.deal(borrower, DEPOSIT);
        agreementId = _createAgreementWith(borrower, DEPOSIT);
        ReentrantParticipant(payable(borrower)).execute{value: DEPOSIT}(
            abi.encodeCall(ReturnBond.fundAgreement, (agreementId))
        );
    }

    function _activeAgreement() private returns (uint256 agreementId) {
        agreementId = _fundedAgreement();
        vm.prank(OWNER);
        returnBond.confirmHandover(agreementId);
    }

    function _activeAgreementWithBorrower(address borrower) private returns (uint256 agreementId) {
        agreementId = _fundedAgreementWithBorrower(borrower);
        vm.prank(OWNER);
        returnBond.confirmHandover(agreementId);
    }

    function _returnRequestedAgreement() private returns (uint256 agreementId) {
        agreementId = _activeAgreement();
        vm.prank(BORROWER);
        returnBond.requestReturn(agreementId, RETURN_PROOF_URI);
    }

    function _returnRequestedAgreementWithBorrower(address borrower) private returns (uint256 agreementId) {
        agreementId = _activeAgreementWithBorrower(borrower);
        ReentrantParticipant(payable(borrower))
            .execute(abi.encodeCall(ReturnBond.requestReturn, (agreementId, RETURN_PROOF_URI)));
    }

    function _claimRequestedAgreement(uint256 claimAmount) private returns (uint256 agreementId) {
        agreementId = _returnRequestedAgreement();
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, claimAmount, CLAIM_EVIDENCE_URI);
    }

    function _claimRequestedAgreementWithBorrower(address borrower, uint256 claimAmount)
        private
        returns (uint256 agreementId)
    {
        agreementId = _returnRequestedAgreementWithBorrower(borrower);
        vm.prank(OWNER);
        returnBond.raiseDamageClaim(agreementId, claimAmount, CLAIM_EVIDENCE_URI);
    }

    function _disputedAgreement(uint256 claimAmount) private returns (uint256 agreementId) {
        agreementId = _claimRequestedAgreement(claimAmount);
        vm.prank(BORROWER);
        returnBond.disputeClaim(agreementId);
    }

    function _fund(uint256 agreementId, uint256 amount, address borrower) private {
        vm.prank(borrower);
        returnBond.fundAgreement{value: amount}(agreementId);
    }

    function _assertDisputeResolution(uint256 award, ReturnBond.Status expectedStatus) private {
        uint256 agreementId = _disputedAgreement(4 ether);
        uint256 ownerBefore = OWNER.balance;
        uint256 borrowerBefore = BORROWER.balance;
        vm.expectEmit(true, true, true, true);
        emit DisputeResolved(agreementId, ARBITER, OWNER, BORROWER, award, DEPOSIT - award);
        vm.prank(ARBITER);
        returnBond.resolveDispute(agreementId, award);
        assertEq(OWNER.balance - ownerBefore, award);
        assertEq(BORROWER.balance - borrowerBefore, DEPOSIT - award);
        assertEq(address(returnBond).balance, 0);
        _assertStatus(agreementId, expectedStatus);
    }

    function _assertClaim(uint256 agreementId, uint256 amount, bool overdue) private view {
        ReturnBond.Agreement memory agreement = returnBond.getAgreement(agreementId);
        assertEq(uint256(agreement.status), uint256(ReturnBond.Status.ClaimRequested));
        assertEq(agreement.claimCreationTimestamp, block.timestamp);
        assertEq(agreement.claimAmount, amount);
        assertEq(agreement.claimEvidenceURI, CLAIM_EVIDENCE_URI);
        if (overdue) assertEq(agreement.returnRequestTimestamp, 0);
    }

    function _assertReentryBlocked(ReentrantParticipant participant) private view {
        assertTrue(participant.reentryAttempted());
        assertFalse(participant.reentrySucceeded());
        assertEq(participant.reentryError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function _assertStatus(uint256 agreementId, ReturnBond.Status expected) private view {
        assertEq(uint256(returnBond.getAgreement(agreementId).status), uint256(expected));
    }

    function _expectUnauthorized(uint256 agreementId, address caller) private {
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.Unauthorized.selector, agreementId, caller));
    }

    function _expectStatus(uint256 agreementId, ReturnBond.Status expected, ReturnBond.Status actual) private {
        vm.expectRevert(abi.encodeWithSelector(ReturnBond.InvalidStatus.selector, agreementId, expected, actual));
    }

    function _expectCreateRevert(
        bytes4 selector,
        address borrower,
        address arbiter,
        string memory itemName,
        string memory metadataURI,
        uint256 deposit,
        uint64 handover,
        uint64 returnBy,
        uint64 inspection,
        uint64 claimResponse
    ) private {
        vm.expectRevert(selector);
        vm.prank(OWNER);
        returnBond.createAgreement(
            borrower, arbiter, itemName, metadataURI, deposit, handover, returnBy, inspection, claimResponse
        );
    }

    function _singleId(uint256 agreementId) private pure returns (uint256[] memory ids) {
        ids = new uint256[](1);
        ids[0] = agreementId;
    }
}
