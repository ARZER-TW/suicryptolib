/**
 * Privacy Toggle — switch between "Your view" and "Observer view".
 * Makes privacy guarantees visually obvious.
 */
import { useState } from "react";

export function PrivacyToggle({ children }) {
  const [isObserver, setIsObserver] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-end mb-2">
        <button
          onClick={() => setIsObserver(!isObserver)}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border border-zinc-700 hover:border-zinc-500 transition-colors"
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isObserver ? "bg-amber-400" : "bg-emerald-400"}`} />
          <span className={isObserver ? "text-amber-400" : "text-zinc-400"}>
            {isObserver ? "观察者视角" : "你的视角"}
          </span>
        </button>
      </div>
      {children(isObserver)}
    </div>
  );
}
