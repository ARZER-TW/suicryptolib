/**
 * Module Attribution Tag — shows which SuiCryptoLib module powered this operation.
 */
export function ModuleTag({ module, detail }) {
  return (
    <div className="mt-2 flex items-center gap-1.5 text-[10px]">
      <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 font-mono">SuiCryptoLib</span>
      <span className="text-zinc-600">{module}</span>
      {detail && <span className="text-zinc-700">| {detail}</span>}
    </div>
  );
}
