/**
 * ChainDataView — shows raw on-chain data + Suiscan link.
 * Used in observer view to prove data is real and verifiable.
 */

const SUISCAN_BASE = "https://suiscan.xyz/testnet";

export function SuiscanLink({ objectId, txDigest, label }) {
  const url = txDigest
    ? `${SUISCAN_BASE}/tx/${txDigest}`
    : `${SUISCAN_BASE}/object/${objectId}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-zinc-700 text-zinc-400 hover:text-cyan-400 hover:border-cyan-700 transition-colors"
    >
      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
        <polyline points="15,3 21,3 21,9" />
        <line x1="10" y1="14" x2="21" y2="3" />
      </svg>
      {label || "在 Suiscan 查看"}
    </a>
  );
}

export function RawChainData({ data, label }) {
  if (!data) return null;

  return (
    <div className="mt-3 rounded-md bg-zinc-950 border border-zinc-800 p-3">
      {label && <p className="text-[10px] text-zinc-600 mb-2 uppercase tracking-wider">{label}</p>}
      <pre className="text-[10px] font-mono text-zinc-600 whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto">
        {typeof data === "string" ? data : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}
