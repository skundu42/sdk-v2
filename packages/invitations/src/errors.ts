import { CirclesError } from '@aboutcircles/sdk-utils';
import type { Address } from '@aboutcircles/sdk-types';

export type InvitationErrorSource = 'INVITATIONS' | 'PATHFINDING' | 'VALIDATION';

export class InvitationError extends CirclesError<InvitationErrorSource> {
  constructor(
    message: string,
    options?: {
      code?: string | number;
      source?: InvitationErrorSource;
      cause?: unknown;
      context?: Record<string, any>;
    }
  ) {
    super('InvitationError', message, { ...options, source: options?.source || 'INVITATIONS' });
  }

  static noPathFound(from: Address, to: Address): InvitationError {
    return new InvitationError(
      `No valid invitation path found from ${from} to ${to}. The inviter may not have enough balance of the proxy inviter's token.`,
      {
        code: 'INVITATION_NO_PATH',
        source: 'PATHFINDING',
        context: { from, to },
      }
    );
  }

  static insufficientBalance(
    requestedInvites: number,
    availableInvites: number,
    requested: bigint,
    available: bigint,
    from: Address,
    to: Address
  ): InvitationError {
    const requestedCrc = Number(requested) / 1e18;
    const availableCrc = Number(available) / 1e18;

    return new InvitationError(
      `Insufficient balance for ${requestedInvites} invitation(s) Can only afford ${availableInvites} invitation(s) Requested: ${Math.floor(requestedCrc)} CRC Available: ${Math.floor(availableCrc)} CRC`,
      {
        code: 'INVITATION_INSUFFICIENT_BALANCE',
        source: 'VALIDATION',
        context: {
          from,
          to,
          requestedInvites,
          availableInvites,
          requested: requested.toString(),
          available: available.toString(),
          requestedCrc,
          availableCrc,
        },
      }
    );
  }
}
