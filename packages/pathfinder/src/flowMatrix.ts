import type { FlowMatrix, TransferStep, Address, FlowEdgeStruct, StreamStruct, Hex } from '@aboutcircles/sdk-types';
import { packCoordinates, transformToFlowVertices } from './packing';
import { bytesToHex } from '@aboutcircles/sdk-utils';

/**
 * Create an ABI‑ready FlowMatrix object from a list of TransferSteps.
 */
export function createFlowMatrix(
  from: Address,
  to: Address,
  value: bigint,
  transfers: TransferStep[]
): FlowMatrix {
  const sender = from.toLowerCase();
  const receiver = to.toLowerCase();

  const { sorted: flowVertices, idx } = transformToFlowVertices(
    transfers,
    sender,
    receiver
  );

  const flowEdges: FlowEdgeStruct[] = transfers.map((t) => {
    const isTerminal = t.to.toLowerCase() === receiver;
    return {
      streamSinkId: isTerminal ? 1 : 0,
      amount: t.value
    };
  });

  // Ensure at least one terminal edge
  const hasTerminalEdge = flowEdges.some((e) => e.streamSinkId === 1);
  if (!hasTerminalEdge) {
    const lastEdgeIndex = transfers
      .map((t) => t.to.toLowerCase())
      .lastIndexOf(receiver);
    const fallbackIndex =
      lastEdgeIndex === -1 ? flowEdges.length - 1 : lastEdgeIndex;
    flowEdges[fallbackIndex].streamSinkId = 1;
  }

  const termEdgeIds = flowEdges
    .map((e, i) => (e.streamSinkId === 1 ? i : -1))
    .filter((i) => i !== -1);

  const streams: StreamStruct[] = [
    {
      sourceCoordinate: idx[sender],
      flowEdgeIds: termEdgeIds,
      data: new Uint8Array(0)
    }
  ];

  const coords: number[] = [];
  transfers.forEach((t) => {
    coords.push(idx[t.tokenOwner.toLowerCase()]);
    coords.push(idx[t.from.toLowerCase()]);
    coords.push(idx[t.to.toLowerCase()]);
  });

  const packedCoordinates = packCoordinates(coords);

  const expected = BigInt(value);
  const terminalSum = flowEdges
    .filter((e) => e.streamSinkId === 1)
    .reduce((sum, e) => sum + BigInt(e.amount.toString()), BigInt(0));

  const isBalanced = terminalSum === expected;
  if (!isBalanced) {
    throw new Error(`Terminal sum ${terminalSum} does not equal expected ${expected}`);
  }

  return {
    flowVertices,
    flowEdges,
    streams,
    packedCoordinates,
    sourceCoordinate: idx[sender]
  };
}

/**
 * Prepare flow matrix streams with hex-encoded data for ABI encoding
 * Converts Uint8Array data to hex strings and adds optional txData to the first stream
 *
 * @param flowMatrix - The flow matrix to prepare
 * @param txData - Optional transaction data to attach to the first stream
 * @returns Array of streams with hex-encoded data ready for contract calls
 */
export function prepareFlowMatrixStreams(
  flowMatrix: FlowMatrix,
  txData?: Hex | Uint8Array
): Array<{ sourceCoordinate: number; flowEdgeIds: readonly number[]; data: Hex }> {
  const streams = flowMatrix.streams.map((stream) => ({
    sourceCoordinate: stream.sourceCoordinate,
    flowEdgeIds: stream.flowEdgeIds,
    data: stream.data instanceof Uint8Array
      ? bytesToHex(stream.data) as Hex
      : stream.data as Hex,
  }));

  // Attach txData to the first stream if provided
  if (txData && streams.length > 0) {
    streams[0].data = txData instanceof Uint8Array
      ? bytesToHex(txData) as Hex
      : txData as Hex;
  }

  return streams;
}