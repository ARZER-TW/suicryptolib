pragma circom 2.1.5;

// Minimal test circuit: proves knowledge of a, b such that a * b = c
// Public output: c (automatically public as output signal)
// Private inputs: a, b
template Multiplier() {
    signal input a;
    signal input b;
    signal output c;

    c <== a * b;
}

component main = Multiplier();
