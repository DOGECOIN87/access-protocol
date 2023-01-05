use solana_program::{pubkey::Pubkey, system_program};
use solana_program_test::{processor, ProgramTest};
use solana_sdk::signer::{keypair::Keypair, Signer};
use solana_sdk::sysvar::clock;
use solana_test_framework::*;
use spl_associated_token_account::{get_associated_token_address, instruction::create_associated_token_account};

use crate::common::test_runner::TestRunner;
use crate::common::utils::{mint_bootstrap, sign_send_instructions};

pub mod common;

#[tokio::test]
async fn common_stake_limit() {
    // Setup the token + basic accounts
    let mut tr = TestRunner::new().await.unwrap();

    // Create users
    let stake_pool_owner = tr.create_ata_account().await.unwrap();
    let staker = tr.create_ata_account().await.unwrap();

    // Mint
    tr.mint(&staker.pubkey(), 10_200).await.unwrap();

    // Create stake pool on day 1 12:00
    tr.create_stake_pool(&stake_pool_owner.pubkey()).await.unwrap();

    // Activate stake pool
    tr.activate_stake_pool(&stake_pool_owner.pubkey()).await.unwrap();

    // Create stake account
    tr.create_stake_account(&stake_pool_owner.pubkey(), &staker.pubkey()).await.unwrap();

    // try staking to pool 1 under the stake limit
    let result = tr.stake(&stake_pool_owner.pubkey(), &staker, 999).await;
    assert!(result.is_err());

    // try staking to pool 1 on the stake limit
    tr.stake(&stake_pool_owner.pubkey(), &staker, 1000).await.unwrap();

    // unstake
    tr.unstake(&stake_pool_owner.pubkey(), &staker, 1000).await.unwrap();

    // Create bond account
    tr.create_bond(&stake_pool_owner.pubkey(), &staker.pubkey(), 10_000).await.unwrap();

    // Claim bond
    tr.claim_bond(&stake_pool_owner.pubkey(), &staker, 10_000).await.unwrap();

    // staking under the stake limit should work
    tr.stake(&stake_pool_owner.pubkey(), &staker, 1).await.unwrap();
}