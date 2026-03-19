/**
 * Compute Generator H for Pedersen Commitment on BabyJubJub.
 *
 * H must be a "nothing-up-my-sleeve" point: provably independent of G,
 * so that nobody knows the discrete log relationship log_G(H).
 *
 * Method: try-and-increment
 * 1. Hash "SuiCryptoLib_Pedersen_H_v1" with SHA256 to get seed
 * 2. Use seed as x candidate (mod field order)
 * 3. Check if x is on the BabyJubJub curve
 * 4. If not, increment x and try again
 * 5. Take the canonical y (smaller of the two roots)
 *
 * BabyJubJub curve: a*x^2 + y^2 = 1 + d*x^2*y^2
 *   a = 168700, d = 168696
 *   Defined over BN254 scalar field Fr
 */
import { createHash } from "crypto";

// BN254 scalar field order (= BabyJubJub base field)
const Fr =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// BabyJubJub parameters
const BJJ_A = 168700n;
const BJJ_D = 168696n;

// Standard BabyJubJub base point G (from circomlib)
const G = [
  5299619240641551281634865583518297030282874472190772894086521144482721001553n,
  16950150798460657717958625567821834550301663161624707787222815936182638968203n,
];

/**
 * Modular exponentiation: base^exp mod mod
 */
function modPow(base, exp, mod) {
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * Modular inverse using Fermat's little theorem: a^(-1) = a^(p-2) mod p
 */
function modInverse(a, p) {
  return modPow(((a % p) + p) % p, p - 2n, p);
}

/**
 * Tonelli-Shanks algorithm for modular square root.
 * Returns sqrt(n) mod p, or null if n is not a QR.
 */
function modSqrt(n, p) {
  n = ((n % p) + p) % p;
  if (n === 0n) return 0n;

  // Check if n is a quadratic residue
  if (modPow(n, (p - 1n) / 2n, p) !== 1n) return null;

  // Simple case: p ≡ 3 (mod 4)
  if (p % 4n === 3n) {
    return modPow(n, (p + 1n) / 4n, p);
  }

  // General Tonelli-Shanks
  let q = p - 1n;
  let s = 0n;
  while (q % 2n === 0n) {
    q /= 2n;
    s += 1n;
  }

  let z = 2n;
  while (modPow(z, (p - 1n) / 2n, p) !== p - 1n) {
    z += 1n;
  }

  let m = s;
  let c = modPow(z, q, p);
  let t = modPow(n, q, p);
  let r = modPow(n, (q + 1n) / 2n, p);

  while (true) {
    if (t === 1n) return r;

    let i = 1n;
    let temp = (t * t) % p;
    while (temp !== 1n) {
      temp = (temp * temp) % p;
      i += 1n;
    }

    let b = c;
    for (let j = 0n; j < m - i - 1n; j++) {
      b = (b * b) % p;
    }

    m = i;
    c = (b * b) % p;
    t = (t * c) % p;
    r = (r * b) % p;
  }
}

/**
 * Check if (x, y) is on BabyJubJub: a*x^2 + y^2 = 1 + d*x^2*y^2
 */
function isOnCurve(x, y) {
  const x2 = (x * x) % Fr;
  const y2 = (y * y) % Fr;
  const lhs = (BJJ_A * x2 + y2) % Fr;
  const rhs = (1n + BJJ_D * x2 % Fr * y2 % Fr) % Fr;
  return ((lhs - rhs) % Fr + Fr) % Fr === 0n;
}

/**
 * Given x, find y on BabyJubJub curve.
 * Returns the canonical (smaller) y, or null if x is not on the curve.
 *
 * From a*x^2 + y^2 = 1 + d*x^2*y^2:
 *   y^2 * (1 - d*x^2) = 1 - a*x^2
 *   y^2 = (1 - a*x^2) / (1 - d*x^2)
 */
function findY(x) {
  const x2 = (x * x) % Fr;
  const numerator = ((1n - BJJ_A * x2 % Fr) % Fr + Fr) % Fr;
  const denominator = ((1n - BJJ_D * x2 % Fr) % Fr + Fr) % Fr;

  if (denominator === 0n) return null;

  const y2 = (numerator * modInverse(denominator, Fr)) % Fr;
  const y = modSqrt(y2, Fr);

  if (y === null) return null;

  // Return canonical (smaller) y
  const yNeg = Fr - y;
  return y < yNeg ? y : yNeg;
}

// --- Main ---

console.log("=== Computing Generator H for SuiCryptoLib Pedersen Commitment ===\n");
console.log("Method: try-and-increment with SHA256 seed");
console.log(`Curve: BabyJubJub (a=${BJJ_A}, d=${BJJ_D})`);
console.log(`Field: BN254 scalar field Fr`);
console.log();

// Verify G is on the curve
console.log("Verifying G is on BabyJubJub...");
console.log(`G = (${G[0]}, ${G[1]})`);
console.log(`G on curve: ${isOnCurve(G[0], G[1])}`);
console.log();

// Compute H using try-and-increment
const seed = "SuiCryptoLib_Pedersen_H_v1";
console.log(`Seed string: "${seed}"`);

const seedHash = createHash("sha256").update(seed).digest();
let xCandidate = BigInt("0x" + seedHash.toString("hex")) % Fr;

let attempts = 0;
let H = null;

while (H === null) {
  attempts++;
  const y = findY(xCandidate);
  if (y !== null) {
    H = [xCandidate, y];
    console.log(`Found H after ${attempts} attempts`);
  } else {
    xCandidate = (xCandidate + 1n) % Fr;
  }
}

console.log();
console.log(`H = [`);
console.log(`  ${H[0]},`);
console.log(`  ${H[1]}`);
console.log(`]`);
console.log();
console.log(`H on curve: ${isOnCurve(H[0], H[1])}`);
console.log();

// Verify H != G and H != identity
console.log(`H != G: ${H[0] !== G[0] || H[1] !== G[1]}`);
console.log(`H != identity (0,1): ${H[0] !== 0n || H[1] !== 1n}`);
console.log();

// Output for Circom
console.log("=== Circom Constants ===\n");
console.log(`var G[2] = [`);
console.log(`    ${G[0]},`);
console.log(`    ${G[1]}`);
console.log(`];`);
console.log();
console.log(`var H[2] = [`);
console.log(`    ${H[0]},`);
console.log(`    ${H[1]}`);
console.log(`];`);
console.log();

// Derivation record (for security audit / documentation)
console.log("=== Derivation Record ===\n");
console.log(`seed_string = "${seed}"`);
console.log(`seed_hash   = SHA256("${seed}") = 0x${seedHash.toString("hex")}`);
console.log(`x_initial   = seed_hash mod Fr = ${BigInt("0x" + seedHash.toString("hex")) % Fr}`);
console.log(`attempts    = ${attempts}`);
console.log(`x_final     = ${H[0]}`);
console.log(`y_final     = ${H[1]} (canonical, smaller of two roots)`);
