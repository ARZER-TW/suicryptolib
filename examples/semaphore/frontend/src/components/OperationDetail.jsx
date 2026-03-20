/**
 * OperationDetail — unified panel showing data flow with privacy boundary.
 * Replaces the old XRayPanel.
 */

export function OperationDetail({ title, browserSteps, privacyNote, chainSteps }) {
  if (!browserSteps) return null;

  return (
    <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/80 overflow-hidden" open>
      <summary className="px-3 py-2 text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-400 select-none">
        {title || "操作详情"}
      </summary>
      <div className="px-3 pb-3 text-[11px]">
        {/* Browser section */}
        <p className="text-zinc-500 mb-1.5">浏览器 (离线计算)</p>
        <div className="border-l border-zinc-700 pl-3 space-y-1 ml-1">
          {browserSteps.map((step, i) => (
            <div key={i} className="flex justify-between gap-4">
              <span className="text-zinc-400">{step.label}</span>
              {step.detail && <span className="text-zinc-600 font-mono shrink-0">{step.detail}</span>}
            </div>
          ))}
        </div>

        {/* Privacy boundary */}
        <div className="my-2.5 flex items-center gap-2">
          <div className="flex-1 border-t border-dashed border-amber-700/50" />
          <span className="text-[10px] text-amber-500/80 shrink-0 px-1">
            {privacyNote || "秘密数据永远不跨越此线"}
          </span>
          <div className="flex-1 border-t border-dashed border-amber-700/50" />
        </div>

        {/* Chain section */}
        <p className="text-zinc-500 mb-1.5">Sui 链上</p>
        <div className="border-l border-emerald-800/50 pl-3 space-y-1 ml-1">
          {chainSteps.map((step, i) => (
            <div key={i} className="flex justify-between gap-4">
              <span className="text-zinc-400">{step.label}</span>
              {step.detail && <span className="text-zinc-600 font-mono shrink-0">{step.detail}</span>}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
