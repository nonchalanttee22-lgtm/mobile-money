#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, token, Address, BytesN, Env};

#[contracttype]
#[derive(Clone)]
pub struct HtlcState {
    pub sender: Address,
    pub receiver: Address,
    pub token: Address,
    pub amount: i128,
    pub hashlock: BytesN<32>,
    pub timelock: u64,
    pub claimed: bool,
    pub refunded: bool,
}

const HTLC: &str = "HTLC";

#[contract]
pub struct HtlcContract;

#[contractimpl]
impl HtlcContract {
    /// Initialize the HTLC. The sender must authorize this call and
    /// transfer `amount` tokens into the contract's own account.
    pub fn initialize(
        env: Env,
        sender: Address,
        receiver: Address,
        token: Address,
        amount: i128,
        hashlock: BytesN<32>,
        timelock: u64,
    ) {
        sender.require_auth();

        assert!(amount > 0, "amount must be positive");
        assert!(
            !env.storage().instance().has(&HTLC),
            "already initialised"
        );
        
        // Ensure timelock is in the future
        assert!(timelock > env.ledger().timestamp(), "timelock must be in the future");

        // Pull funds from the sender into this contract.
        token::Client::new(&env, &token).transfer(&sender, &env.current_contract_address(), &amount);

        env.storage().instance().set(
            &HTLC,
            &HtlcState {
                sender,
                receiver,
                token,
                amount,
                hashlock,
                timelock,
                claimed: false,
                refunded: false,
            },
        );
    }

    /// Claim funds by providing the preimage.
    pub fn claim(env: Env, preimage: BytesN<32>) {
        let mut state: HtlcState = env.storage().instance().get(&HTLC).expect("not initialised");

        assert!(!state.claimed, "already claimed");
        assert!(!state.refunded, "already refunded");

        // Verify the hash of the preimage matches the hashlock
        let hash = env.crypto().sha256(&preimage.into());
        assert!(hash == state.hashlock, "invalid preimage");

        // Transfer funds to the receiver
        token::Client::new(&env, &state.token)
            .transfer(&env.current_contract_address(), &state.receiver, &state.amount);

        state.claimed = true;
        env.storage().instance().set(&HTLC, &state);
    }

    /// Refund funds to the sender after the timelock has expired.
    pub fn refund(env: Env) {
        let mut state: HtlcState = env.storage().instance().get(&HTLC).expect("not initialised");

        assert!(!state.claimed, "already claimed");
        assert!(!state.refunded, "already refunded");
        
        // Check if timelock has expired
        assert!(env.ledger().timestamp() >= state.timelock, "timelock not yet expired");

        // Transfer funds back to the sender
        token::Client::new(&env, &state.token)
            .transfer(&env.current_contract_address(), &state.sender, &state.amount);

        state.refunded = true;
        env.storage().instance().set(&HTLC, &state);
    }

    /// Return current HTLC state (read-only).
    pub fn get_state(env: Env) -> HtlcState {
        env.storage().instance().get(&HTLC).expect("not initialised")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Env, BytesN,
    };

    fn setup() -> (Env, Address, Address, Address, HtlcContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();

        let sender = Address::generate(&env);
        let receiver = Address::generate(&env);

        // Deploy a test SAC token.
        let token_admin = Address::generate(&env);
        let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
        let token_sac = StellarAssetClient::new(&env, &token_id.address());
        token_sac.mint(&sender, &1_000_000);

        let contract_id = env.register(HtlcContract, ());
        let client = HtlcContractClient::new(&env, &contract_id);

        (env, sender, receiver, token_id.address(), client)
    }

    #[test]
    fn test_htlc_happy_path() {
        let (env, sender, receiver, token, client) = setup();
        let amount: i128 = 500_000;
        
        let preimage = BytesN::from_array(&env, &[1; 32]);
        let hashlock = env.crypto().sha256(&preimage.clone().into());
        let timelock = 1000;
        
        env.ledger().set_timestamp(100);

        client.initialize(&sender, &receiver, &token, &amount, &hashlock, &timelock);

        let state = client.get_state();
        assert_eq!(state.amount, amount);
        assert!(!state.claimed);

        client.claim(&preimage);

        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&receiver), amount);
        assert!(client.get_state().claimed);
    }

    #[test]
    fn test_htlc_refund() {
        let (env, sender, receiver, token, client) = setup();
        let amount: i128 = 500_000;
        
        let preimage = BytesN::from_array(&env, &[1; 32]);
        let hashlock = env.crypto().sha256(&preimage.clone().into());
        let timelock = 1000;
        
        env.ledger().set_timestamp(100);

        client.initialize(&sender, &receiver, &token, &amount, &hashlock, &timelock);

        // Jump to after timelock
        env.ledger().set_timestamp(1001);

        client.refund();

        let token_client = TokenClient::new(&env, &token);
        assert_eq!(token_client.balance(&sender), 1_000_000);
        assert!(client.get_state().refunded);
    }
}
