import type { Address, TransactionRequest } from '@aboutcircles/sdk-types';
import { CirclesRpc } from '@aboutcircles/sdk-rpc';
import type { Core } from '@aboutcircles/sdk-core';
import { createFlowMatrix } from '@aboutcircles/sdk-pathfinder';
import { bytesToHex } from '@aboutcircles/sdk-utils';
import { InvitationError } from './errors';

const INVITATION_MODULE_ADDRESS = '0x00738aca013B7B2e6cfE1690F0021C3182Fa40B5' as Address;
const INVITATION_FEE = BigInt(96) * BigInt(10 ** 18);

export class InvitationBuilder {
  private core: Core;
  private rpc: CirclesRpc;

  constructor(core: Core) {
    this.core = core;
    this.rpc = new CirclesRpc(core.config.circlesRpcUrl);
  }
  /*
    1.1 User creates an invitation link
    1.2 New user joins usin the invitation link, by calling claim account

    2.1 New user creates a Safe, with all the required modules (invitation module, either passkeys or regular EOA owner)
    2.2 User invites the created Safe



    Go with the replenishment flow, because the tokens might come splited to the invitation module for exmple 50gCRC and 46gCRC
    
    For direct invitation:
    Our goal is to obtain the 96CRC, we should check if the inviter has in total enough CRC
    If yes:
      we preapare unwrap calls for the amount we need
    If no:
      we prepare the unwrap calls for all the amount
      and we check the diff the inviter needs

    Create the safeTransferFrom with the invitation module as a recipient

    We calculate the path from the inviter to the inviter, trying to get 96 CRC if needed



    * generalise the direct invitation an proxy invitation
  */

  

  // make call to the function trustInviter(address inviter) external 
  // simulate trust if needed

  // @todo function to generate an invite
  async createNewSafe(owners: [], modules: Address[]): Promise<Address> {
    // @todo precalculated addess
    return '0x0000000000000000000000000000000000000000' as Address;
  }

  async directInvite(inviter: Address, invitee: Address): Promise<TransactionRequest[]> {
    const inviterLower = inviter.toLowerCase() as Address;
    const inviteeLower = invitee.toLowerCase() as Address;
    const invitationFee = BigInt(96e18); // @todo move to constant

    // -------

    const path = await this.rpc.pathfinder.findPath({
      from: inviterLower,
      to: INVITATION_MODULE_ADDRESS,
      targetFlow: invitationFee,
      toTokens: [inviterLower]
    });

    if (!path.transfers || path.transfers.length === 0) {
      throw InvitationError.noPathFound(inviterLower, INVITATION_MODULE_ADDRESS);
    }

    if (path.maxFlow < invitationFee) {
      throw Error('Update with the new one');
    }

    // @todo check if there is a path found
    const transactions: TransactionRequest[] = [];
    // @todo check if we need it

    const isApproved = await this.core.hubV2.isApprovedForAll(inviterLower, inviterLower);
    if (!isApproved) {
      transactions.push(this.core.hubV2.setApprovalForAll(inviterLower, true));
    }

    const flowMatrix = createFlowMatrix(inviterLower, INVITATION_MODULE_ADDRESS, path.maxFlow, path.transfers);

    //@todo here is gonna be only one stream
    const streamsWithHexData = flowMatrix.streams.map((stream) => ({
      sourceCoordinate: stream.sourceCoordinate,
      flowEdgeIds: stream.flowEdgeIds,
      data: stream.data instanceof Uint8Array ? bytesToHex(stream.data) as `0x${string}` : stream.data as `0x${string}`,
    }));

    const operateFlowMatrixTx = this.core.hubV2.operateFlowMatrix(
      flowMatrix.flowVertices as readonly Address[],
      flowMatrix.flowEdges,
      streamsWithHexData,
      flowMatrix.packedCoordinates as `0x${string}`
    );
    transactions.push(operateFlowMatrixTx);

    // @todo encode data of the address to invite

    return [];
  }

  async createInviter() {

  }

  /**
   * Get proxy inviters who have enough balance to cover invitation fees
   *
   * @param inviter - Address of the inviter
   * @returns Array of addresses that trust the inviter and have transferred amounts > 96e18
   *
   * @description
   * This function:
   * 1. Gets all addresses that trust the inviter
   * 2. Builds a path from inviter to invitation module using those trusted addresses as toTokens
   * 3. Sums up transferred token amounts by tokenOwner
   * 4. Returns only those token owners whose total amounts exceed the invitation fee (96e18)
   */
  async getProxyInviters(inviter: Address): Promise<Address[]> {
    const inviterLower = inviter.toLowerCase() as Address;

    // Step 1: Get addresses that trust the inviter
    const trustedByRelations = await this.rpc.trust.getTrustedBy(inviterLower);

    if (trustedByRelations.length === 0) {
      return [];
    }

    // Extract the addresses of avatars who trust the inviter
    const trustedByAddresses = trustedByRelations.map(relation => relation.objectAvatar);
    console.log("trusted by", trustedByAddresses)
    // Step 2: Build path from inviter to invitation module with max flow using toTokens as trustedBy addresses
    // @todo allow using wrapped
    const path = await this.rpc.pathfinder.findPath({
      from: inviterLower,
      to: INVITATION_MODULE_ADDRESS,
      targetFlow: BigInt('9999999999999999999999999999999999999'),
      toTokens: trustedByAddresses
    });
    console.log(path);
    if (!path.transfers || path.transfers.length === 0) {
      return [];
    }

    // Step 3: Sum up transferred token amounts by tokenOwner (only terminal transfers to invitation module)
    const tokenOwnerAmounts = new Map<string, bigint>();
    const invitationModuleLower = INVITATION_MODULE_ADDRESS.toLowerCase();

    for (const transfer of path.transfers) {
      // Only count transfers that go to the invitation module (terminal transfers)
      if (transfer.to.toLowerCase() === invitationModuleLower) {
        const tokenOwnerLower = transfer.tokenOwner.toLowerCase();
        const currentAmount = tokenOwnerAmounts.get(tokenOwnerLower) || BigInt(0);
        tokenOwnerAmounts.set(tokenOwnerLower, currentAmount + transfer.value);
      }
    }

    // Step 4: Filter token owners whose amounts > 96e18
    const proxyInviters: Address[] = [];

    for (const [tokenOwner, amount] of tokenOwnerAmounts.entries()) {
      if (amount > INVITATION_FEE) {
        proxyInviters.push(tokenOwner as Address);
      }
    }

    return proxyInviters;
  }

  async findInvitePath(
    inviter: Address,
    proxyInviter: Address,
    numberOfInvites: number
  ): Promise<Array<TransactionRequest>> {
    // @todo requirement is that proxyInviter trusts inviter

    const inviterLower = inviter.toLowerCase() as Address;
    const proxyInviterLower = proxyInviter.toLowerCase() as Address;
    const totalAmount = BigInt(numberOfInvites) * INVITATION_FEE;

    const initiallyTrustsProxy = await this.core.hubV2.isTrusted(inviterLower, proxyInviterLower);

    const path = await this.rpc.pathfinder.findPath({
      from: inviterLower,
      to: inviterLower,
      targetFlow: totalAmount,
      toTokens: [proxyInviterLower],
      simulatedTrusts: initiallyTrustsProxy ? undefined : [
        {
          truster: inviterLower,
          trustee: proxyInviterLower
        }
      ]
    });

    if (!path.transfers || path.transfers.length === 0) {
      throw InvitationError.noPathFound(inviterLower, proxyInviterLower);
    }

    if (path.maxFlow < totalAmount) {
      const availableInvites = Number(path.maxFlow / INVITATION_FEE);
      throw InvitationError.insufficientBalance(
        numberOfInvites,
        availableInvites,
        totalAmount,
        path.maxFlow,
        inviterLower,
        proxyInviterLower
      );
    }

    const transactions: TransactionRequest[] = [];

    const isApproved = await this.core.hubV2.isApprovedForAll(inviterLower, inviterLower);
    if (!isApproved) {
      transactions.push(this.core.hubV2.setApprovalForAll(inviterLower, true));
    }

    if (!initiallyTrustsProxy) {
      transactions.push(
        this.core.hubV2.trust(proxyInviterLower, BigInt(2) ** BigInt(96) - BigInt(1))
      );
    }

    const flowMatrix = createFlowMatrix(inviterLower, inviterLower, path.maxFlow, path.transfers);

    const streamsWithHexData = flowMatrix.streams.map((stream) => ({
      sourceCoordinate: stream.sourceCoordinate,
      flowEdgeIds: stream.flowEdgeIds,
      data: stream.data instanceof Uint8Array ? bytesToHex(stream.data) as `0x${string}` : stream.data as `0x${string}`,
    }));

    const operateFlowMatrixTx = this.core.hubV2.operateFlowMatrix(
      flowMatrix.flowVertices as readonly Address[],
      flowMatrix.flowEdges,
      streamsWithHexData,
      flowMatrix.packedCoordinates as `0x${string}`
    );
    transactions.push(operateFlowMatrixTx);

    if (!initiallyTrustsProxy) {
      transactions.push(
        this.core.hubV2.trust(proxyInviterLower, BigInt(0))
      );
    }

    const ids = new Array(numberOfInvites).fill(BigInt(proxyInviterLower));
    const amounts = new Array(numberOfInvites).fill(INVITATION_FEE);

    const batchTransferTx = this.core.hubV2.safeBatchTransferFrom(
      inviterLower,
      INVITATION_MODULE_ADDRESS,
      ids,
      amounts,
      '0x'
    );
    transactions.push(batchTransferTx);

    return transactions;
  }
}
