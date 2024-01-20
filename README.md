```
solana-keygen new --outfile tests/wallets/landMerkleTree.json
```

Deploy Program

```
anchor deploy
```

Deploy IDL

```
anchor idl init -f <target/idl/program.json> <program-id>
```

Upgrade IDL

```
anchor idl upgrade <program-id> -f <target/idl/program.json>
```
