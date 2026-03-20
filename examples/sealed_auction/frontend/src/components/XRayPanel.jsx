/**
 * Technical X-Ray Panel — shows what's happening under the hood.
 * Designed for hackathon judges to see the engineering depth.
 */
export function XRayPanel({ steps }) {
  if (!steps || steps.length === 0) return null;

  return (
    <details className="mt-3 rounded-md border border-zinc-800 bg-zinc-950/80 overflow-hidden">
      <summary className="px-3 py-2 text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-400 select-none">
        底层过程 (技术透视)
      </summary>
      <div className="px-3 pb-3 space-y-1.5">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
              step.status === "done" ? "bg-emerald-500" :
              step.status === "active" ? "bg-amber-400 animate-pulse" :
              "bg-zinc-700"
            }`} />
            <span className="text-zinc-500 flex-1">{step.label}</span>
            {step.detail && (
              <span className="font-mono text-zinc-700 text-[10px]">{step.detail}</span>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Create a step tracker for XRayPanel.
 * Usage:
 *   const tracker = createStepTracker(setSteps);
 *   tracker.add("Generating salt...");
 *   tracker.done("32 bytes CSPRNG");
 *   tracker.add("Computing SHA-256...");
 */
export function createStepTracker(setSteps) {
  let steps = [];
  return {
    add(label) {
      steps = [...steps, { label, status: "active", detail: "" }];
      setSteps([...steps]);
    },
    done(detail = "") {
      if (steps.length > 0) {
        steps[steps.length - 1].status = "done";
        steps[steps.length - 1].detail = detail;
        setSteps([...steps]);
      }
    },
    reset() {
      steps = [];
      setSteps([]);
    },
  };
}
