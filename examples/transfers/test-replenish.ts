import { Core } from '@aboutcircles/sdk-core';
import { TransferBuilder } from '@aboutcircles/sdk-transfers';
import { SafeContractRunner } from '@aboutcircles/sdk-runner';
import { createPublicClient, http } from 'viem';
import { gnosis } from 'viem/chains';
import type { Address } from '@aboutcircles/sdk-types';

/**
 * Test Replenish Function
 *
 * This example demonstrates the replenish function which:
 * 1. Checks current balance of the target token (unwrapped and wrapped)
 * 2. If sufficient wrapped tokens exist, unwraps only what's needed
 * 3. If insufficient, uses pathfinding with trust simulation to acquire tokens
 * 4. Temporarily trusts the token owner if needed for the transfer
 * 5. Untrusts after the transfer completes
 */

async function main() {
  const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}`;
  const SAFE_ADDRESS = process.env.SAFE_ADDRESS as `0x${string}`;
  const RPC_URL = 'https://rpc.aboutcircles.com/';

  if (!PRIVATE_KEY || !SAFE_ADDRESS) {
    throw new Error('PRIVATE_KEY and SAFE_ADDRESS environment variables are required');
  }

  // Configuration
  const tokenToReplenish = '0x0d6c9b45507507d9c12878333059007027cb2990' as Address;
  const amountToReplenish = 1903n * BigInt(1e18) + BigInt(1e17); // 1000 CRC in atto-circles

  console.log('='.repeat(80));
  console.log('REPLENISH FUNCTION TEST');
  console.log('='.repeat(80));
  console.log(`\nAccount: ${SAFE_ADDRESS}`);
  console.log(`Token to replenish: ${tokenToReplenish}`);
  console.log(`Target unwrapped balance: ${Number(amountToReplenish) / 1e18} CRC (${amountToReplenish} atto-circles)`);
  console.log(`\nNote: Replenish will TOP UP to this amount, not add it on top of existing balance\n`);

  // Initialize Core and TransferBuilder
  const core = new Core();
  const transferBuilder = new TransferBuilder(core);

  console.log('🔍 Step 1: Building replenish transaction batch...\n');

  try {
    // Build the replenish transaction batch
    const transactions = await transferBuilder.constructReplenish(
      SAFE_ADDRESS,
      tokenToReplenish,
      amountToReplenish
    );

    console.log(`✓ Successfully built ${transactions.length} transaction(s)\n`);

    // Display the transaction batch
    console.log('📋 Transaction Batch:');
    console.log('─'.repeat(80));

    transactions.forEach((tx, index) => {
      console.log(`\nTransaction ${index + 1}:`);
      console.log(`  To: ${tx.to}`);
      console.log(`  Data: ${tx.data.slice(0, 66)}...`);
      console.log(`  Value: ${tx.value}`);

      // Try to decode the function selector to show what the transaction does
      const selector = tx.data.slice(0, 10);
      let functionName = 'Unknown';

      switch (selector) {
        case '0xa22cb465':
          functionName = 'setApprovalForAll';
          break;
        case '0xde0e9a3e':
          functionName = 'unwrap';
          break;
        case '0xcfa4a316':
          functionName = 'trust';
          break;
        case '0x5f6d5d89':
          functionName = 'operateFlowMatrix';
          break;
        case '0x095ea7b3':
          functionName = 'approve';
          break;
        case '0xf242432a':
          functionName = 'safeTransferFrom';
          break;
        case '0x8ed83c28':
          functionName = 'wrap';
          break;
      }

      console.log(`  Function: ${functionName} (${selector})`);
    });

    console.log('\n' + '─'.repeat(80));

    // Prompt to execute
    console.log('\n✅ Transaction batch built successfully!');
    console.log('\n🚀 Ready to execute transactions...\n');

    // Initialize the contract runner for execution
    const publicClient = createPublicClient({
      chain: gnosis,
      transport: http(RPC_URL),
    });

    const runner = new SafeContractRunner(
      publicClient,
      PRIVATE_KEY,
      RPC_URL,
      SAFE_ADDRESS
    );

    // Initialize the runner
    await runner.init();
    console.log('✅ Safe contract runner initialized\n');

    console.log('⏳ Executing transaction batch...\n');

    // Execute the transactions
    const receipt = await runner.sendTransaction(transactions);

    console.log('✅ Transaction batch executed successfully!');
    console.log(`\nTransaction Hash: ${receipt.transactionHash}`);
    console.log(`Block Number: ${receipt.blockNumber}`);
    console.log(`Gas Used: ${receipt.gasUsed}`);
    console.log(`Status: ${receipt.status === 1 ? 'Success' : 'Failed'}`);

    if (receipt.status !== 1) {
      console.error('\n❌ Transaction failed!');
      return;
    }

    console.log('\n🎉 Replenish completed successfully!');
    console.log(`\n✓ Your account should now have at least ${Number(amountToReplenish) / 1e18} CRC of token ${tokenToReplenish}`);
    console.log('\nNote: Due to 6-decimal precision in pathfinding, the final balance may be');
    console.log('      slightly MORE than target (e.g., 1900.000001 instead of exactly 1900.000000)');
    console.log('      The function rounds UP to ensure you always reach at least the target amount.');

  } catch (error: any) {
    console.error('\n❌ Error during replenish:');

    if (error.code) {
      console.error(`\nError Code: ${error.code}`);
    }

    console.error(`\nError Message: ${error.message}`);

    if (error.context) {
      console.error('\nContext:');
      console.error(JSON.stringify(error.context, null, 2));
    }

    // Show specific guidance based on error type
    if (error.code === 'REPLENISH_INSUFFICIENT_TOKENS') {
      console.error('\n💡 Tip: You do not have enough tokens to replenish the requested amount.');
      console.error('   This includes all available unwrapped, wrapped, and transitive transfer paths.');
      console.error(`   Available: ${error.context?.availableCrc?.toFixed(6) || '0'} CRC`);
      console.error(`   Requested: ${error.context?.requestedCrc?.toFixed(6) || '0'} CRC`);
      console.error(`   Deficit: ${((error.context?.requestedCrc || 0) - (error.context?.availableCrc || 0)).toFixed(6)} CRC`);
    } else if (error.code === 'REPLENISH_INSUFFICIENT_PATH_FLOW') {
      console.error('\n💡 Tip: Pathfinder found a route but cannot provide enough flow.');
      console.error(`   Available through paths: ${error.context?.availableCrc?.toFixed(6) || '0'} CRC`);
      console.error(`   Requested: ${error.context?.requestedCrc?.toFixed(6) || '0'} CRC`);
    } else if (error.code === 'TRANSFER_NO_PATH') {
      console.error('\n💡 Tip: No transfer path found to acquire the token.');
      console.error('   This could mean:');
      console.error('   - You need to trust more people in the network');
      console.error('   - The token owner is not reachable through the trust network');
      console.error('   - You need to establish direct trust with the token owner');
    }

    throw error;
  }
}

main().catch(error => {
  console.error('\n💥 Fatal error:', error.message);
  process.exit(1);
});
