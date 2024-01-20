use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct MigrateDataPayload<'info> {
    /// CHECK: This account is checked in the instruction
    #[account(mut)]
    pub central_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub signer: Signer<'info>,
}

pub fn handle_migrate_data(ctx: Context<MigrateDataPayload>) -> Result<()> {
    // TODO:
    Ok(())
}
