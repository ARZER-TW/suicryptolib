/**
 * ChainDataView — shows raw on-chain data with annotations + Suiscan link.
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

/**
 * Annotated chain data — each field has a value and an explanation
 * of what observers can/cannot learn from it.
 *
 * fields: [{ key, value, note }]
 */
export function AnnotatedChainData({ label, fields }) {
  if (!fields || fields.length === 0) return null;

  return (
    <div className="mt-3 rounded-md bg-zinc-950 border border-zinc-800 p-3">
      {label && <p className="text-[10px] text-zinc-600 mb-2 uppercase tracking-wider">{label}</p>}
      <div className="space-y-2">
        {fields.map((f, i) => (
          <div key={i}>
            <div className="flex gap-2 text-[10px] font-mono">
              <span className="text-zinc-500 shrink-0">{f.key}:</span>
              <span className="text-zinc-400 break-all">{String(f.value ?? "...")}</span>
            </div>
            {f.note && (
              <p className="text-[10px] text-amber-600/70 mt-0.5 ml-2">{f.note}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
