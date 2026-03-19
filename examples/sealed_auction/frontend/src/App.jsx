import { useState } from "react";
import { createHash, randomBytes } from "./crypto-utils";
import "./index.css";

const PHASES = ["COMMIT", "REVEAL", "SETTLED"];

function App() {
  const [phase, setPhase] = useState(0);
  const [bids, setBids] = useState([]);
  const [revealedBids, setRevealedBids] = useState([]);
  const [bidAmount, setBidAmount] = useState("");
  const [bidderName, setBidderName] = useState("");
  const [winner, setWinner] = useState(null);
  const [itemName] = useState("Rare Digital Artifact #001");

  const handlePlaceBid = () => {
    if (!bidAmount || !bidderName || phase !== 0) return;
    const amount = parseInt(bidAmount, 10);
    if (isNaN(amount) || amount <= 0) return;

    const salt = randomBytes(32);
    const valueBytes = new TextEncoder().encode(bidAmount);
    const data = new Uint8Array([...valueBytes, ...salt]);
    const hash = createHash(data);

    const newBid = {
      bidder: bidderName,
      amount,
      salt: Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join(""),
      commitment: hash,
      revealed: false,
    };

    setBids(prev => [...prev, newBid]);
    setBidAmount("");
    setBidderName("");
  };

  const handleReveal = (index) => {
    const bid = bids[index];
    setRevealedBids(prev => [...prev, { ...bid, revealed: true }]);
    setBids(prev => prev.map((b, i) => i === index ? { ...b, revealed: true } : b));
  };

  const handleAdvancePhase = () => {
    if (phase === 0 && bids.length > 0) {
      setPhase(1);
    } else if (phase === 1) {
      const revealed = bids.filter(b => b.revealed);
      if (revealed.length > 0) {
        const highest = revealed.reduce((a, b) => a.amount > b.amount ? a : b);
        setWinner(highest);
      }
      setPhase(2);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-zinc-200">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 flex items-center justify-center text-xs font-bold text-white">V</div>
            <span className="text-lg font-semibold tracking-tight">Veil Protocol</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">Demo</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-500">Powered by</span>
            <span className="font-medium text-cyan-400">SuiCryptoLib</span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Auction Info */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
            Sealed-Bid Auction
          </h1>
          <p className="text-zinc-400 text-lg">{itemName}</p>
        </div>

        {/* Phase Indicator */}
        <div className="flex gap-1 mb-8">
          {PHASES.map((p, i) => (
            <div key={p} className="flex-1">
              <div className={`h-1.5 rounded-full transition-all ${
                i < phase ? "bg-cyan-500" :
                i === phase ? "bg-gradient-to-r from-violet-500 to-cyan-500 animate-pulse" :
                "bg-zinc-800"
              }`} />
              <p className={`text-xs mt-1.5 ${i === phase ? "text-cyan-400 font-medium" : "text-zinc-600"}`}>
                {p}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Action Panel */}
          <div className="space-y-6">
            {phase === 0 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="text-lg font-semibold mb-4">Place Sealed Bid</h2>
                <p className="text-sm text-zinc-400 mb-4">
                  Your bid is encrypted as H(amount || salt). Nobody can see your bid amount until the reveal phase.
                </p>
                <div className="space-y-3">
                  <input
                    type="text"
                    placeholder="Your name"
                    value={bidderName}
                    onChange={(e) => setBidderName(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors"
                  />
                  <input
                    type="number"
                    placeholder="Bid amount (SUI)"
                    value={bidAmount}
                    onChange={(e) => setBidAmount(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 placeholder-zinc-500 outline-none focus:border-violet-500 transition-colors"
                  />
                  <button
                    onClick={handlePlaceBid}
                    disabled={!bidAmount || !bidderName}
                    className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-medium hover:from-violet-500 hover:to-cyan-500 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                  >
                    Submit Sealed Bid
                  </button>
                </div>
              </div>
            )}

            {phase === 1 && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <h2 className="text-lg font-semibold mb-4">Reveal Your Bid</h2>
                <p className="text-sm text-zinc-400 mb-4">
                  Click reveal to open your sealed bid. The contract verifies H(amount || salt) matches your commitment.
                </p>
                <div className="space-y-2">
                  {bids.map((bid, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3 rounded-lg bg-zinc-800">
                      <span className="text-sm font-medium">{bid.bidder}</span>
                      {bid.revealed ? (
                        <span className="text-sm text-emerald-400 font-medium">{bid.amount} SUI</span>
                      ) : (
                        <button
                          onClick={() => handleReveal(i)}
                          className="text-sm px-3 py-1 rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                        >
                          Reveal
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {phase === 2 && winner && (
              <div className="rounded-xl border border-emerald-800/50 bg-emerald-900/20 p-6">
                <h2 className="text-lg font-semibold mb-3 text-emerald-400">Auction Settled</h2>
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-xl font-bold text-white">
                    {winner.bidder[0]}
                  </div>
                  <div>
                    <p className="font-semibold text-lg">{winner.bidder} wins!</p>
                    <p className="text-emerald-400 text-2xl font-bold">{winner.amount} SUI</p>
                  </div>
                </div>
              </div>
            )}

            {/* Advance Phase Button */}
            {phase < 2 && bids.length > 0 && (
              <button
                onClick={handleAdvancePhase}
                className="w-full py-2.5 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors text-sm"
              >
                {phase === 0 ? "End Commit Phase  --  Start Reveals" : "Settle Auction"}
              </button>
            )}
          </div>

          {/* Right: Live Status */}
          <div className="space-y-6">
            {/* On-chain State */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="text-lg font-semibold mb-4">On-Chain State</h2>
              <p className="text-xs text-zinc-500 mb-3">What everyone can see on the blockchain:</p>

              {bids.length === 0 ? (
                <p className="text-sm text-zinc-500 italic">No bids yet</p>
              ) : (
                <div className="space-y-2">
                  {bids.map((bid, i) => (
                    <div key={i} className="px-4 py-3 rounded-lg bg-zinc-800/70 border border-zinc-700/50">
                      <div className="flex justify-between items-center mb-1">
                        <span className="text-sm font-medium">{bid.bidder}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          bid.revealed
                            ? "bg-emerald-900/50 text-emerald-400"
                            : "bg-amber-900/50 text-amber-400"
                        }`}>
                          {bid.revealed ? "Revealed" : "Sealed"}
                        </span>
                      </div>
                      <div className="font-mono text-xs text-zinc-500 break-all">
                        {bid.revealed ? (
                          <span className="text-emerald-400">{bid.amount} SUI</span>
                        ) : (
                          <>
                            <span className="text-zinc-600">commitment: </span>
                            {bid.commitment.substring(0, 20)}...
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* How It Works */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="text-sm font-semibold mb-3 text-zinc-400">How It Works</h2>
              <div className="space-y-3 text-xs text-zinc-500">
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-violet-900/50 text-violet-400 flex items-center justify-center shrink-0 text-[10px] font-bold">1</div>
                  <p><span className="text-zinc-300">Commit:</span> Bid is hashed as SHA256(amount + random_salt). Only the hash goes on-chain.</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-violet-900/50 text-violet-400 flex items-center justify-center shrink-0 text-[10px] font-bold">2</div>
                  <p><span className="text-zinc-300">Reveal:</span> Bidder submits amount + salt. Contract verifies hash matches commitment.</p>
                </div>
                <div className="flex gap-2">
                  <div className="w-5 h-5 rounded-full bg-violet-900/50 text-violet-400 flex items-center justify-center shrink-0 text-[10px] font-bold">3</div>
                  <p><span className="text-zinc-300">Settle:</span> Highest revealed bid wins. Non-revealers forfeit deposit.</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="mt-12 pt-6 border-t border-zinc-800 text-center">
          <p className="text-xs text-zinc-600">
            Built with SuiCryptoLib -- Cryptographic primitives for Sui
          </p>
          <p className="text-xs text-zinc-700 mt-1">
            Modules: hash_commitment + commit_reveal + pedersen + range_proof
          </p>
        </footer>
      </main>
    </div>
  );
}

export default App;
