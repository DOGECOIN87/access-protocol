use crate::error::MediaError;
use crate::processor::Processor;
use num_traits::FromPrimitive;
use solana_program::{
    account_info::AccountInfo, decode_error::DecodeError, entrypoint::ProgramResult, msg,
    program_error::PrintProgramError, pubkey::Pubkey,
};

#[cfg(not(feature = "no-entrypoint"))]
use solana_program::entrypoint;
#[cfg(not(feature = "no-entrypoint"))]
entrypoint!(process_instruction);

/// The entrypoint to the program
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    msg!("Entrypoint");
    if let Err(error) = Processor::process_instruction(program_id, accounts, instruction_data) {
        // catch the error so we can print it
        error.print::<MediaError>();
        return Err(error);
    }
    Ok(())
}

impl PrintProgramError for MediaError {
    fn print<E>(&self)
    where
        E: 'static + std::error::Error + DecodeError<E> + PrintProgramError + FromPrimitive,
    {
        match self {
            MediaError::AlreadyInitialized => {
                msg!("Error: This account is already initialized")
            }
            MediaError::DataTypeMismatch => {
                msg!("Error: Data type mismatch")
            }
            MediaError::WrongSystemProgram => {
                msg!("Error: Wrong system program key");
            }
            MediaError::WrongRent => {
                msg!("Error: Wrong rent sysvar key")
            }
            MediaError::WrongOwner => {
                msg!("Error: Wrong account owner")
            }
            MediaError::AccountNotDeterministic => {
                msg!("Error: Account not generated deterministically")
            }
        }
    }
}
