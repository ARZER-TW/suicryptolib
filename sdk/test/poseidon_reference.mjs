/**
 * Generate Poseidon hash reference values using circomlibjs
 * These values will be compared with sui::poseidon::poseidon_bn254 on-chain
 */
import { buildPoseidon } from "circomlibjs";

async function main() {
  const poseidon = await buildPoseidon();

  // Test cases matching our Move tests
  const testCases = [
    { inputs: [1n, 2n], label: "hash_pair(1, 2)" },
    { inputs: [2n, 1n], label: "hash_pair(2, 1)" },
    { inputs: [42n], label: "hash_single(42)" },
    { inputs: [0n, 0n], label: "hash_pair(0, 0)" },
    {
      inputs: [
        123456789n,
        987654321n,
      ],
      label: "hash_pair(123456789, 987654321)",
    },
  ];

  console.log("=== Poseidon BN254 Reference Values (circomlibjs) ===\n");

  for (const tc of testCases) {
    const hash = poseidon(tc.inputs);
    // poseidon returns a buffer/Uint8Array, convert to BigInt
    const hashBigInt = poseidon.F.toObject(hash);
    console.log(`${tc.label}:`);
    console.log(`  decimal: ${hashBigInt.toString()}`);
    console.log(`  hex:     0x${hashBigInt.toString(16)}`);
    console.log();
  }

  // Generate Move test assertions
  console.log("=== Move Test Assertions ===\n");
  for (const tc of testCases) {
    const hash = poseidon(tc.inputs);
    const hashBigInt = poseidon.F.toObject(hash);
    const inputStr = tc.inputs.map((i) => i.toString()).join(", ");
    console.log(
      `// ${tc.label}`
    );
    console.log(
      `assert!(poseidon::poseidon_bn254(&vector[${inputStr}]) == ${hashBigInt.toString()}u256, ${testCases.indexOf(tc)});`
    );
    console.log();
  }
}

main().catch(console.error);
