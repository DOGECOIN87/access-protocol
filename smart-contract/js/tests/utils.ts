import {
  Keypair,
  PublicKey,
  Connection,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  Transaction,
} from "@solana/web3.js";
import * as path from "path";
import { readFileSync, writeSync, closeSync } from "fs";
import { execSync } from "child_process";
import tmp from "tmp";
import { getOrCreateAssociatedTokenAccount, createMint, mintTo, TOKEN_PROGRAM_ID, AuthorityType, createSetAuthorityInstruction } from "@solana/spl-token";
import { sleep } from "../src/utils";

const programName = "access_protocol";

// Returns a keypair and key file name.
export function initializePayer(): [Keypair, string] {
  const key = new Keypair();
  const tmpobj = tmp.fileSync();
  writeSync(tmpobj.fd, JSON.stringify(Array.from(key.secretKey)));
  closeSync(tmpobj.fd);
  return [key, tmpobj.name];
}

// Deploys the agnostic order book program. Fees are paid with the fee payer
// whose key is in the given key file.
export function deployProgram(
  payerKeyFile: string,
  compile: boolean,
  compileFlag?: string,
  testBpf?: boolean
): PublicKey {
  const programDirectory = path.join(path.dirname(__filename), "../../program");
  const stakingSo = path.join(
    programDirectory,
    `target/deploy/${programName}.so`
  );
  const keyfile = path.join(
    path.dirname(stakingSo),
    `${programName}-keypair.json`
  );
  let compileCmd = "cargo build-bpf";
  if (compileFlag) {
    compileCmd += ` --features ${compileFlag}`;
  }
  if (compile) {
    execSync(compileCmd, {
      cwd: programDirectory,
    });
  }
  if (testBpf) {
    execSync(
      "cargo test-bpf --features days-to-sec-10s no-mint-check no-bond-signer",
      {
        cwd: programDirectory,
      }
    );
  }

  const bytes = readFileSync(keyfile, "utf-8");
  const keypair = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(bytes)));
  execSync(
    [
      "solana program deploy",
      stakingSo,
      "--program-id",
      keyfile,
      "-u localhost",
      "-k",
      payerKeyFile,
      "--commitment finalized",
    ].join(" ")
  );
  return keypair.publicKey;
}

// Funds the given account. Sleeps until the connection is ready.
export async function airdropPayer(connection: Connection, key: PublicKey) {
  while (true) {
    try {
      const signature = await connection.requestAirdrop(
        key,
        10 * LAMPORTS_PER_SOL
      );
      console.log(`Airdrop signature ${signature}`);
      await connection.confirmTransaction(signature, "finalized");
      return;
    } catch (e) {
      console.log(`Error airdropping ${e}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export const signAndSendTransactionInstructions = async (
  // sign and send transaction
  connection: Connection,
  signers: Array<Keypair> | undefined,
  feePayer: Keypair,
  txInstructions: Array<TransactionInstruction>,
  skipPreflight?: boolean
): Promise<string> => {
  const tx = new Transaction();
  tx.feePayer = feePayer.publicKey;
  console.log("Fee payer: ", feePayer.publicKey.toBase58());
  signers = signers ? [...signers, feePayer] : [];
  tx.add(...txInstructions);
  const sig = await connection.sendTransaction(tx, signers, {
    skipPreflight: skipPreflight ?? false,
  });

  // Why? https://github.com/solana-labs/solana/issues/25955
  try {
    await connection.confirmTransaction(sig, "finalized");
  } catch (e) {
    let status = await connection.getSignatureStatus(sig);
    console.log("Signature status: ", status.value?.confirmationStatus);
    let attempt = 1;
    while (status.value?.confirmationStatus !== 'finalized' && attempt < 5) {
      sleep(1000);
      console.log(`waiting for confirmation... (${attempt})`);
      status = await connection.getSignatureStatus(sig);
      attempt++;
    }
  }
  return sig;
};

export class TokenMint {
  token: Keypair;
  connection: Connection;
  feePayer: Keypair;
  mintAuthority: PublicKey;
  centralStateAuthority?: Keypair;

  constructor(token: Keypair, connection: Connection, feePayer: Keypair, mintAuthority: PublicKey) { 
    this.token = token;
    this.connection = connection;
    this.feePayer = feePayer;
    this.mintAuthority = mintAuthority;
  }

  async updateAuthorityToCentralState(
    connection: Connection,
    mintAuthorityKeypair: Keypair,
    feePayer: Keypair,
    centralKey: PublicKey
  ) {
    const txs = [
      createSetAuthorityInstruction(
        this.token.publicKey,
        this.mintAuthority,
        AuthorityType.MintTokens,
        centralKey,
      )
    ];

    const tx = await signAndSendTransactionInstructions(connection, [mintAuthorityKeypair], feePayer, 
      txs
    );
    console.log(`Move mint authority to central key ${tx}`);
  }

  static async init(
    connection: Connection,
    feePayer: Keypair,
    mintAuthority: Keypair | null = null,
  ) {
    const tokenKeypair = new Keypair();
    await createMint(
      connection,
      feePayer,
      mintAuthority?.publicKey ?? tokenKeypair.publicKey,
      null,
      6,
      tokenKeypair
    );
    const token = new TokenMint(
      tokenKeypair, connection, feePayer, mintAuthority?.publicKey ?? tokenKeypair.publicKey,
    );
    return token;
  }

  async getAssociatedTokenAccount(wallet: PublicKey): Promise<PublicKey> {
    const acc = await getOrCreateAssociatedTokenAccount(
      this.connection,
      this.feePayer,
      this.token.publicKey,
      wallet
    );
    return acc.address;
  }

  async mintInto(tokenAccount: PublicKey, amount: number): Promise<any> {
    return await mintTo(
      this.connection, 
      this.feePayer,
      this.token.publicKey,
      tokenAccount,
      this.token,
      amount,
      [],
      { skipPreflight: false },
      TOKEN_PROGRAM_ID
    );
  }
}
